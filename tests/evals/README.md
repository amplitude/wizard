# Wizard Eval Harness

Minimal scaffold for gating prompt changes against a known-good checklist.

## Why

Bet 2's three-phase pipeline (Planner → Integrator → Instrumenter) and
the weekly remark-feedback loop will both produce prompt edits. Without
a harness, any regression ships silently until a user hits it. The
assertions here are the guardrails: `confirm_event_plan` before any
`track()` write, no API keys in committed files, expected events emitted.

## How a fixture works

A fixture is a JSON file under `fixtures/` describing:

1. **Mocked SDK stream** — a synthetic sequence of `assistant` / `result`
   messages the SDK would emit for this integration.
2. **Assertions** — per-fixture checks (`called-tool-before`,
   `emitted-event`, `no-secret-leakage`, `final-outcome`).

The runner feeds the mocked stream through `runAgent`, collects the
observed tool-call sequence + emitted events + file writes, and runs the
assertions via `assert.ts::evaluateAssertions`.

Assertion logic is pure and unit-tested in
`src/lib/__tests__/eval-harness.test.ts` — the fixture runner itself
is still stub-shaped (wiring will land with the three-phase pipeline
when we have stable per-phase JSON handoffs to mock).

## Adding a fixture

1. Create `fixtures/<id>-<description>.json` matching the `EvalFixture`
   shape from `types.ts`.
2. Start the `assertions` array with at least:
   - `{ "kind": "final-outcome", "expected": "success" }`
   - `{ "kind": "called-tool-before", "toolName": "confirm_event_plan", "beforeToolNames": ["Write", "Edit"] }`
     (guarantees the plan-confirm step happens before any instrumentation)
   - `{ "kind": "no-secret-leakage", "forbiddenStrings": ["<seeded api key>"] }`
3. Run `pnpm test` — harness tests will fail loudly on bad shapes.

## Not in scope yet

- Real SDK replay — stubbed until Bet 2's three-phase pipeline lands.
- Running fixtures in CI — will wire once the runner has a stable contract.
- Per-framework coverage — seeding one fixture per entry in
  `FRAMEWORK_REGISTRY` comes after the three-phase pipeline.
