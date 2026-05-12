# Wizard SDK-integration evals

This directory holds the SDK-integration eval suite for `@amplitude/wizard`. The full design lives in [`docs/evals.md`](../docs/evals.md). Read that first if you're new to this work — the design rationale (why NDJSON, why the layered scorer stack, why three rings) is there, and this README assumes you've seen it.

## Status

Phase 1 of the spec is complete. Layers 0–4 + 6 are wired with deterministic + LLM-judge scorers, all seven Ring 1 scenarios have lockfile-pinned fixtures and pinned goldens, and CI is split between the PR gate (Layers 0–3, ~5 min wall-clock) and a nightly Ring 2 job (Layers 0–6, two seeds per scenario, variance summary uploaded as an artifact).

| Layer | Status | Notes |
|-------|--------|-------|
| 0 — hard-fail | ✅ done | criterions 1, 6, 8, 10 + secret-in-stderr; correct-sdk-package now hard-fails on stale-legacy-SDK coexistence (failure mode #10) |
| 1 — structural | ✅ done | criterions 4, 5, 9, 13, 14, 16, 17, 19; idempotent-rerun + self-verification opt in via second-run NDJSON / verification_result events |
| 2 — static SDK | ✅ done | criterions 2, 3, 7, 11, 12, 15 |
| 3 — build / typecheck | ✅ done | criterion 18; PR-gate runs golden-pinned `BuildResult`; nightly runs `pnpm install && <buildCommand>` against the working tree |
| 4 — runtime probe | ✅ done | Playwright-driven, dynamic-import gated; nightly installs playwright, PR-gate skip-passes |
| 5 — ingestion verification | ⛔ out of scope | wizard runs with `--no-telemetry` in eval mode; ingestion correctness is owned by `e2e-tests/`. See [Layer 5 below](#layer-5--ingestion-verification-out-of-scope) |
| 6 — LLM judge | ✅ done | rubric versioned via `rubrics/rubric-version.txt`; --judge flag + `ANTHROPIC_API_KEY`; gateway routing is the next step |

Ring 1 scenarios shipped: `nextjs-app-router/vanilla`, `nextjs-app-router/pre-existing-vendor`, `react-router-7/framework`, `react-router-7/data`, `react-vite/vanilla`, `expo/vanilla`, `generic/probe`. The nightly variance harness flags any scenario whose two seeds disagree by more than 10 points (the spec's non-determinism threshold).

## Quick start

```bash
# Run the full Vitest suite for the eval framework.
pnpm test evals/

# Score a scenario via the CLI (golden replay by default).
pnpm evals:run nextjs-app-router/vanilla

# Score it against a real wizard run (requires AMPLITUDE_EVAL_API_KEY).
AMPLITUDE_EVAL_API_KEY=… pnpm evals:run nextjs-app-router/vanilla --live

# Add Layer 4 (Playwright runtime probe) — requires playwright installed.
pnpm evals:run nextjs-app-router/vanilla --runtime

# Add Layer 6 (LLM judge) — requires ANTHROPIC_API_KEY.
ANTHROPIC_API_KEY=… pnpm evals:run nextjs-app-router/vanilla --judge

# Pin a seed for variance tracking (see nightly workflow).
pnpm evals:run nextjs-app-router/vanilla --seed 2
```

The CLI prints a summary to stdout and writes the full report to `evals/reports/<runId>/report.json`.

## Layout

```
evals/
  README.md                      ← this file
  spec/
    quality-criteria.md          ← in-repo mirror of docs/evals.md's 19-point checklist
  runner/
    types.ts                     ← Scenario, Artifact, Scorer, Report shapes
    invoke-wizard.ts             ← runLive() spawns the wizard; runReplay() loads goldens
    parse-stream.ts              ← NDJSON parse + the four runner contract assertions
    fs-snapshot.ts               ← walks fixture working trees, hashes, diffs
    score.ts                     ← orchestrates the scorer stack, produces a Report
  scorers/
    layer0-hard-fail/            ← criterions 1, 6, 8, 10
    layer1-structural/           ← criterions 4, 5, 9, 13, 14, 19
    __tests__/runner.test.ts     ← Week 1 green run
  scenarios/
    nextjs-app-router/vanilla/
      scenario.json              ← declarative scenario manifest
      pristine/                  ← read-only starter (mirror of e2e test app source)
      golden/
        run.ndjson               ← recorded wizard NDJSON stream
        exit-code.txt            ← single integer exit code
        working/                 ← filesystem state the wizard would have produced
  bin/
    run-eval.ts                  ← `pnpm evals:run` entry point
  reports/                       ← generated; .gitignored
```

### Why one folder per scenario, not two?

`docs/evals.md` describes a layout with `evals/fixtures/<name>/` and `evals/scenarios/<name>.scenario.ts` as separate trees. Week 1 collapses this: each scenario directory holds its own pristine, golden, and manifest. The simplification is intentional — it keeps the authoring loop tight (one cd, one tree to grok) and the eventual split-out is mechanical when we have more than seven scenarios. Document the decision rather than the future-state layout while we're early.

## Source modes

The runner produces an `Artifact` from one of two sources:

1. **`live`** — spawn the wizard against a fresh copy of `pristine/`, capture stdout NDJSON, walk the working tree at exit. This is what catches real regressions. Requires authentication (see [Live-mode authentication](#live-mode-authentication) below).
2. **`golden`** — load a pre-recorded `run.ndjson` + `exit-code.txt` + `working/` from disk. The artifact is content-equivalent to a real run; scorers cannot tell the difference. Optionally loads a `golden/stderr.txt` to drive the secret-in-stderr scorer.

Why both: the eval-only Amplitude project doesn't exist yet (decision #2 in the spec is still open), so a true live integration in CI isn't possible today. Golden gives us a green run that proves the framework is correct independently of ingestion. When the eval-only project lands, scenarios graduate to live and golden becomes a tool for offline scorer development.

### Live-mode authentication

`runLive` resolves auth in this order:

1. **`WIZARD_OAUTH_TOKEN`** (preferred) — when set, the runner forwards `WIZARD_OAUTH_TOKEN` / `WIZARD_EXPIRES_AT` / `WIZARD_ZONE` to the wizard child process. This routes LLM calls through the Amplitude LLM gateway, which is the only path that catches gateway-specific regressions (Vertex schema noise, beta-header rejections, the proxy 400 class). **Wizard-side reading of these env vars is a follow-up wiring PR**; until it lands, this path will fail at the wizard's OAuth step.
2. **`EVALS_ALLOW_API_KEY_BYPASS=1` + `--api-key`** — opt-in fallback. Routes LLM calls direct-to-Anthropic, skipping the gateway. **This cannot catch gateway-specific bugs.** The runner prints a warning when this mode is used. Use only when you understand the trade-off.
3. **Neither** — error. The runner refuses to silently pick a default; the choice between gateway and bypass is too consequential.

### Stderr capture and redaction

Live runs capture the wizard subprocess's stderr (it is no longer piped through to the parent terminal) and apply `redactString` from `src/lib/observability/redact.ts` to the full buffer at flush time. The redacted stderr lands on the artifact at `Artifact.stderr` for scorer use; raw stderr is never persisted. The Layer 0 `no-secret-in-stderr` scorer asserts no JWT-, Bearer-, or hex-token-shaped string survived redaction — a hit there is a redactor regression and a hard fail.

## Adding a scenario (Week 1 shape)

The full flow is in `docs/evals.md` § Adding a new scenario. Mechanics for Week 1:

1. Create `evals/scenarios/<framework>/<variant>/`.
2. Drop a `scenario.json` (see existing `nextjs-app-router/vanilla/scenario.json` for the shape — every field is documented in `runner/types.ts: Scenario`).
3. Drop a real, lockfile-pinned framework starter under `pristine/`. Mirror an `e2e-tests/test-applications/` source tree; do not commit `node_modules/`.
4. (Until live runs work in CI) hand-author a `golden/run.ndjson` + `golden/working/` so scorers have something to grade. Use the existing nextjs golden as a template — every wire shape is documented in `src/lib/agent-events.ts`.
5. Run `pnpm evals:run <framework>/<variant>`. Scorer failures will tell you what's missing.

**Adding a scorer:** see `docs/evals.md` § Adding a new scorer. Always start by adding a row to the 19-point checklist in `docs/evals.md`, then update the mirror at [`spec/quality-criteria.md`](./spec/quality-criteria.md).

## Layer 5 — ingestion verification (out of scope)

Layer 5 is intentionally **not** part of the eval suite. The wizard is invoked with `--no-telemetry` in eval mode (`evals/runner/invoke-wizard.ts` forwards the flag and the env var unconditionally), so synthetic eval runs never reach the prod analytics project. There's nothing to verify ingestion against.

End-to-end "does the SDK actually deliver events to Amplitude?" coverage lives in `e2e-tests/test-applications/`, not here. That's the right home: ingestion depends on framework bundling, hosting, and network shape — variables the eval suite doesn't control. The eval suite stops at Layer 4 (runtime probe boots the integration, asserts ≥1 outbound Amplitude request fires).

If a future need surfaces, the wiring is straightforward — Layer 4's request interceptor can be flipped to forward instead of fulfill, and a Layer 5 scorer can poll the Amplitude API for arrival. The plumbing exists; we just don't run it.

## Known gaps

- **Wizard-side `WIZARD_OAUTH_TOKEN` reading is a follow-up PR.** The runner forwards the env var to the wizard child today, but the wizard doesn't read it yet — live runs need either the wizard-side wiring or the explicit `EVALS_ALLOW_API_KEY_BYPASS=1` opt-in. Once the wizard-side lands, gateway-routed live evals work in CI without the bypass.
- **Judge auth is direct-to-Anthropic.** Layer 6 calls `@anthropic-ai/sdk` directly using `ANTHROPIC_API_KEY`. Routing through the wizard's LLM gateway is a follow-up so judge calls share the same auth + rate-limit story as the wizard itself.
- **AST-based init counting.** Layer 0's `single-init-call.ts` uses regex; it can false-positive on commented-out callsites. AST inspection moves it to Layer 2 in a follow-up.

## References

- [`docs/evals.md`](../docs/evals.md) — full spec.
- [`src/lib/agent-events.ts`](../src/lib/agent-events.ts) — wire-format authoritative source.
- [`src/lib/exit-codes.ts`](../src/lib/exit-codes.ts) — exit-code → outcome mapping.
- [`src/ui/agent-ui.ts`](../src/ui/agent-ui.ts) — emitter, the single writer of NDJSON.
