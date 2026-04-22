/**
 * Port detection — uses `lsof -iTCP:PORT -sTCP:LISTEN` to check if a local TCP
 * port is bound. Used by the data-ingestion screen to point users at the URL
 * where their dev server is actually running, not a hardcoded default.
 */
import { exec } from 'child_process';

const LSOF_TIMEOUT_MS = 500;

/**
 * Returns the first port from `candidates` that has a LISTEN socket bound.
 * Returns null if none are bound or `lsof` is unavailable.
 */
export async function detectBoundPort(
  candidates: readonly number[],
): Promise<number | null> {
  for (const port of candidates) {
    if (await isPortBound(port)) return port;
  }
  return null;
}

/** True if something is listening on `port` locally. */
export function isPortBound(port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const child = exec(
      `lsof -iTCP:${port} -sTCP:LISTEN -P -n`,
      { timeout: LSOF_TIMEOUT_MS },
      (error, stdout) => {
        // lsof exits 1 when no match — treat any non-zero exit or error as "not bound"
        if (error) {
          resolve(false);
          return;
        }
        resolve(stdout.trim().length > 0);
      },
    );
    child.on('error', () => resolve(false));
  });
}
