// Shared CLI context — values computed once at startup and consumed by every
// command module. Keeping these out of bin.ts lets each command file resolve
// invocation-style strings ("npx @amplitude/wizard" vs "amplitude-wizard")
// and the wizard version without re-deriving the logic per file.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';

/**
 * Dev mode toggle — when set (e.g. via `pnpm try` / `pnpm dev`), internal
 * flags like --local-mcp show up in --help. End users never see them.
 */
export const IS_WIZARD_DEV = process.env.AMPLITUDE_WIZARD_DEV === '1';

export const WIZARD_VERSION: string = (() => {
  // npm/pnpm set this when running via package scripts
  if (process.env.npm_package_version) return process.env.npm_package_version;
  // Fallback: read package.json relative to this file. After the TS build,
  // this file lives at dist/src/commands/context.js, so package.json sits
  // three levels up. Source-tree (tsx) execution resolves the same path
  // (src/commands/context.ts → repo root → package.json) when '..' is
  // doubled, but to keep both layouts working we walk up until we find one.
  try {
    let dir = dirname(__filename);
    for (let i = 0; i < 5; i += 1) {
      const candidate = resolve(dir, 'package.json');
      try {
        // Plain validation (no zod): we only need a single string field, and
        // pulling in zod just for `parse({version: z.string()})` adds 30–50 ms
        // of import time on every CLI launch — bin.ts → context.ts is on the
        // synchronous boot path. Keep startup lean by hand-rolling the check.
        const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf-8'));
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          typeof (parsed as { version?: unknown }).version === 'string' &&
          // An empty string is technically a string, but the previous
          // `if (pkg.version)` truthiness check skipped it and walked
          // up the tree; preserve that behavior so we don't propagate
          // an empty `WIZARD_VERSION` into Sentry release tags, the
          // update notifier, or analytics.
          (parsed as { version: string }).version.length > 0
        ) {
          return (parsed as { version: string }).version;
        }
      } catch {
        // not at this level — keep walking up
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
})();

/**
 * How we render the CLI back to users in help / error / outro text.
 *
 * Always `npx @amplitude/wizard`, regardless of how the current process
 * was invoked. The bare `amplitude-wizard` / `wizard` binaries only
 * exist when a user has explicitly run `npm install -g
 * @amplitude/wizard`; telling the rest of our users to "run
 * `amplitude-wizard login`" sends them to a command that doesn't
 * resolve. The npx form works for everyone — globally-installed users
 * included — so we standardize on it.
 *
 * For machine-readable argv hints (`resumeCommand: string[]`,
 * `loginCommand: string[]`, `suggestedAction.command`), pass the parts
 * through `normalizeCliCommand` from `src/lib/cli-display.ts` instead
 * of splitting this string.
 */
export const CLI_INVOCATION = 'npx @amplitude/wizard' as const;
