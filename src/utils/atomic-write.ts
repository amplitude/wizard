/**
 * Atomic JSON file writes via temp-file + rename.
 *
 * writeFileSync is atomic for small files on POSIX, but NOT on Windows.
 * This utility ensures crash-safety on all platforms: if the process dies
 * mid-write, the original file is untouched (the temp file is orphaned).
 */

import { writeFileSync, renameSync, unlinkSync } from 'fs';

/**
 * Write a JSON object to a file atomically.
 *
 * 1. Writes to a temp file (same directory, PID-suffixed)
 * 2. Renames temp → target (atomic on all OSes)
 * 3. Cleans up temp on failure
 */
export function atomicWriteJSON(
  filePath: string,
  data: unknown,
  mode = 0o644,
): void {
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode });
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // Best-effort cleanup
    }
    throw err;
  }
}
