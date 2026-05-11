/**
 * display-path — single source of truth for relativizing absolute ledger
 * paths against the install dir for display in the TUI.
 *
 * Three components used to ship near-identical copies of this logic with
 * divergent fallback behavior (Bugbot #6 on PR #599): `DiffViewer` returned
 * `raw` for out-of-project paths while `FileWritesPanel` returned
 * `path.basename(raw)`, so the same file rendered differently in the outro
 * summary vs. the live-write panel. Funneling everyone through this helper
 * keeps the fallback consistent.
 *
 * Behavior:
 *   - When `raw` lives under `installDir` (path-segment boundary, not a
 *     prefix-string match), returns the project-relative path. `path.sep`
 *     is used as the boundary check so this works on Windows where ledger
 *     paths use `\`.
 *   - When `raw` is absolute but outside `installDir`, returns
 *     `path.basename(raw)`. Skill installs occasionally touch tmp dirs and
 *     the basename is the meaningful tail.
 *   - When `raw` is already relative (no `installDir`, or POSIX-style
 *     unit-test fixtures), returns `raw` unchanged.
 */

import path from 'path';

export function displayPath(raw: string, installDir?: string): string {
  if (
    installDir &&
    raw.startsWith(installDir) &&
    (raw.length === installDir.length || raw[installDir.length] === path.sep)
  ) {
    const rel = path.relative(installDir, raw);
    return rel === '' ? path.basename(raw) : rel;
  }
  return path.isAbsolute(raw) ? path.basename(raw) : raw;
}
