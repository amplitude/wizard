# Test harness

The wizard ships with several test lanes that escalate from fast in-process
checks to slow real-binary integration. Pick the cheapest lane that catches
your regression.

```
┌───────────────────────────┬──────────────────────────────┬───────────┐
│  Lane                     │  Catches                     │  Speed    │
├───────────────────────────┼──────────────────────────────┼───────────┤
│  Unit (`pnpm test`)        │  Pure logic, schemas, hooks  │  ~40s     │
│  Snapshot (in unit lane)  │  Screen layout / copy        │  ~40s     │
│  Scenario (in unit lane)  │  Wizard flow, scripted agent │  ~40s     │
│  Smoke PTY                │  Raw mode, signals, TTY      │  ~30s/case│
│  E2E (`pnpm test:e2e`)     │  Real CLI + framework wire   │  10+ min  │
│  Eval (Phase 4 — TBD)     │  Real Claude agent quality   │  nightly  │
└───────────────────────────┴──────────────────────────────┴───────────┘
```

## Unit lane — `pnpm test`

`vitest.config.ts`. Includes everything under `src/**/__tests__`. The
existing 2700+ tests live here.

This is also where the **scenario tests** live — they run in-process
against the [`AgentDriver`](../src/lib/agent-driver.ts) port using
[`createScriptedDriver`](../src/lib/scripted-agent-driver.ts) to feed
canned message sequences into the real `runAgent` machinery. No
subprocess, no Claude SDK, no network. Use these for any deterministic
regression — flow ordering, tool-call sequencing, NDJSON event shapes,
exit-code routing.

Pattern:

```ts
import { setAgentDriver } from '../../lib/agent-driver';
import { createScriptedDriver, mk } from '../../lib/scripted-agent-driver';

beforeEach(() => {
  const { driver, calls } = createScriptedDriver({
    messages: [
      mk.systemInit(),
      mk.assistantText('thinking...'),
      mk.resultSuccess('done'),
    ],
  });
  setAgentDriver(driver);
});

afterEach(() => setAgentDriver(null));
```

**Snapshot tests** live alongside their components under
`src/ui/tui/screens/__tests__/*.snap.test.tsx` and use
[`renderSnapshot` / `makeStoreForSnapshot`](../src/ui/tui/__tests__/snapshot-utils.tsx).
NDJSON output gets normalized through
[`redactNdjsonStream`](../src/ui/__tests__/ndjson-redact.ts) before
diffing — see [`docs/agent-ndjson-contract.md`](../docs/agent-ndjson-contract.md)
for the contract.

## Smoke PTY lane — `pnpm test:smoke:pty`

`vitest.config.smoke.ts`. Spawns the real wizard binary under a
[`node-pty`](https://github.com/microsoft/node-pty) pseudo-terminal so
TTY-only behavior surfaces:

- Ink only enters raw mode against a real `isTTY` stdin.
- Signals fire on real OS processes.
- `process.stdout.write` only EPIPE-aborts on a real closed pipe.
- `mode-config.ts`'s TTY detection runs against actual `process.stdout.isTTY`.

Kept intentionally small — one or two scenarios. PTY tests are 10–50× a
unit test, and scaling them past a smoke layer destroys the dev feedback
loop. For deterministic scenario coverage use the unit-lane scripted
driver instead.

Skips automatically when `node-pty` isn't loadable (e.g., a host without a
prebuild and without a C++ toolchain). CI must ensure the toolchain is
present so the lane actually exercises real PTY behavior there.

## E2E lane — `pnpm test:e2e`

`e2e-tests/jest.config.ts`. Builds the binary, spawns it in test
applications under `e2e-tests/test-applications/`, MSW-mocks the Amplitude
API, and replays recorded LLM responses keyed by request hash. Used to
verify framework-specific instrumentation lands correctly. Slow — not on
PR CI. See `e2e-tests/README.md`.

## LLM record/replay (cassettes) — Phase 4

When the eval lane lands, **cross-process LLM calls** will be intercepted
via [`llmock`](https://github.com/CopilotKit/llmock) — an HTTP server that
records `/messages`-shaped requests and replays them deterministically.
The wizard subprocess hits `ANTHROPIC_BASE_URL=http://localhost:<port>`
and the test suite owns the cassette JSON.

Why not extend MSW (which `e2e-tests/` already uses)? MSW only intercepts
in the same Node process. The Claude Agent SDK runs in a child process, so
we need a real HTTP server. Cassettes are the right primitive for the
**smoke tier** of the eval lane (deterministic replay, zero cost). Live
LLM calls are reserved for the **standard / full / deep** tiers (real
agent quality measurement). The two answer different questions and must
not be conflated.

Status: not yet wired. Tracked as a Phase 4 deliverable.

## When to add to which lane

| Symptom or invariant                              | Lane                |
|---------------------------------------------------|---------------------|
| Tool-call ordering / NDJSON event shape           | Unit (scripted)     |
| Screen layout / copy / hint bar contents          | Unit (snapshot)     |
| Pure helper / classifier / parser                 | Unit                |
| Raw mode / signals / TTY-conditional code         | Smoke PTY           |
| Real binary survives a clean `--help` / `--version` | Smoke PTY           |
| Real framework integration end-to-end (build + run)| E2E                 |
| "Did Claude do the right thing"                   | Eval (Phase 4)      |
| Reward hacking / sycophancy / silent fallback     | Eval (Phase 4)      |

When a deterministic check is possible, prefer the unit lane — it gives
the fastest feedback and the most precise regression signal. Reach for
PTY only when the bug literally requires a TTY to reproduce.
