# Wizard SDK-integration evals

This directory holds the SDK-integration eval suite for `@amplitude/wizard`. The full design lives in [`docs/evals.md`](../docs/evals.md). Read that first if you're new to this work — the design rationale (why NDJSON, why the layered scorer stack, why three rings) is there, and this README assumes you've seen it.

## What "Week 1" ships

The Week 1 deliverables are scoped narrowly so the framework can land before scorers and scenarios fan out:

- **Runner skeleton** — spawns `amplitude-wizard --agent --yes` against a fixture, captures the NDJSON stream, walks the post-run filesystem, and produces a structured artifact. Also supports replaying a pre-recorded artifact (see [Source modes](#source-modes) below).
- **Contract assertions** — every NDJSON line is `v: 1`, exactly one terminal `run_completed`, `setup_complete` matches the outcome, and the process exit code agrees with `run_completed.outcome`. See [`runner/parse-stream.ts`](./runner/parse-stream.ts).
- **Layer 0 hard-fail scorers** — secrets, wrong package, multiple init, build-config bridging. Any hit short-circuits the scorer stack.
- **Layer 1 structural scorers** — file-touched, import-present, init-call-present, env-var-prefix, setup-complete-shape, exit-code-matches-outcome, confirmed-events-tracked.
- **One Ring 1 fixture** — `scenarios/nextjs-app-router/vanilla/`, modelled on `e2e-tests/test-applications/nextjs-app-router-test-app/`.
- **One green end-to-end test** — runs the full pipeline against the fixture's golden artifact and asserts every Layer 0 + Layer 1 scorer passes.

What the spec describes that Week 1 explicitly does **not** ship: Layer 2 (static SDK rules), Layer 3 (build), Layer 4 (runtime probe), Layer 5 (ingestion), Layer 6 (LLM judge), the seed-variance harness, the CI workflow files, and the second-through-seventh Ring 1 scenarios.

## Quick start

```bash
# Run the Vitest end-to-end test for the framework. This is the
# Week 1 green run.
pnpm test evals/scorers/__tests__/runner.test.ts

# Score a scenario via the CLI (golden replay by default).
pnpm evals:run nextjs-app-router/vanilla

# Score it against a real wizard run (requires AMPLITUDE_EVAL_API_KEY).
AMPLITUDE_EVAL_API_KEY=… pnpm evals:run nextjs-app-router/vanilla --live
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

## Known gaps and Week 2 candidates

These are intentional Week 1 omissions, not bugs:

- **No Layer 5 (ingestion verification).** The eval-only Amplitude project is unprovisioned (decision #2 open in the spec). Until it lands, every scenario stays at Layer 3 in PR rings.
- **Wizard-side `WIZARD_OAUTH_TOKEN` reading is a follow-up PR.** The runner forwards the env var to the wizard child today, but the wizard doesn't read it yet — live runs need either the wizard-side wiring or the explicit `EVALS_ALLOW_API_KEY_BYPASS=1` opt-in. Once the wizard-side lands, gateway-routed live evals work in CI without the bypass.
- **AST-based init counting.** Layer 0's `single-init-call.ts` uses regex; it can false-positive on commented-out callsites. AST inspection moves it to Layer 2 in Week 2.

### Week 2 priorities

In rough order:

1. **Layer 2 static scorers.** The seven criteria the spec lists (2, 3, 7, 9, 11, 12, 15). `@typescript-eslint/parser` is already in the repo; lift it for the AST passes.
2. **Three more Ring 1 scenarios.** React Router 7 (framework + data modes), React + Vite. Each follows the nextjs scaffold; the framework is ready.
3. **Layer 3 build runner.** Run `pnpm build` (or the scenario's `buildCommand`) inside `working/` after a live run; capture stderr tail; gate on exit code.
4. **CI workflow.** `.github/workflows/evals-pr.yml` per the spec sketch — paths-filtered, Ring 1 only, Layers 0–3, `< 8 minutes` budget.
5. **Negative-control PR.** Land a deliberate regression in a scratch branch and confirm the suite catches it at the layer the spec predicts.

## References

- [`docs/evals.md`](../docs/evals.md) — full spec.
- [`src/lib/agent-events.ts`](../src/lib/agent-events.ts) — wire-format authoritative source.
- [`src/lib/exit-codes.ts`](../src/lib/exit-codes.ts) — exit-code → outcome mapping.
- [`src/ui/agent-ui.ts`](../src/ui/agent-ui.ts) — emitter, the single writer of NDJSON.
