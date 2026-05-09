# Build pipeline

## TL;DR

`pnpm build` runs two passes:

1. **`pnpm build:bundle`** — [`tsup`](https://tsup.egoist.dev) collapses
   `bin.ts` plus its entire `src/` graph into a single self-contained
   CommonJS file at `dist/bin.js`, with a sourcemap at `dist/bin.js.map`.
2. **`pnpm build:types`** — `tsc --emitDeclarationOnly` writes `.d.ts`
   files to `dist/bin.d.ts` and `dist/src/**/*.d.ts`.

Type checking still runs through `tsc` (either `pnpm build:types`, or
`pnpm exec tsc --noEmit` in CI) — tsup uses esbuild under the hood, which
does not type-check.

## Why tsup over plain esbuild

tsup is a thin wrapper around esbuild that:

- Preserves shebangs on entries that have them (no banner config needed).
- Reads `tsconfig.json` automatically and respects `target`, `jsx`, `lib`.
- Has zero-config defaults for the "Node CLI bundle" use case we want.
- Handles externals as a regular array — no esbuild-plugin boilerplate.

Esbuild is the engine in both cases. We chose tsup over hand-rolling an
esbuild script to keep the config under 30 lines and to track ecosystem
defaults (Node target updates, source-map flag changes, etc.) without
maintaining our own build script.

The tsup dependency is dev-only. It does not ship with the published
package. Downstream consumers (`npm i -g @amplitude/wizard`,
`npx @amplitude/wizard`) only see the pre-built `dist/bin.js`.

## What's bundled vs externalized

**Bundled into `dist/bin.js`:**

- Every `.ts` file under `src/` and `bin.ts` itself.
- Inline `await import(...)` calls into our own source — esbuild collapses
  them so the runtime cost is just lazy initialization, not module
  resolution.

**Externalized (resolved at runtime from `node_modules`):**

- All entries in `package.json` `dependencies`. They cover Ink + React,
  the Anthropic SDKs, axios, yargs, zod, ai (vercel ai-sdk), Sentry,
  Amplitude analytics SDKs, MCP SDK, and friends. Bundling them would
  inflate the published bundle to >50 MB and break native modules
  (`xcode`, transitive `node-pty` paths).
- Node built-ins (`node:fs`, `node:path`, etc.) are external by default
  on `platform: 'node'`.

Adding a new runtime dependency? Add it to `package.json` `dependencies`
as usual. tsup picks it up automatically because the `external` list is
generated from the package manifest at build time (see `tsup.config.ts`).

## Lazy-load conventions

Even with bundling, we defer heavy modules behind `await import(...)`
inside the call site — _not_ at module top-level. Cold-start paths
(`--version`, `status --json`, `manifest`) stay fast because the
externals only resolve when the relevant code path actually runs.

Current lazy-load callsites:

- `src/utils/urls.ts` — `axios` lazy-loaded inside
  `detectRegionFromToken` only; the synchronous URL helpers used
  everywhere never trigger the import.
- `src/utils/oauth.ts` — `axios` lazy-loaded inside the two HTTP
  exchange functions (`exchangeCodeForToken`, refresh).
- `src/lib/api.ts` — entire axios module + `apiClient` instance lazy-
  loaded. `getApiClient()` returns a cached promise; first GraphQL
  call pays the import cost, subsequent calls reuse the same client.
- `src/utils/environment.ts` — `fast-glob` lazy-loaded inside
  `detectEnvVarPrefix` (framework detection only; `--version` never
  reaches this code).
- `src/lib/observability/sentry.ts` — `@sentry/node` lazy-loaded
  inside `initSentry` (pre-existing).
- `bin.ts` — `dotenv`, `update-notifier`, `@anthropic-ai/claude-agent-sdk`
  (via `lazyRunWizard`), and `agent-ui` are all gated behind explicit
  dynamic imports (pre-existing).

When adding a new dependency:

- If it's only used in async code paths after the wizard starts running,
  prefer `await import('mod')` at the call site.
- If it's used in synchronous helpers that the cold-start path touches,
  expose a `loadX()` Promise getter at the top of the file so the static
  graph stays clean. See `src/lib/api.ts` for the canonical pattern.

## Adding a new entry point

The bundle is single-entry today (`bin.ts`). To add a second entry:

1. Add it under `entry` in `tsup.config.ts`:
   ```ts
   entry: { bin: 'bin.ts', 'mcp-server': 'src/lib/wizard-mcp-server.ts' }
   ```
2. Update `package.json` `bin` and / or `exports` to point at the new
   file.
3. Update the `files` glob in `package.json` if the new file lands
   outside `dist/bin.*` or `dist/src`.

Keep entries narrow — every additional entry is a separate bundle that
doesn't share parsed modules with the others.

## Sourcemaps

`dist/bin.js.map` ships with the package. Node only loads it when
`--enable-source-maps` is set or when an exception is captured by a
tool that resolves frames (Sentry, vitest, `node --enable-source-maps`).
Day-to-day execution does not pay the sourcemap cost.

We deliberately do not minify. Stack traces shipped to Sentry
(`src/lib/observability/sentry.ts`) and surfaced in the Error outro
need to point at recognizable function and variable names.

## Build determinism

Two consecutive `pnpm build:bundle` runs produce byte-identical
`dist/bin.js`. The full `pnpm build` is also deterministic except for
the `.tsbuildinfo` incremental cache (intentionally ignored by
`.gitignore`).

If you change tsup or esbuild versions and the bundle output shifts,
the diff is mostly cosmetic — variable mangling and helper inlining
order. Rebuild from a clean dist (`pnpm clean && pnpm build`) before
filing a regression.

## Published shape

```
dist/
├── bin.js          # tsup bundle, 2.3 MB, executable shebang preserved
├── bin.js.map      # sourcemap, 4.7 MB
├── bin.d.ts        # tsc-emitted declaration for bin.ts
└── src/
    └── **/*.d.ts   # declaration tree, IDE-only consumers
```

The `package.json` `bin` entry continues to point at `dist/bin.js`. The
`exports` field still references `dist/index.js`, which is a pre-existing
inconsistency (no `index.ts` source); that's tracked separately and out
of scope for the bundle migration.
