# Per-call-site eval registry

This directory implements the regression-prevention floor described in
[`MIGRATION_PLAN.md` §7.4](../../MIGRATION_PLAN.md). The end-to-end suite
in [`evals/scenarios/`](../scenarios/) is the **ceiling** test (does the
wizard succeed end-to-end?). This directory is the **floor**: every LLM
call in the wizard ships with a fixture, scorer, and (where applicable)
golden response, and a new call cannot land without them.

## Layout

```
evals/call-sites/
  registry.ts                 ← maps call-site IDs → fixture/scorer/golden
  types.ts                    ← CallSiteFixture, CallSiteArtifact, CallSiteScorer
  run-call-site.ts            ← `runCallSite` invocation mode (third path
                                alongside runLive / runReplay)
  propose-event-plan/
    fixture.json
    scorer.ts
  select-skill/
    fixture.json
    scorer.ts
  inner-loop-streamtext/
    fixture.json
    golden.ndjson
    scorer.ts
  __tests__/
    registry.test.ts          ← shape / artifact-existence checks
    propose-event-plan.test.ts
    select-skill.test.ts
    inner-loop-streamtext.test.ts
```

## How it shares with PR #560's runner

Per §7.4 alignment, both end-to-end scenarios and per-call-site fixtures
feed the **same** scorer surface from
[`evals/runner/types.ts`](../runner/types.ts). The only thing that
differs is the artifact source:

| Mode             | Module                           | Artifact source              |
|------------------|----------------------------------|------------------------------|
| `runLive`        | `evals/runner/invoke-wizard.ts`  | spawn the wizard binary      |
| `runReplay`      | `evals/runner/invoke-wizard.ts`  | load `golden/run.ndjson`     |
| `runCallSite`    | `evals/call-sites/run-call-site.ts` | one tool call (live, mock, or recorded) |

`runCallSite` builds a `CallSiteArtifact` — a narrower envelope than
`Artifact` — and hands it to a `CallSiteScorer`. When you need to run a
streaming call site through the runner's full layered scorer stack, lift
the scorer with `liftToRunnerScorer` from `types.ts` and feed it through
`score()`.

## Source modes

`runCallSite` accepts three sources:

1. **`mock`** — caller supplies an in-memory `mockInvoker`. **This is
   the unit-test path.** No live LLM calls. The scorer judges the
   artifact, not the model.
2. **`golden`** — load `recordedOutput` from the fixture (structured
   sites) or `golden.ndjson` (streaming sites). Useful for re-scoring
   recorded artifacts when you change a scorer.
3. **`live`** — invoke the LLM gateway via a caller-supplied
   `liveInvoker`. **Requires `WIZARD_OAUTH_TOKEN`** (per §7.5). The
   runner refuses to run live without it; there is no silent fallback
   to a default. Live mode is for re-recording goldens, not for unit
   tests.

### Live capture (re-recording a golden)

Streaming-site goldens (e.g. `inner-loop-streamtext/golden.ndjson`) need
to be regenerated whenever the prompt or model changes. The bundled
golden today is a smoke-shape recording; once §7.5 wizard-side
`WIZARD_OAUTH_TOKEN` plumbing lands, regenerate with:

```bash
WIZARD_OAUTH_TOKEN=…  WIZARD_ZONE=us  pnpm tsx \
  evals/call-sites/__tests__/record-golden.ts inner-loop-streamtext
```

(The `record-golden.ts` script is intentionally not bundled in this PR;
it lands paired with the §7.5 wizard-side wiring so it can call into
the same gateway-auth code path the production wizard uses.)

## Adding a call site

1. Pick a stable ID (snake_case, matches the source-code call name).
2. Create `evals/call-sites/<id>/`.
3. Drop `fixture.json` (see existing fixtures for shape).
4. Write `scorer.ts` exporting a default `CallSiteScorer`.
5. (Streaming sites only) drop `golden.ndjson`.
6. Append a `CallSite` entry to `registry.ts: CALL_SITES`.
7. Add the source-file glob to `CALL_SITE_SOURCE_GLOBS` so CI gates
   the suite when those files change.
8. Write a unit test under `__tests__/` proving the scorer passes on
   the fixture's `recordedOutput`.

## CI gating

`.github/workflows/evals-pr.yml` runs the call-site suites only when a
PR touches one of the source globs in `CALL_SITE_SOURCE_GLOBS`. This
keeps the per-call-site overhead off PRs that don't touch LLM code
while still catching prompt regressions on the PRs that do.

## See also

- [`MIGRATION_PLAN.md`](../../MIGRATION_PLAN.md) — §7.4 (this layout) and
  §7.5 (gateway auth for CI).
- [`evals/README.md`](../README.md) — PR #560's end-to-end runner.
- [`evals/runner/types.ts`](../runner/types.ts) — shared `Scorer` /
  `Artifact` shapes.
