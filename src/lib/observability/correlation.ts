/**
 * Correlation IDs for linking logs, Sentry events, and Amplitude analytics.
 *
 * - sessionId: stable across the entire CLI invocation (reuses analytics anonymousId)
 * - runId: frozen for the entire wizard process — primary key linking
 *   `run started` → `step completed` → `run ended` in Amplitude
 * - attemptId: rotates on each agent retry so per-attempt logs stay distinct
 *
 * Two forms exist per id:
 *   - short (8 hex) — human-readable log prefix
 *   - full  — the underlying UUID-derived value used for W3C traceparent:
 *       runIdHex    = 32 hex chars (trace-id, 128 bits)
 *       attemptIdHex = 16 hex chars (parent-id, 64 bits)
 */

import { v4 as uuidv4 } from 'uuid';

let _sessionId: string | null = null;
let _runIdHex: string | null = null;
let _attemptIdHex: string | null = null;

function makeTraceId(): string {
  // 32 hex chars (128 bits) — strip dashes from a v4 UUID.
  return uuidv4().replace(/-/g, '');
}

function makeSpanId(): string {
  // 16 hex chars (64 bits) — first half of a UUID with dashes stripped.
  return uuidv4().replace(/-/g, '').slice(0, 16);
}

/** Initialize with the analytics session ID. Call once at startup. */
export function initCorrelation(sessionId: string): void {
  _sessionId = sessionId;
  _runIdHex = makeTraceId();
  _attemptIdHex = makeSpanId();
}

/** Get the session-level correlation ID. */
export function getSessionId(): string {
  return _sessionId ?? 'unknown';
}

/** Short, log-friendly run id (8 hex). Frozen after initCorrelation. */
export function getRunId(): string {
  return _runIdHex ? _runIdHex.slice(0, 8) : 'unknown';
}

/** Full 32-hex run id suitable for the W3C traceparent trace-id slot. */
export function getRunIdHex(): string {
  return _runIdHex ?? '0'.repeat(32);
}

/** Short, log-friendly attempt id (8 hex). */
export function getAttemptId(): string {
  return _attemptIdHex ? _attemptIdHex.slice(0, 8) : 'unknown';
}

/** Full 16-hex attempt id suitable for the W3C traceparent parent-id slot. */
export function getAttemptIdHex(): string {
  return _attemptIdHex ?? '0'.repeat(16);
}

/** Rotate the attempt ID (call on agent retry / stall recovery). */
export function nextAttemptId(): string {
  _attemptIdHex = makeSpanId();
  return _attemptIdHex.slice(0, 8);
}
