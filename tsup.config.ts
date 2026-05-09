import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

// All runtime `dependencies` are externalized — bundling them would inflate the
// CLI to >50 MB (Ink + React + Sentry + Anthropic SDK + axios + …) and break
// native modules (`xcode`, `node-pty` indirectly). Externals stay node-resolved
// at runtime via the user's `node_modules` (npm/pnpm/npx populate them from
// our published `dependencies`).
//
// What's bundled: every `src/**/*.ts` file plus `bin.ts` itself. That collapses
// 340+ source modules into one parse pass at cold start — the dominant win
// (see docs/build.md for measured numbers).
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const runtimeExternals = [
  ...Object.keys(pkg.dependencies ?? {}),
  // `@anthropic-ai/sdk` is listed as a devDependency today (used only by tests
  // and the proxy harness) but if it ever leaks into a bundled code path we
  // want the runtime resolution path, not a baked-in copy.
  '@anthropic-ai/sdk',
];

export default defineConfig({
  entry: { bin: 'bin.ts' },
  outDir: 'dist',
  format: ['cjs'],
  // The published bin entry is `dist/bin.js` (CJS). Keep that path stable so
  // existing global installs / npx invocations / shell aliases keep working.
  outExtension: () => ({ js: '.js' }),
  // Match `target: ES2022` from tsconfig.build.json. Node 20+ is the floor
  // (engines.node), and ES2022 covers everything we use (top-level-await is
  // never used in CJS, async iteration is fine).
  target: 'node20',
  platform: 'node',
  // No minify — readable stack traces beat byte savings here. The bundle is
  // already ~10× smaller than the unbundled tree because we drop all the
  // per-module CommonJS wrappers + sourcemap overhead from individual files.
  minify: false,
  sourcemap: true,
  // tsup emits `.d.ts` files via a separate tsc invocation in package.json's
  // `build` script — that path is also where strict type-checking lives,
  // and we don't want bundle-time errors masking it.
  dts: false,
  splitting: false,
  // Don't clean dist — we run `tsc --emitDeclarationOnly` after, and we want
  // both outputs to coexist. The `clean` script in package.json handles full
  // wipes between builds.
  clean: false,
  shims: false,
  external: runtimeExternals,
  // tsup automatically preserves the `#!/usr/bin/env node` shebang from
  // `bin.ts` because the entry is named like an executable — no banner
  // needed. (Setting one here would double-shebang the bundle.)
});
