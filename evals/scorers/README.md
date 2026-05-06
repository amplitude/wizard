# Scorer Layers

Each subdirectory holds the scorers for one layer of the evaluation stack.
A scorer covers exactly one row of the 19-point checklist in
[`docs/evals.md`](../../docs/evals.md). New scorers must:

1. Cite the criterion they cover in their module docstring.
2. Be registered in `evals/runner/scorer-registry.ts`.
3. Operate on the `Artifact` parameter only (no live filesystem access
   beyond reading files within `<fixture>/working/`).

| Layer | Catches | Cost |
|-------|---------|------|
| 0 hard-fail   | criteria 1, 6, 8, 10 | < 1s |
| 1 structural  | criteria 4, 5, 13, 14, 19 | seconds |
| 2 static      | criteria 2, 3, 7, 9, 11, 12, 15 | seconds |
| 3 build       | criterion 18 | 30s – 2min |
| 4 runtime     | criterion 17 + boot smoke | 1 – 3 min |
| 5 ingestion   | end-to-end | pre-release only |
| 6 judge       | taste signals | 30 – 90s per scenario |
