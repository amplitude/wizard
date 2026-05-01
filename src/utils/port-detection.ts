/**
 * Port detection — uses `lsof` to check whether a local TCP port is bound,
 * and (optionally) whether the bound process is running out of the user's
 * project directory. Used by the data-ingestion screen to point users at the
 * URL where *their* dev server is actually running, not a hardcoded default
 * and not someone else's service that happens to sit on :3000.
 *
 * Why cwd-match: without it we'd treat any listener on a candidate port as
 * "the user's app" — Docker, a sibling project's dev server, whatever — and
 * send them to a URL that has nothing to do with the wizard run.
 */
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const LSOF_TIMEOUT_MS = 500;

export interface DetectBoundPortOptions {
  /**
   * When provided, a port only counts as "bound" if the listening process's
   * cwd equals this directory or is a descendant of it. Mismatches are
   * rejected so we don't point at an unrelated service on a shared port.
   */
  cwd?: string;
}

/**
 * Returns the first port from `candidates` that passes all checks. Returns
 * null if none do or `lsof` is unavailable.
 */
export async function detectBoundPort(
  candidates: readonly number[],
  options: DetectBoundPortOptions = {},
): Promise<number | null> {
  for (const port of candidates) {
    const pid = await getListeningPid(port);
    if (pid === null) continue;
    if (options.cwd !== undefined) {
      const procCwd = await getProcessCwd(pid);
      if (procCwd === null) continue;
      if (!isSameOrDescendant(procCwd, options.cwd)) continue;
    }
    return port;
  }
  return null;
}

/** PID of the process listening on `port`, or null if none. */
export function getListeningPid(port: number): Promise<number | null> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return Promise.resolve(null);
  }
  return runLsof(`lsof -iTCP:${port} -sTCP:LISTEN -P -n -Fp`).then((out) => {
    if (out === null) return null;
    // -Fp emits one "pNNNN" line per matching process.
    const match = out.match(/^p(\d+)/m);
    return match ? Number(match[1]) : null;
  });
}

/** Working directory of `pid`, or null if unknown. */
export function getProcessCwd(pid: number): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve(null);
  return runLsof(`lsof -p ${pid} -a -d cwd -Fn`).then((out) => {
    if (out === null) return null;
    // -Fn emits an "n<path>" line for the cwd fd.
    const match = out.match(/^n(.+)$/m);
    return match ? match[1] : null;
  });
}

/**
 * True if `child` equals `parent` or sits beneath it on disk. Both sides are
 * canonicalized via `fs.realpathSync` before comparison so symlinked install
 * dirs (common with macOS Conductor worktrees, iCloud Drive, Volumes) match
 * the canonical cwd that lsof reports for the listener.
 */
export function isSameOrDescendant(child: string, parent: string): boolean {
  const c = canonical(child);
  const p = canonical(parent);
  if (c === p) return true;
  const withSep = p.endsWith(path.sep) ? p : p + path.sep;
  return c.startsWith(withSep);
}

/** Resolve symlinks if the path exists; otherwise fall back to path.resolve. */
function canonical(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function runLsof(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = exec(
      command,
      { timeout: LSOF_TIMEOUT_MS },
      (error, stdout) => {
        // lsof exits 1 when no match — treat any non-zero exit or error as
        // "no information", distinct from "ran and produced output".
        if (error) {
          resolve(null);
          return;
        }
        resolve(stdout);
      },
    );
    child.on('error', () => resolve(null));
  });
}
