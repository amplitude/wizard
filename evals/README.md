# Wizard Eval Suite

This directory holds the SDK-integration eval suite for `@amplitude/wizard`.
The full design spec lives in [`docs/evals.md`](../docs/evals.md) — read it
before changing anything in here. This README is a contributor quick-start;
the spec is the source of truth.

## Layout

```
evals/
  bin/run-eval.ts          # CLI entry — spawned by `pnpm eval`
  runner/
    index.ts               # spawns wizard, parses NDJSON, builds Artifact
    contract.ts            # envelope + version + outcome assertions
    fs-snapshot.ts         # walks fixture working/ dir, hashes files
    types.ts               # Artifact, Scenario, Scorer, ScorerResult
    scorer-registry.ts     # discovers + dispatches scorers per layer
  scenarios/<name>.scenario.ts   # declarative scenario definitions
  fixtures/<name>/
    pristine/              # lockfile-pinned starter, READ-ONLY
    working/               # git-ignored, recreated from pristine each run
  scorers/
    layer0-hard-fail/      # cheap deterministic gates (criteria 1, 6, 8, 10)
    layer1-structural/     # AST queries, runLog ↔ track() comparison
    layer2-static/         # SDK rules that don't need a build
    layer3-build/          # framework build / typecheck
    layer4-runtime/        # headless boot probe (nightly+)
    layer5-ingestion/      # real Amplitude ingestion (pre-release only)
    layer6-judge/          # LLM judge — rubric in ../rubrics/
  rubrics/
    judge-prompt.md        # canonical judge rubric
    rubric-version.txt     # bump when rubric semantics change
  reports/                 # git-ignored — per-run JSONL reports
```

## Running locally

```bash
pnpm eval --ring=1 --layers=0,1,2,3
pnpm eval --scenario=nextjs-app-router-vanilla --layers=0,1
```

`pnpm eval` is a thin wrapper around `tsx evals/bin/run-eval.ts`. It does
not need a build — the runner spawns the wizard binary out-of-process via
`pnpm try` (or a built `dist/bin.js` when `--use-built` is passed).

## Adding a scenario

See `docs/evals.md` § "Adding a new scenario". Short version:

1. Drop a real, lockfile-pinned starter under `fixtures/<name>/pristine/`.
2. Write a declarative `<name>.scenario.ts` under `scenarios/`.
3. `pnpm eval --scenario=<name> --layers=0,1,2,3` and inspect the report.

## Adding a scorer

See `docs/evals.md` § "Adding a new scorer". Short version:

1. Update the 19-point table in the spec first.
2. Pick the cheapest layer that catches the failure.
3. Implement against the artifact JSON, never against the live filesystem.
4. Commit a regression-test artifact under the scorer's `__tests__/`.
