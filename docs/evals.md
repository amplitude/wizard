# Wizard Eval Framework

This is the working spec for the SDK-integration eval suite for `@amplitude/wizard`. It describes what we evaluate, how the runner drives the wizard, the scorer stack, the framework coverage strategy, and the CI gating shape. The reader audience is the BA team and any agent contributor (human or otherwise) who needs to add a scenario, add a scorer, or change how the suite runs in CI. Architecture decisions that are still open are called out at the end so we don't pretend they're settled.

## Table of contents

- [Purpose and scope](#purpose-and-scope)
- [Architecture overview](#architecture-overview)
- [Repo layout](#repo-layout)
- [The 19-point quality checklist](#the-19-point-quality-checklist)
- [Layered scorer stack](#layered-scorer-stack)
- [Three-ring framework stratification](#three-ring-framework-stratification)
- [CI gating strategy](#ci-gating-strategy)
- [Phasing](#phasing)
- [Failure modes the suite must catch](#failure-modes-the-suite-must-catch)
- [Decisions resolved and decisions still open](#decisions-resolved-and-decisions-still-open)
- [Sidebar: skill / detector drift](#sidebar-skill--detector-drift)

## Purpose and scope

We are building these evals to catch regressions in agent-generated SDK integrations as we iterate on:

- The system prompt (`src/lib/commandments.ts`)
- The integration skills (`skills/integration/<framework>/`)
- The model (Sonnet today, Opus where it earns the spend)
- The wizard tool surface (`src/lib/wizard-tools.ts` — `check_env_keys`, `set_env_values`, `confirm_event_plan`, etc.)
- Per-framework `FrameworkConfig` data (`src/frameworks/<framework>/`)

A pass means: for a given framework starter, the wizard's agent produces an integration a senior DevRel engineer would accept in code review without rewrites. A fail means we shipped a regression to a customer.

### Out of scope (Phase 2 or later)

To keep Phase 1 tractable, the following are explicitly not part of this suite:

- **Taxonomy / chart / dashboard agent quality.** The post-agent flow (first chart, first dashboard) is a separate eval surface with its own scorers.
- **MCP install evals.** Whether we wire the Amplitude MCP server into Claude Code / Cursor / Codex correctly is a separate test target — it doesn't share scorers with SDK integration.
- **Wizard reliability / TUI evals.** Flow invariants, router resolution, and Ink screen rendering are already covered by the existing Vitest + fast-check tests under `src/ui/tui/__tests__/`. We do not duplicate that here.
- **End-to-end ingestion guarantees in CI.** Ring 3 (pre-release) does runtime ingestion checks, but the PR-gated rings stop at build / typecheck.

If a future eval needs taxonomy, MCP, or TUI coverage, build it as a sibling suite under `evals/` with its own runner config — do not extend this one.

## Architecture overview

The runner drives the wizard through its existing agent mode (`--agent`), parses the NDJSON stream, captures the post-run filesystem, and hands both to scorers. The wizard does not need any eval-specific instrumentation. Everything the runner needs is already on the wire because that interface exists for orchestrators today.

### Why NDJSON agent mode is the right surface

`--agent` already gives us:

- **Versioned envelope.** Every event has `v: 1` and a per-event `data_version` (see `src/lib/agent-events.ts`, `AGENT_EVENT_WIRE_VERSION` and `EVENT_DATA_VERSIONS`). When we change the schema, scorers can branch on `data_version` instead of guessing.
- **Terminal lifecycle event.** `run_completed` is emitted exactly once at the end of a successful or failed run. Absence of `run_completed` before EOF means the wizard crashed mid-stream — the runner treats that as a hard fail. This is the canonical "did the wizard exit cleanly" signal.
- **Structured artifact event.** `setup_complete` fires exactly once on a successful `apply` run, immediately before `run_completed`, and carries the framework, file changes, env keys touched, and confirmed event plan. Scorers consume this directly instead of parsing setup-report markdown.
- **Per-tool change attribution.** `file_change_applied` events let scorers replay every write/edit and attribute it to a specific tool call. We don't have to diff the working tree to know what the agent touched.
- **Event-plan transitions.** `event_plan_proposed` and `event_plan_confirmed` carry the events the agent wanted to track. Scorers compare proposed vs confirmed to verify "every confirmed event has a `track()` call."
- **Secret redaction is already enforced.** `AgentUI` (`src/ui/agent-ui.ts`) redacts API keys, OAuth tokens, and stack-trace internals from emitted events. Anything the eval runner captures is safe to log to a build artifact.
- **Exit codes match the outcome.** `src/lib/exit-codes.ts` defines the `ExitCode` enum (0 success, 2 invalid args, 3 auth, 4 network, 10 agent failed, 130 cancelled). The runner asserts that the exit code matches the terminal `run_completed.outcome` — they should never disagree.

The alternatives we rejected:

- **Stdin emulation of the TUI.** That's how `e2e-tests/` drive the wizard for end-to-end coverage of the UI itself. For SDK integration evals, simulating a human typing into Ink is fragile, slow, and gives us less structured data than we already get for free from `--agent`.
- **Stdout regex.** The wizard already emits typed events. Re-parsing them via regex would duplicate `agent-events.ts` and drift.
- **Hooking into `agent-runner.ts` directly.** Tempting, but couples evals to internal call shapes. The NDJSON contract is the supported interface.

### Contract points the runner enforces

For every run, the eval runner asserts:

1. **Envelope version.** Every line parses as JSON with `v: 1`. Lines failing this are a runner-level error, not a scorer fail.
2. **Terminal `run_completed`.** Exactly one `run_completed` event before EOF. Zero or more than one is a hard fail.
3. **`setup_complete` matches outcome.** If `run_completed.outcome === 'success'`, there is exactly one preceding `setup_complete`. If outcome is `failed` or `cancelled`, there is no `setup_complete`.
4. **Exit code matches outcome.** Process exit code is consistent with `run_completed.outcome` per the table in `exit-codes.ts`.
5. **No raw secrets.** The captured stdout/stderr is grep-checked for the test API key string and any of its substrings of length >= 16. A hit short-circuits all downstream scoring (this overlaps Layer 0, but the runner short-circuits early so we don't spend tokens grading a leaked-secret run).

### Runner outline

```
spawn: amplitude-wizard --agent --yes --install-dir <fixture> --integration <hint>
       --api-key <eval-project-key>

while line := readline(child.stdout):
    event := JSON.parse(line)
    assert event.v === 1
    runLog.append(event)

await child.exit
captureFsSnapshot(<fixture>)

artifact := { runLog, fsSnapshot, exitCode, runtime, seed }
for layer in [L0, L1, L2, L3, L4, L5, L6]:
    if !shouldRun(layer, ringContext): continue
    layer.scorers.forEach(s => s.evaluate(artifact))
emit JSONL report to evals/reports/<run-id>/
```

The runner is a small Node script. It does not import wizard internals — it spawns the wizard binary and reads stdout. This is deliberate: changing the runner does not require rebuilding the wizard, and changing the wizard does not invalidate run logs captured before the change.

### Artifact shape

A scenario produces one artifact JSON file plus an associated working-tree snapshot. Scorers consume the artifact and never touch the live filesystem — this is what lets us re-score historical runs without re-running the wizard.

```ts
// evals/runner/types.ts (sketch)
interface Artifact {
  runId: string;                  // ULID
  scenario: string;               // e.g. "nextjs-app-router-vanilla"
  ring: 1 | 2 | 3;
  seed: number;                   // for variance tracking
  startedAt: string;              // ISO
  finishedAt: string;
  exitCode: number;
  runLog: AgentEventEnvelope[];   // every NDJSON line, in order
  fsSnapshot: {
    files: Record<string, { sha256: string; size: number; }>;
    diff: { added: string[]; modified: string[]; deleted: string[]; };
  };
  buildResult?: {                 // populated by Layer 3
    command: string;
    exitCode: number;
    stderrTail: string;           // last 4kb, redacted
  };
  runtimeResult?: { ... };        // populated by Layer 4
}
```

`fsSnapshot.diff` is computed against the fixture's clean baseline (the lockfile-pinned `pristine/` subdir under each fixture). Scorers that ask "did the agent touch this file" check the diff, not the full snapshot.

### Why we capture both `runLog` and `fsSnapshot`

The two are complementary, not redundant:

- `runLog` tells us what the agent *intended* — every tool call, every file write the agent thinks it made, every event plan transition.
- `fsSnapshot` tells us what *actually* landed on disk after redirects, hooks, formatting, and any post-agent steps.

Several criteria (notably 19, "setup-report artifact accurate") are explicitly the comparison between these two. If a scorer only looks at one, it's incomplete.

## Repo layout

```
evals/
  README.md                       # one-pager for contributors
  runner/
    index.ts                      # spawns wizard, captures artifact
    contract.ts                   # envelope assertions, version checks
    fs-snapshot.ts                # walks fixture dir, captures + hashes
    types.ts                      # Artifact, ScorerResult, RingContext
  fixtures/
    nextjs-app-router-vanilla/    # minimal starter, .gitignore'd node_modules
    nextjs-app-router-existing/   # already has @amplitude/analytics-browser
    react-router-7-framework/
    react-router-7-data/
    react-vite-vanilla/
    expo-vanilla/
    generic-probe/                # framework markers stripped
    ...
  scenarios/
    <fixture-name>.scenario.ts    # ring assignment, expected events, hints
  scorers/
    layer0-hard-fail/
    layer1-structural/
    layer2-static/
    layer3-build/
    layer4-runtime/
    layer5-ingestion/
    layer6-judge/
  rubrics/
    judge-prompt.md               # canonical LLM-judge rubric
    rubric-version.txt            # bumps when rubric changes
  reports/
    .gitignore                    # never commit run reports
  bin/
    run-eval.ts                   # `pnpm eval --ring=1` entry
```

Scenarios are TypeScript so they can import the `Integration` enum and stay typed; fixtures are real package directories under `fixtures/`. Reports are git-ignored and uploaded as CI artifacts.

### Anatomy of a scenario file

```ts
// evals/scenarios/nextjs-app-router-vanilla.scenario.ts
import { Integration } from '../../src/lib/constants.js';
import type { Scenario } from '../runner/types.js';

export const scenario: Scenario = {
  name: 'nextjs-app-router-vanilla',
  ring: 1,
  fixture: 'nextjs-app-router-vanilla',
  integrationHint: Integration.nextjs,
  buildCommand: ['pnpm', 'build'],
  expectedSdkPackage: '@amplitude/unified',
  expectedEnvPrefix: 'NEXT_PUBLIC_',
  expectedInitFile: 'app/AmplitudeProvider.tsx',
  expectedEvents: ['Page Viewed', 'Sign Up', 'Sign In'],
  forbiddenPaths: [
    'next.config.js',     // criterion 10: no build-config bridging
    'next.config.mjs',
    'webpack.config.js',
    'babel.config.js',
  ],
  notes: 'Canonical App Router scenario. Catches server/client boundary regressions.',
};
```

The runner consumes this declaratively. Scorers read fields off it (`expectedSdkPackage` → criterion 1; `expectedEnvPrefix` → criterion 9; `forbiddenPaths` → criterion 10; etc.). Adding a scenario should not require new scorer code; if it does, that's a sign the spec is missing a criterion.

### Fixture management

Each fixture is a real package directory. Two subdirectories matter:

- `fixtures/<name>/pristine/` — the clean starter, lockfile-pinned, never modified by the runner. Treat as read-only.
- `fixtures/<name>/working/` — git-ignored. Created fresh from `pristine/` at the start of every run, deleted at the end. The wizard runs against `working/`; scorers compare `working/` against `pristine/` to compute the diff.

The "pristine" directory is the contract between fixture maintenance and the runner. When a fixture is regenerated (because the framework released a new major), only `pristine/` needs to update; nothing about the runner or scorers changes.

## The 19-point quality checklist

Every scorer maps to one or more rows in this table. New scorers must cite the row(s) they cover. New rows here come from real failures observed in the wild — when we add one, we update the spec before we update the prompt or skill (the criterion outlives the specific fix).

Hard fail = any single failure fails the whole integration regardless of total score. Heavy = 10 pts. Medium = 5 pts. Soft = warn-only.

### A. Package selection

| # | Criterion | Weight | Notes |
|---|-----------|--------|-------|
| 1 | Correct SDK package family for the framework | Hard fail | Browser frameworks must use `@amplitude/unified` (project rule). Node/server uses `@amplitude/analytics-node`. Mobile uses the matching native SDK. |
| 2 | Correct version range pinned in `package.json` / equivalent | Medium (5) | No wildcard majors, no pre-release tags unless requested. |
| 3 | No non-vendor packages installed by the agent | Medium (5) | The agent should not pull in unrelated helper libraries to "fix" something. |

### B. Init placement and shape

| # | Criterion | Weight | Notes |
|---|-----------|--------|-------|
| 4 | Init lives in the correct entry file for the framework | Heavy (10) | App Router: `app/layout.tsx` client wrapper. Pages Router: `_app.tsx`. Vite: `main.tsx`. Expo: `app/_layout.tsx`. Etc. |
| 5 | No project-local re-export wrapper around the SDK | Heavy (10) | We have seen agents create `lib/amplitude.ts` that re-exports `track`. This breaks tree-shaking and creates a second init surface. |
| 6 | Single `init()` call per project | Hard fail | Multiple inits cause double-counted events and duplicate device IDs. |
| 7 | Init options carry comments explaining each toggle | Medium (5) | DX: the next dev who reads this code should know what to flip. |

### C. Identity, env vars, and secrets

| # | Criterion | Weight | Notes |
|---|-----------|--------|-------|
| 8 | API key is read from an env var, never hardcoded | Hard fail | Including no string literal that matches the test key. |
| 9 | Env var prefix matches the framework | Medium (5) | `NEXT_PUBLIC_*` for Next.js, `VITE_*` for Vite, `EXPO_PUBLIC_*` for Expo, server-side unprefixed for Node, etc. |
| 10 | No build-config bridging to inject env vars | Hard fail | Modifying `next.config.js`, `vite.config.ts`, `webpack.config.js`, `babel.config.js` to ferry secrets is a hard fail. The supported pattern is the framework's own env mechanism. |

### D. Server vs client boundary

| # | Criterion | Weight | Notes |
|---|-----------|--------|-------|
| 11 | Browser SDK never imported into a server-only file | Heavy (10) | App Router: no `@amplitude/unified` in a Server Component, no `init()` at module scope of a server file. |
| 12 | Server SDK is used in API routes / server actions when present | Heavy (10) | If the agent inserts server-side tracking, it uses `@amplitude/analytics-node` with a flush. |

### E. Track placement

| # | Criterion | Weight | Notes |
|---|-----------|--------|-------|
| 13 | Every confirmed event in the plan has at least one `track()` call | Heavy (10) | Compare `event_plan_confirmed` against AST-found `track()` invocations. |
| 14 | At least one `track()` call landed | Medium (5) | Sanity floor — covers the case where the plan is empty or rejected silently. |
| 15 | Property keys follow the project's lowercase-with-spaces convention | Soft (warn) | `'org id'`, `'project id'`, etc. Soft because customer projects vary. |

### F. Idempotency, health, and build

| # | Criterion | Weight | Notes |
|---|-----------|--------|-------|
| 16 | Re-running the wizard on the same project is a no-op (or only updates) | Medium (5) | Detected by running the wizard twice on the same fixture and diffing the second run's `file_change_applied` set against the first. |
| 17 | Agent's self-verification step passes | Medium (5) | The wizard runs a verification check at the end of integration; this captures whether it self-reported success. |
| 18 | Project still builds and typechecks | Heavy (10) | `pnpm build` (or framework equivalent) exits 0 in the fixture after the run. |

### G. DX artifact

| # | Criterion | Weight | Notes |
|---|-----------|--------|-------|
| 19 | Setup-report artifact is present and accurate | Medium (5) | `setup_complete` event matches the actual filesystem state. The summary doesn't claim files that weren't written. |

Total: 4 hard fails + 6 heavy (60 pts) + 8 medium (40 pts) + 1 soft (warn). A run with no hard fails and >= 80 pts passes.

## Layered scorer stack

Scorers run in cost order. Cheap layers gate expensive layers — if Layer 0 fails, we don't spend tokens on Layer 6. Each layer's "what it catches" maps to specific rows in the 19-point table.

### Layer 0 — Hard-fail gate

**What it catches:** Criteria 1, 6, 8, 10. Any hard fail short-circuits the run; downstream layers are skipped and the scenario is marked as failed regardless of partial-credit signals.

**How:** Pure deterministic checks against the run log + filesystem. Grep for the literal API key. Inspect `package.json` against the framework's expected SDK family. Count `init()` invocations across the AST. Inspect `next.config.js` / `vite.config.ts` / etc. for env-bridging patterns.

**Cost:** Negligible. Runs in well under a second.

**Worked example — criterion 8 (no hardcoded API key):**

```ts
// evals/scorers/layer0-hard-fail/no-hardcoded-key.ts
export const scorer: Scorer = {
  id: 'L0-no-hardcoded-key',
  criterion: 8,
  evaluate(artifact, scenario) {
    const evalKey = scenario.apiKey;            // injected by runner
    const fragment = evalKey.slice(0, 16);      // 16-char prefix is enough
    for (const path of artifact.fsSnapshot.diff.modified.concat(
                       artifact.fsSnapshot.diff.added)) {
      const text = readFile(path);              // from working/
      if (text.includes(evalKey) || text.includes(fragment)) {
        return { pass: false, hardFail: true,
                 detail: `${path} contains the API key literal` };
      }
    }
    return { pass: true };
  },
};
```

The scorer doesn't care which file leaked the key — any leak is a hard fail. `runLog` and `fsSnapshot.diff` are plenty; we don't need to walk the whole tree.

### Layer 1 — Structural assertions

**What it catches:** Criteria 4, 5, 13, 14, 19. "Does the right file exist, contain the expected import, and call the expected function?"

**How:** AST queries (we already use `@typescript-eslint/parser` in the codebase; reuse it here) plus a minimal grep fallback for non-TS frameworks. Compares `event_plan_confirmed` vs `track()` calls.

**Cost:** Single-digit seconds per scenario.

**Worked example — criterion 13 (every confirmed event has a `track()` call):**

```ts
// evals/scorers/layer1-structural/confirmed-events-tracked.ts
export const scorer: Scorer = {
  id: 'L1-confirmed-events-tracked',
  criterion: 13,
  evaluate(artifact) {
    const confirmed = artifact.runLog
      .filter(e => e.event === 'event_plan_confirmed')
      .flatMap(e => e.data.events.map(ev => ev.name));

    const tracked = collectTrackCallNames(artifact);  // walks AST in working/
    const missing = confirmed.filter(name => !tracked.has(name));

    if (missing.length === 0) return { pass: true, weight: 10 };
    return {
      pass: false,
      weight: 10,
      detail: `Confirmed events without a track() call: ${missing.join(', ')}`,
    };
  },
};
```

Two notes worth lifting out of the code:

- The scorer reads `event_plan_confirmed` off the run log — not `event_plan_proposed`. We grade against what the agent committed to, not what it floated.
- `collectTrackCallNames` returns a `Set<string>` keyed on the literal first argument to `track(...)`. Computed event names (`track(eventName)` where `eventName` is a variable) are flagged separately as a soft warn — they may be intentional but they're hostile to this scorer.

### Layer 2 — Static SDK rules

**What it catches:** Criteria 2, 3, 7, 9, 11, 12, 15. The "DevRel review" rules that don't need a build.

**How:** A combination of:

- Package-version regex against `package.json` (criterion 2).
- A diff against the fixture's pre-run `package.json` to detect surprise dependencies (criterion 3).
- AST inspection of init-options object literals for trailing comments (criterion 7).
- Env-var-name lookup keyed off framework (criterion 9).
- Server/client boundary inspection: directive scanner (`'use client'`, `'use server'`), App Router file-path heuristics, import graph (criterions 11 and 12).
- Property-key naming check (criterion 15, warn-only).

**Cost:** Single-digit seconds per scenario.

### Layer 3 — Build and typecheck

**What it catches:** Criterion 18, plus a robustness floor on everything in Layers 0-2 (an apparent pass that doesn't compile is not a real pass).

**How:** Run the framework's build command in the fixture. For most JS frameworks this is `pnpm build` or `pnpm typecheck`; for Expo it's `pnpm expo export`; for Swift it's `xcodebuild -dry-run`. Build commands are declared per-fixture in the scenario file.

**Cost:** 30 seconds to 2 minutes per scenario, parallelizable across scenarios. This is the dominant cost in PR-gate runs.

### Layer 4 — Runtime probe

**What it catches:** Criterion 17 plus latent integration bugs that compile but break at boot (init in module scope of a Server Component, missing peer dep that bundles fine but errors at runtime, server SDK imported into a browser file).

**How:** Boot the framework's dev server in headless mode (Playwright for browser frameworks, a smoke harness for Node). Hit a known route. Verify no uncaught exceptions in the page console and at least one outbound request to the Amplitude ingestion endpoint (intercepted, not forwarded — see Layer 5).

**Cost:** 1-3 minutes per scenario. Nightly only by default.

### Layer 5 — Ingestion verification (out of scope; owned by e2e tests)

End-to-end ingestion verification is **not** in the eval suite. Two reasons:

1. **The wizard is run with `--no-telemetry` in eval mode**, so synthetic eval invocations never reach the prod analytics project. That removes the original motivation for an "eval-only Amplitude project" (decision #2 in the spec) — there's nothing to isolate.
2. **Whether the integrated SDK actually delivers events at runtime is fundamentally an e2e concern**, not a regression-on-prompt-changes concern. It depends on the framework's bundling, the customer's hosting, network shape, sampling — variables the eval suite explicitly doesn't control. `e2e-tests/test-applications/` is the right home for that signal.

The eval suite's coverage of "does the SDK fire" stops at Layer 4 (runtime probe): boot the integration in a headless browser, intercept Amplitude requests, assert ≥1 fired. That's enough to catch the regressions the suite is built for (init in the wrong context, tree-shaken-away SDK, server/client boundary breakage). Whether the request reaches Amplitude is a different test.

If we ever need ingestion coverage in the eval suite later, the wiring is straightforward: forward the Layer 4 probe's intercepted requests to a real project + poll. The plumbing is already in place; what we lack is a reason to build it now.

### Layer 6 — LLM judge

**What it catches:** Taste signals that resist deterministic encoding — code ergonomics, comment quality, setup-report readability, variable naming, "would a senior engineer accept this in review."

**How:** A judge prompt under `evals/rubrics/judge-prompt.md` evaluates the diff + setup report against the 19-point criteria, returns a structured JSON verdict per criterion plus a free-form rationale. The rubric is versioned (`rubric-version.txt`) so we can correlate score drift with rubric changes.

**Judge input shape.** The judge sees:

- The 19-point rubric (verbatim from this doc, kept in sync via a generation script).
- The framework name and ring.
- The full diff (`fsSnapshot.diff.added` + `fsSnapshot.diff.modified`, with file contents inlined for additions and unified diffs for modifications).
- The `setup_complete` event.
- The list of `event_plan_confirmed` events.

The judge does *not* see the run log's tool-call detail or the structural scorer verdicts. We don't want it to defer to deterministic verdicts — it's there for taste signals the deterministic layers can't catch.

**Judge output shape.** Structured JSON, one entry per criterion the rubric expects judged:

```json
{
  "rubric_version": "2026-05-05.1",
  "verdicts": [
    {
      "criterion": 7,
      "pass": false,
      "weight": 5,
      "rationale": "Init options object lists `defaultTracking: { ... }` with no comments. The next dev will not know what these flags toggle.",
      "evidence_path": "app/AmplitudeProvider.tsx",
      "evidence_line_start": 12
    }
  ],
  "free_form": "Overall the integration is correct but the setup report doesn't acknowledge the pre-existing analytics-browser package."
}
```

`evidence_path` and `evidence_line_start` are required — a judge verdict without a citation is treated as a flake and discarded.

**Cost (revised — unlimited budget):** This used to be the layer we throttled hardest because of token spend. With the constraint relaxed, the cost shape is:

- **Wall-clock** still matters. Judge calls with a structured rubric land in the 30-90 second range; running them on every PR adds noticeable minutes.
- **Variance** still matters. A judge with a 2% false-positive rate that runs on every PR is a reliability tax on the team. Promote to PR gate only when its variance is measured and acceptable.
- **Triage cost** still matters. Every judge fail is a human looking at a verdict; running judge on every PR also means triaging judge flakes on every PR.

So the policy below treats unlimited budget as an opportunity to run judge more frequently in nightly and pre-release (no more 10% sampling), not as a license to put it on every PR.

### How the layers compose

The seven layers do not run in lockstep. Per scenario, the runner short-circuits as soon as a hard fail lands, but otherwise lets cheap layers complete before expensive ones start. Concretely:

1. Layers 0-2 always run. They are deterministic and fast; the marginal cost of running them is rounding error on top of fixture setup.
2. Layer 3 (build) runs unless Layer 0 short-circuited the scenario. A hard fail at Layer 0 means we already know the integration is broken; running build wastes CI minutes.
3. Layer 4 (runtime) runs only on rings that opted in (nightly Ring 2, always Ring 3) and only if Layer 3 passed. A failed build cannot boot.
4. Layer 5 (ingestion) requires Layer 4. It also requires the eval-only Amplitude project (open decision).
5. Layer 6 (judge) runs in parallel with Layer 4 when both are scheduled. The judge does not depend on the runtime probe; it scores against `runLog` and `fsSnapshot.diff`.

Every layer's verdict is recorded in the report, including for short-circuited runs (with an explicit "skipped: upstream hard fail" status). This matters for triage — engineers reading a failure report should not have to guess why Layer 4 didn't produce a result.

## Three-ring framework stratification

We don't run every framework on every PR. Three rings, picked by rough order of customer impact and skill churn rate. PR-gate the high-volume / high-risk frameworks; nightly the long tail.

### Ring 1 — PR gate (~7 scenarios, target < 8 minutes wall-clock)

The frameworks that gate every PR. This list is finalized for Phase 1:

1. **React Router 7, framework mode (vanilla)**
2. **React Router 7, data mode (vanilla)**
3. **Next.js App Router (vanilla)**
4. **Next.js App Router with pre-existing `@amplitude/analytics-browser`** — exercises "augment, don't replace." This is also the canonical scenario for catching SDK-major coexistence regressions during a `@amplitude/unified` migration.
5. **React + Vite (vanilla)**
6. **Expo (vanilla)**
7. **Generic / unknown-framework probe** — a stripped-down React + Vite fixture with framework markers removed (no `vite.config.ts`, no React-specific package.json signals, plain `index.html`). The scorer here asserts the agent does *not* invent a framework, does *not* hardcode the wrong env var prefix, and falls through to the generic skill cleanly.

**Rationale.** Wizard run-volume telemetry shows the top three customer frameworks, in order, are React Router, Generic, and Next.js. The Ring 1 list above doubles down on those:

- React Router 7 has two distinct modes (framework / data) that exercise different init surfaces, so both ride the PR gate.
- Generic is #2 by volume, and a regression there silently affects the long tail of unsupported frameworks. The probe scenario is the only way to catch agent overreach on detection-failure paths.
- Next.js gets two scenarios because the App Router server/client boundary is the highest-blast-radius failure mode in the suite. The pre-existing-vendor variant catches the "wrap, don't replace" regression class explicitly.
- React + Vite and Expo round out the top frameworks the wizard sees in production runs.

Vue 3, Node server, and the hostile-TS-strict scenario moved to Ring 2. They are real but lower-volume; Ring 2 catches them on the next nightly without slowing the PR loop.

### Ring 2 — Nightly on main (full grid)

Every supported framework × variant. Variants per framework: vanilla starter, pre-existing-vendor, hostile (TS strict, monorepo, weird tooling). Full Layer 0-6 coverage with judge at 100% (see CI gating below). Two seeds per scenario for variance tracking.

We do not enumerate every framework version up front. Add a version-specific scenario only when a real regression motivates it.

### Ring 3 — Pre-release (gates `npm publish`)

Ring 2 plus Layer 5 (runtime ingestion against the eval-only Amplitude project) plus an Opus-as-judge bake-off if and only if Opus's verdicts on a held-out set materially beat Sonnet's. We don't preemptively spend Opus tokens — we measure first.

Run before any version bump that touches `commandments.ts`, `skills/integration/`, the model selection, the SDK package versions, or the wizard tools surface. A clean Ring 3 run is a release blocker artifact; we don't ship without it.

## CI gating strategy

Updated for unlimited Anthropic budget plus flag-gated CI.

### Default PR

Layers 0-3 only on Ring 1 scenarios. No LLM judge by default. Target: under 8 minutes of wall-clock.

```yaml
# .github/workflows/evals-pr.yml (sketch)
on:
  pull_request:
    paths:
      - 'src/lib/commandments.ts'
      - 'src/lib/agent-events.ts'
      - 'src/frameworks/**'
      - 'skills/integration/**'
      - 'src/lib/wizard-tools.ts'
jobs:
  evals-pr:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm eval --ring=1 --layers=0,1,2,3
```

### Opt-in full PR

Trigger Layers 0-6 (including LLM judge) on Ring 1 by either:

- Adding the label `evals:full` to the PR.
- Including the literal trigger phrase `[evals]` in the PR description or in a comment.

The workflow watches for both and re-runs Ring 1 with judge enabled. Use this when you've changed the prompt, a skill, or anything else where taste signals matter.

### Nightly

Full Ring 2, Layers 0-6, **LLM judge at 100% of scenarios** (no sampling — budget allows). Two seeds per scenario for variance tracking. A scenario whose two seeds disagree by more than 10 points gets flagged as non-deterministic in the report and the prompt is treated as under-constrained for that case.

```yaml
# .github/workflows/evals-nightly.yml (sketch)
on:
  schedule:
    - cron: '0 7 * * *'   # 07:00 UTC
  workflow_dispatch: {}
jobs:
  evals-nightly:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm eval --ring=2 --layers=0-6 --seeds=2 --judge=sonnet
```

### Pre-release

Ring 3 — adds Layer 5 ingestion and runs an Opus-judge bake-off against Sonnet on a held-out subset. If Opus's pass-rate on the held-out set tracks Sonnet's within noise (defined as < 3 points absolute on the aggregate), stay on Sonnet to keep judge cost bounded; otherwise promote Opus for pre-release runs. Re-measure quarterly.

### What "unlimited budget" doesn't unlock

Saying spend is no longer a constraint does not mean we run everything everywhere. The remaining real costs:

- **Wall-clock.** A PR that waits 25 minutes for evals is a PR engineers route around. Keep PR rings under 8 minutes; opt-in full runs under 20.
- **CI minutes.** GitHub Actions concurrency caps still apply. Long evals on every PR push during a busy day will queue.
- **Triage cost.** Every fail is a human reading a report. A noisy judge that flags 1 of 10 scenarios spuriously is a daily tax we will not absorb just because we can pay for the inference.
- **Anthropic-side throughput limits.** "Unlimited budget" is not "unlimited rate." Nightly runs that try to fan out 60 scenarios × 2 seeds × judge calls all in parallel will hit rate limits anyway. Stagger.

### Triage workflow

A failed eval run produces a report under `evals/reports/<run-id>/`. The expected workflow:

1. CI uploads the report directory as a workflow artifact.
2. The PR comment summarizes pass / fail per scenario and per criterion, links to the artifact, and surfaces the first hard fail with the offending file path and a 5-line context window.
3. Engineer reads the per-scenario JSONL, locates the failing criterion, decides whether the failure is a real regression or a scorer flake.
4. Real regression → fix the prompt / skill / framework config and re-run.
5. Scorer flake → file under `evals/known-flakes.md` with the run ID. Three flakes for the same scorer in a quarter demote it to warn-only until reviewed.

The point of a documented workflow is that engineers shouldn't be inventing it on their own when the suite first goes red. Write the runbook before the first regression, not after.

## Phasing

### Week 1

- Stand up `evals/` directory, runner skeleton, contract assertions.
- Implement Layer 0 + Layer 1 scorers for Ring 1 scenarios 1, 3, and 5 (React Router 7 framework mode, Next.js App Router vanilla, React + Vite vanilla).
- Wire one fixture end-to-end: spawn wizard with `--agent --yes`, capture artifact, run scorers, write a JSONL report.
- Land the negative-control PR (one scenario, one deliberate regression introduced into commandments) and confirm the suite catches it.

### Month 1

- All seven Ring 1 scenarios passing on `main`, gated by Layers 0-3 on PRs.
- Layer 0 + 1 + 2 scorers cover all 19 criteria.
- Nightly workflow running Ring 2 on a subset of frameworks (start with whichever skill changed in the last 30 days).
- LLM judge prototype against the rubric, with variance measurements after the first 20 nightly runs.

### Month 2-3

- Ring 2 covers the full framework × variant grid.
- Layer 4 runtime probe stable for browser frameworks.
- Judge variance measured per scenario; any scenario with > 10-point seed-to-seed variance flagged for prompt or skill tightening.
- Opt-in full PR workflow live (`evals:full` label + `[evals]` trigger phrase).

### Quarter 1

- Ring 3 gating real `npm publish` calls.
- Layer 5 ingestion verification against the eval-only Amplitude project.
- Opus bake-off completed and a decision recorded on whether to promote Opus for judge in pre-release.
- Negative-control scenarios re-baselined quarterly to prevent the suite from drifting toward "always passes."
- Sustained pass-rate per Ring 1 scenario tracked over time. The dashboard lives in the same Amplitude project the wizard already writes to (group `'org id'`, event family `wizard_eval_*`). When a scenario's pass-rate dips below 95% over a rolling 7-day window, the report routes to the BA team's Slack channel.

### What "done" looks like

Phase 1 is done when:

- A real regression PR (introducing a known failure mode from the table above) reliably fails the suite at the layer the table predicts.
- A clean PR that only touches docs or unrelated code reliably passes in under 8 minutes.
- The suite has caught at least one regression that was not seeded by hand — ideally during a routine prompt-tuning PR.
- Every framework with a `FrameworkConfig` has a Ring 2 scenario.

Phase 1 is *not* done because we shipped the harness. It is done when the team trusts the harness enough to gate merges on it without overrides.

## Adding a new scenario

The most common change to the suite will be adding a scenario. The flow:

1. **Create the fixture.** Under `evals/fixtures/<name>/pristine/`, drop a real, lockfile-pinned framework starter. Run the framework's own `create-*` CLI for vanilla starters; hand-curate hostile / pre-existing-vendor variants. Verify the fixture builds standalone (`pnpm build` in `pristine/` exits 0). Commit the lockfile.
2. **Write the scenario file.** Under `evals/scenarios/<name>.scenario.ts`, define the `Scenario` object with ring assignment, expected SDK package, expected env prefix, expected init file, expected events, and forbidden paths. The runner consumes this declaratively — no scorer changes should be required.
3. **Run it locally.** `pnpm eval --scenario=<name> --layers=0,1,2,3` should complete and emit a report.
4. **Add it to the ring's nightly grid.** If Ring 2, add it to the nightly workflow's matrix. Ring 1 additions need a BA-lead sign-off because they slow the PR loop.
5. **Run twice with different seeds and compare.** Variance > 10 points means the scenario is non-deterministic and the prompt or skill is under-constrained for this case. Tighten before merging.

Scenarios are cheap to add. The expensive part is fixture maintenance — when a framework releases a new major, the lockfile in `pristine/` needs a planned bump. Decision #8 (fixture ownership) covers who owns this.

## Adding a new scorer

Less common, but inevitable when a new failure mode surfaces. The flow:

1. **Update the 19-point table first.** If the new failure mode is a new criterion, add a row. If it's a refinement of an existing criterion, update the row's notes. The criterion outlives the specific scorer implementation.
2. **Pick the cheapest layer that catches it.** A failure that's visible in `runLog` belongs in Layer 1. A failure that requires AST inspection belongs in Layer 2. A failure that only shows up at runtime belongs in Layer 4. Resist the temptation to put it in Layer 6 — judge slots are expensive in human triage cost, even with unlimited inference budget.
3. **Implement against the artifact, not the live filesystem.** Scorers consume the artifact JSON. They never re-run the wizard or touch `working/`. This is what lets the suite re-score historical runs.
4. **Add a regression test.** Under the scorer's `__tests__/` directory, commit a fixture artifact JSON that exercises the failure mode. The scorer should fail on that artifact and pass on a clean one.
5. **Run on the full Ring 2 once before enabling.** Confirm it doesn't false-positive on existing scenarios. > 2% false-positive rate → demote to warn-only and refine before promoting.

## Failure modes the suite must catch

These are the regressions we have either seen in the wild or have a high prior of seeing as we iterate on prompts and skills. Each maps to the scorer layer that catches it cheapest. If a row is "Layer 6," it means we believe only the judge will reliably catch this — try harder before accepting that.

| # | Failure mode | Caught by |
|---|--------------|-----------|
| 1 | Hardcoded API key in source | Layer 0 (criterion 8) |
| 2 | Build-config bridging (`next.config.js`, `vite.config.ts`) used to inject secrets | Layer 0 (criterion 10) |
| 3 | Wrong SDK package family (`@amplitude/analytics-browser` instead of `@amplitude/unified` for browser frameworks) | Layer 0 (criterion 1) |
| 4 | Multiple `init()` calls in the same project | Layer 0 (criterion 6) |
| 5 | Init in module scope of a Server Component (App Router) | Layer 1 + Layer 4 (criterion 11) |
| 6 | Browser SDK imported into a server-only file | Layer 2 (criterion 11) |
| 7 | Server SDK in a browser file | Layer 2 (criterion 12) |
| 8 | Project-local re-export wrapper (`lib/amplitude.ts` exposing `track`) | Layer 1 (criterion 5) |
| 9 | Wrong env var prefix (`PUBLIC_*` instead of `NEXT_PUBLIC_*` etc.) | Layer 2 (criterion 9) |
| 10 | Two SDK majors coexisting after a "pre-existing vendor" run | Layer 0 + Layer 2 (criterions 1, 6) |
| 11 | Missing flush in serverless / API route | Layer 2 (criterion 12) — AST check for `await flush()` in detected serverless handlers |
| 12 | Approved event in plan has no corresponding `track()` call | Layer 1 (criterion 13) |
| 13 | `track()` call exists but uses wrong event name vs the plan | Layer 1 (criterion 13) |
| 14 | Init options object missing comments for togglable fields | Layer 2 (criterion 7) |
| 15 | Build / typecheck breaks after the run | Layer 3 (criterion 18) |
| 16 | App boots but throws an uncaught exception in the page console | Layer 4 |
| 17 | Re-run produces a noisy diff (non-idempotent) | Layer 1 (criterion 16) — diffs `file_change_applied` sets across two consecutive runs |
| 18 | `setup_complete` claims files the agent didn't actually write | Layer 1 (criterion 19) |
| 19 | Generic-fallback path invents a framework when markers are absent | Layer 1 + Layer 2 on the Generic probe scenario |
| 20 | Setup report reads as low-quality / unhelpful to a senior engineer | Layer 6 |

If a scenario fails for a reason this table doesn't predict, that's a finding — add the row, then update the scorer.

## Decisions resolved and decisions still open

### Resolved

- **Top frameworks for Ring 1 (decision #1).** Wizard run-volume telemetry confirms React Router, Generic, and Next.js as the top three customer frameworks. Ring 1 is finalized as the seven scenarios above.
- **Judge model and cadence (decision #3).** Unlimited Anthropic budget removes the spend constraint. Sonnet stays the default judge; Opus enters via the pre-release bake-off only if it earns the slot. Judge runs at 100% of nightly scenarios, not 10%.
- **CI gating shape.** Default PR is Layers 0-3 on Ring 1. Opt-in full PR via `evals:full` label or `[evals]` trigger phrase. Nightly is full Ring 2 with Layers 0-6 and judge at 100%. Pre-release is Ring 3 with ingestion.

### Implemented as of 2026-05-08

- Layers 0–4 + 6 wired and tested (122 scorer tests). Layer 5 is the only deferred piece, blocked on decision #2 (eval-only Amplitude project).
- Ring 1 scenarios fully shipped: `nextjs-app-router/vanilla`, `nextjs-app-router/pre-existing-vendor`, `react-router-7/framework`, `react-router-7/data`, `react-vite/vanilla`, `expo/vanilla`, `generic/probe`. Each carries a lockfile-pinned pristine fixture and a hand-authored golden.
- PR gate runs `.github/workflows/evals-pr-scenarios.yml` (Layers 0–3, Ring 1 matrix). Nightly Ring 2 runs `.github/workflows/evals-nightly.yml` (Layers 0–6, two seeds per scenario, Playwright installed for Layer 4, Sonnet judge for Layer 6, plus a separate variance-summary job that flags any scenario whose seed-to-seed score spread exceeds 10).
- Layer 0 `correct-sdk-package` now hard-fails on stale-legacy-SDK coexistence (failure mode #10 from the table) — a `pre-existing-vendor` run that leaves both `@amplitude/unified` and `@amplitude/analytics-browser` in `package.json` is graded as broken.

### Still open

- ~~**Decision #2 — eval-only Amplitude project.**~~ **Resolved 2026-05-08.** The wizard is invoked with `--no-telemetry` in eval mode, so synthetic runs never reach the prod analytics project. End-to-end ingestion verification is now explicitly owned by `e2e-tests/`, not the eval suite. See "Layer 5" above.
- **Decision #4 — naming convention enforcement.** Criterion 15 (Title Case events, snake_case properties or the lowercase-with-spaces variant the wizard already enforces internally) is currently soft / warn-only. Open question: do we promote it to medium (5 pts) for runs targeting projects we own, and keep it warn-only for customer projects? Needs a call from BA leads.
- **Decision #5 — negative-control ownership.** The suite needs a deliberate-regression PR every quarter to confirm scorers haven't decayed into "always pass" mode. Open: who on the eng-manager side owns scheduling these and reviewing the resulting reports.
- **Decision #6 — context-hub coupling.** Skills are pulled from `amplitude/context-hub` via `pnpm skills:refresh`. Open: when the eval suite finds a skill regression, is the fix made in this repo (and propagated upstream) or required to land in context-hub first? Affects PR latency materially.
- **Decision #7 — contract versioning.** The runner asserts `v: 1` today. When `agent-events.ts` bumps to `v: 2`, do we run both versions of the runner in parallel during the cutover, or deprecate `v: 1` runs immediately? Probably the former, but no one has signed up to maintain the dual-version path.
- **Decision #8 — fixture ownership.** Recommendation stands: hybrid approach — vanilla starters scaffolded from the framework's own `create-*` CLI and pinned by lockfile in `evals/fixtures/`; hostile / pre-existing-vendor variants hand-curated and committed. Needs sign-off from BA leads on who owns lockfile bumps when a framework releases a new major.

## Sidebar: skill / detector drift

This is not part of the eval framework, but the design surfaced it and it's worth recording.

`skills/integration/` has 32 skills today. `src/lib/constants.ts` `Integration` enum has 18 entries (as of writing — earlier note said 17; recount yourself before citing). The delta:

- Skills exist for Astro (hybrid, SSR, static, view-transitions), SvelteKit, Nuxt (3.6 and 4), TanStack Router (file-based and code-based), TanStack Start, Angular, Laravel, Ruby, Ruby on Rails, plus the React Router 6 / 7-declarative variants.
- None of those frameworks have a corresponding entry in the `Integration` enum, which means the wizard's framework detector will never select them. The user lands on `Integration.generic` and the agent loads the generic skill instead of the framework-specific one.

This probably explains a meaningful chunk of why "Generic" is the #2 framework by run volume. Users running the wizard against Astro, SvelteKit, Nuxt, or Angular projects today are routing through the generic path because the detector doesn't know those frameworks exist, even though we have skills for them.

This is a separate workstream from the eval framework. Two recommendations:

1. **Audit the gap.** Treat `skills/integration/` as the canonical list of "frameworks we claim to support." Anything in that directory needs a detection entry, a `FrameworkConfig`, and a Ring 2 scenario.
2. **Bridge the gap in the meantime.** The generic detection path should sniff for framework-distinguishing dependencies (`astro`, `@sveltejs/kit`, `nuxt`, `@angular/core`, `@tanstack/router`, etc.) before falling through to `Integration.generic`. Even if we don't have an enum entry, we can route to the right skill by name.

The eval framework will surface this drift when nightly Ring 2 starts producing low scores on the Generic probe scenario for inputs that obviously look like a known framework. That's the eval doing its job. But the fix lives in `src/lib/constants.ts`, the detector, and `FRAMEWORK_REGISTRY` — not in the eval suite.
