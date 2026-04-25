// Shared CLI context — values computed once at startup and consumed by every
// command module. Keeping these out of bin.ts lets each command file resolve
// invocation-style strings ("npx @amplitude/wizard" vs "amplitude-wizard")
// and the wizard version without re-deriving the logic per file.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { z } from 'zod';

/**
 * Dev mode toggle — when set (e.g. via `pnpm try` / `pnpm dev`), internal
 * flags like --local-mcp show up in --help. End users never see them.
 */
export const IS_WIZARD_DEV = process.env.AMPLITUDE_WIZARD_DEV === '1';

export const WIZARD_VERSION: string = (() => {
  // npm/pnpm set this when running via package scripts
  if (process.env.npm_package_version) return process.env.npm_package_version;
  // Fallback: read package.json relative to this file
  try {
    const pkg = z
      .object({ version: z.string().optional() })
      .passthrough()
      .parse(
        JSON.parse(
          readFileSync(
            resolve(dirname(__filename), '..', '..', 'package.json'),
            'utf-8',
          ),
        ),
      );
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

/**
 * How the user invoked this CLI — echoed back in help/error messages so we
 * don't tell `npx @amplitude/wizard` users to run `amplitude-wizard login`
 * (which only works when globally installed).
 *
 * npx stages packages under a cache path containing `/_npx/`. Everything
 * else is treated as a direct bin invocation.
 */
export const CLI_INVOCATION: string = (() => {
  const scriptPath = process.argv[1] ?? '';
  if (scriptPath.includes('/_npx/') || scriptPath.includes('\\_npx\\')) {
    return 'npx @amplitude/wizard';
  }
  // npm >= 7 implements `npx` as `npm exec`, which always sets
  // npm_command=exec — even when npx resolves to an already-installed copy
  // (e.g. running `npx @amplitude/wizard` from inside this repo, or from
  // a project that depends on it). argv[1] doesn't contain /_npx/ in that
  // case, so this catches it.
  if (process.env.npm_command === 'exec') {
    return 'npx @amplitude/wizard';
  }
  return 'amplitude-wizard';
})();
