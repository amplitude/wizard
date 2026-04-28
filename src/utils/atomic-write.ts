/**
 * Atomic JSON file writes via temp-file + rename.
 *
 * writeFileSync is atomic for small files on POSIX, but NOT on Windows.
 * This utility ensures crash-safety on all platforms: if the process dies
 * mid-write, the original file is untouched (the temp file is orphaned).
 */

import { writeFileSync, renameSync, unlinkSync, chmodSync } from 'fs';

/**
 * Options for {@link atomicWriteJSON}.
 *
 * `mode` is intentionally separate from the original positional arg: when
 * the caller specifies a mode, we re-assert it on the destination path
 * AFTER the rename, even if the destination already existed at a looser
 * mode (e.g. 0o644 from a previous version of the wizard, or from the
 * `ampli` CLI). Without this, `writeFileSync(tmp, ..., { mode })` only
 * applied to the temp file's creation; `renameSync` keeps the destination's
 * pre-existing mode in some kernels.
 */
export interface AtomicWriteOptions {
  /**
   * Numeric file mode (e.g. `0o600`). When provided, the destination is
   * `chmodSync`'d to this mode after the rename. When `undefined`,
   * existing-file modes are left untouched and new-file modes default to
   * the OS umask — preserving the previous behavior for callers that
   * don't care.
   *
   * On Windows, `chmodSync` is effectively a no-op (only the read-only
   * bit is honored). Callers that need POSIX-strict permissions should
   * still pass the mode explicitly so behavior is correct on macOS and
   * Linux, where credentials actually live.
   */
  mode?: number;
}

/**
 * Write a JSON object to a file atomically.
 *
 * 1. Writes to a temp file (same directory, PID-suffixed)
 * 2. Renames temp → target (atomic on all OSes)
 * 3. If `mode` is set, chmods the destination so a previously-existing
 *    file at a looser mode is tightened. Without this step, a stale
 *    `~/.ampli.json` created at 0o644 by an older wizard would silently
 *    keep that mode forever, leaking OAuth tokens to other local users.
 * 4. Cleans up temp on failure
 *
 * Backwards-compatibility shim: callers may still pass a numeric mode as
 * the third positional arg. New callers should pass `{ mode }`.
 */
export function atomicWriteJSON(
  filePath: string,
  data: unknown,
  modeOrOptions?: number | AtomicWriteOptions,
): void {
  const options: AtomicWriteOptions =
    typeof modeOrOptions === 'number'
      ? { mode: modeOrOptions }
      : modeOrOptions ?? {};
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    if (options.mode !== undefined) {
      writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', {
        mode: options.mode,
      });
    } else {
      writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    }
    renameSync(tmp, filePath);
    if (options.mode !== undefined) {
      // Re-assert the mode on the destination — covers the case where the
      // destination already existed at a looser mode prior to this write.
      chmodSync(filePath, options.mode);
    }
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // Best-effort cleanup
    }
    throw err;
  }
}
