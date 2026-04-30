/**
 * cross-platform-spawn — drop-in replacements for `child_process.spawn` and
 * `child_process.spawnSync` that resolve `.cmd` / `.bat` / `.ps1` shims on
 * Windows.
 *
 * **Why this exists**: Node's built-in `spawn('claude', ...)` does NOT
 * consult `PATHEXT` and does NOT resolve npm-installed binaries that ship
 * as `.cmd` shims (which is how npm/yarn/pnpm wire executable bins on
 * Windows). The result is a hard `ENOENT` for every Windows user the
 * moment the wizard tries to shell out to `claude`, `vercel`, `codex`, or
 * any other globally-installed Node CLI. The same call works fine on
 * macOS / Linux because POSIX binaries are unambiguous on `PATH`.
 *
 * `cross-spawn` does the right thing: on win32 it locates the matching
 * `.cmd` / `.bat` and arranges the right `cmd.exe` invocation with proper
 * argument quoting (avoiding the shell-injection footgun of `shell: true`).
 * On POSIX it's a passthrough to `child_process.spawn`. We import it
 * through this wrapper so:
 *
 *   1. The intent is obvious at every call site (`spawn` from this module,
 *      not from `child_process`).
 *   2. Future consolidation (logging, env scrubbing, sandboxing) lives in
 *      one place.
 *   3. Tests can assert by import path instead of monkey-patching globals.
 *
 * Use this **only for executables that may be `.cmd` shims on Windows**
 * (npm/yarn/pnpm globals: `claude`, `vercel`, `codex`, `npx`, etc.). For
 * binaries that are guaranteed to be present at a known absolute path
 * (e.g. `/usr/bin/security` on macOS), keep using `child_process` directly.
 *
 * `execSync` and `exec` from `child_process` route through `cmd.exe` on
 * Windows, which DOES consult `PATHEXT`, so those callers don't need this
 * wrapper. Only `spawn` / `spawnSync` (which spawn the binary directly,
 * no shell) hit the ENOENT bug.
 */

import crossSpawn from 'cross-spawn';
import type {
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
} from 'child_process';

/**
 * Cross-platform `child_process.spawn`. On Windows, resolves `.cmd` /
 * `.bat` shims correctly via `cross-spawn`. On POSIX, passes through.
 *
 * Typed as the full `child_process.spawn` so all the upstream overloads
 * (`SpawnOptionsWithStdioTuple`, encoding-bearing variants, etc.) flow
 * through unchanged — the wrapper is meant to be a true drop-in.
 */
export const spawn: typeof nodeSpawn =
  crossSpawn as unknown as typeof nodeSpawn;

/**
 * Cross-platform `child_process.spawnSync`. Same Windows shim handling
 * as {@link spawn}, with the full `child_process.spawnSync` overload
 * surface preserved (string vs Buffer return type when `encoding` is
 * passed, etc.).
 */
export const spawnSync: typeof nodeSpawnSync =
  crossSpawn.sync as unknown as typeof nodeSpawnSync;
