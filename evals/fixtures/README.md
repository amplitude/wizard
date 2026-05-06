# Fixtures

Each subdirectory is one fixture. The contract:

```
<fixture-name>/
  pristine/   # lockfile-pinned starter, READ-ONLY, committed
  working/    # scratch copy created at run-start, deleted after; .gitignored
```

The runner copies `pristine/` to `working/` at the start of every run and
diffs `working/` against `pristine/` to compute the artifact's filesystem
diff. Scorers consume the diff — they never re-read `pristine/`.

When a framework releases a new major (Vite 6, Next 15, Expo 51, etc.):

1. Regenerate `pristine/` using the framework's own `create-*` CLI.
2. Pin the lockfile.
3. Run `pnpm eval --scenario=<name> --layers=0,1,2,3` twice with different
   seeds and confirm the suite still passes.
4. Land the bump in its own PR — do not bundle with prompt or skill changes.

> Pristine fixtures are intentionally not in this commit. The first PR
> after the scaffold lands a single canonical fixture
> (`nextjs-app-router-vanilla`) end-to-end, then the rest follow as we
> stabilize the runner contract.
