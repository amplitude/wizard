/**
 * Correlation IDs for linking logs, Sentry events, and Amplitude analytics.
 *
 * - sessionId: stable across the entire CLI invocation (reuses analytics anonymousId)
 * - runId: new UUID per agent attempt (reset on stall-retry)
 */

import { v4 as uuidv4 } from 'uuid';

let _sessionId: string | null = null;
let _runId: string | null = null;
let _sessionStartMs: number | null = null;

/** Initialize with the analytics session ID. Call once at startup. */
export function initCorrelation(sessionId: string): void {
  _sessionId = sessionId;
  _runId = uuidv4().slice(0, 8); // Short for log readability
  _sessionStartMs = Date.now();
}

/** Get the session-level correlation ID. */
export function getSessionId(): string {
  return _sessionId ?? 'unknown';
}

/** Get the current run-level correlation ID. */
export function getRunId(): string {
  return _runId ?? 'unknown';
}

/**
 * Epoch-ms when this wizard session started. Used by the TUI Logs tab to
 * scope the live-tail to lines from the current session (the per-project
 * `log.txt` is append-only across runs, so without scoping users see
 * yesterday's runs above today's). Null until `initCorrelation` runs.
 */
export function getSessionStartMs(): number | null {
  return _sessionStartMs;
}

/** Create a new run ID (call on agent retry / stall recovery). */
export function rotateRunId(): string {
  _runId = uuidv4().slice(0, 8);
  return _runId;
}
