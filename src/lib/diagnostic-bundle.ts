/**
 * Diagnostic bundle for PR 3.1 (observability spine).
 *
 * Called from the Outro error screen when the user presses `U` to upload a
 * session trace. Packages:
 *   - tail of the structured NDJSON log (`/tmp/amplitude-wizard.logl`)
 *   - last 50 Sentry breadcrumbs from the in-process buffer
 *   - a redacted snapshot of wizard state (if a store is available)
 *   - environment metadata (wizard version, node version, platform)
 *
 * Output is gzip-compressed JSON. The caller is responsible for either
 * uploading the buffer (see diagnostic-upload.ts) or writing it to disk.
 */

import { statSync, openSync, readSync, closeSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  getLogFilePath,
  getBreadcrumbs,
  getRunId,
  getAttemptId,
  getSessionId,
} from './observability';
import { redact } from './observability/redact';
import { VERSION } from './constants';

/** Cap the log tail at 256 KB — bundle stays small enough to upload fast. */
const LOG_TAIL_BYTES = 256 * 1024;
/** Hard ceiling on the whole bundle (compressed) so one upload can't flood. */
const MAX_COMPRESSED_BYTES = 1 * 1024 * 1024;

export interface DiagnosticBundle {
  /** gzip-compressed JSON payload, ready to upload or write to disk. */
  bytes: Buffer;
  /** Plain metadata echoed outside the compressed blob for UI display. */
  meta: {
    runId: string;
    attemptId: string;
    sessionId: string;
    wizardVersion: string;
    sizeCompressedBytes: number;
    truncated: boolean;
  };
}

/** Read the last `bytes` of a file as UTF-8 text. Returns '' on any failure. */
function tailFile(path: string, bytes: number): string {
  try {
    const stats = statSync(path);
    const start = Math.max(0, stats.size - bytes);
    const length = stats.size - start;
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.alloc(length);
      readSync(fd, buf, 0, length, start);
      return buf.toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return '';
  }
}

/** Parse NDJSON, dropping malformed lines. Keeps the bundle robust to truncation. */
function parseNdjson(raw: string): unknown[] {
  if (!raw) return [];
  const lines = raw.split('\n');
  const entries: unknown[] = [];
  // Drop the first line — it may be truncated mid-record since we tailed from bytes.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Malformed / truncated — skip.
    }
  }
  return entries;
}

export interface BuildBundleOptions {
  /** Optional wizard-state snapshot. Kept generic so the lib layer doesn't import the TUI. */
  snapshot?: Record<string, unknown>;
}

/**
 * Build a diagnostic bundle for the current run. Safe to call from any layer
 * — reads from already-redacted sources and applies another redaction pass
 * before compression.
 */
export function buildBundle(opts: BuildBundleOptions = {}): DiagnosticBundle {
  const logPath = getLogFilePath() + 'l'; // companion .jsonl path written by logger
  const logTail = tailFile(logPath, LOG_TAIL_BYTES);
  const logEntries = parseNdjson(logTail);

  const payload = {
    schema: 'amplitude-wizard-diagnostic/1',
    meta: {
      runId: getRunId(),
      attemptId: getAttemptId(),
      sessionId: getSessionId(),
      wizardVersion: VERSION,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      capturedAt: new Date().toISOString(),
    },
    snapshot: opts.snapshot
      ? (redact(opts.snapshot) as Record<string, unknown>)
      : null,
    breadcrumbs: redact(getBreadcrumbs(50)),
    logEntries: redact(logEntries),
  };

  // Double-redact: individual sources redacted going in, this guards against
  // anything we missed when new sources are added without review.
  const json = JSON.stringify(redact(payload));
  let bytes = gzipSync(json);
  let truncated = false;
  if (bytes.byteLength > MAX_COMPRESSED_BYTES) {
    // Drop log entries and keep metadata + breadcrumbs — guarantees upload succeeds.
    const shrunk = JSON.stringify(
      redact({
        ...payload,
        logEntries: [],
        logEntriesTruncated: true,
      }),
    );
    bytes = gzipSync(shrunk);
    truncated = true;
  }

  return {
    bytes,
    meta: {
      runId: getRunId(),
      attemptId: getAttemptId(),
      sessionId: getSessionId(),
      wizardVersion: VERSION,
      sizeCompressedBytes: bytes.byteLength,
      truncated,
    },
  };
}
