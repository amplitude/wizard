/**
 * Redactor for `--agent` NDJSON snapshots.
 *
 * The Phase 1 snapshot lane (screen renders) and the Phase 2 scenario lane
 * (full --agent runs) both need to diff NDJSON output line-by-line. The
 * envelope carries fields that are deterministic per-run but not stable
 * across runs (timestamps, UUIDs) — without redaction every snapshot would
 * thrash on every run. This module is the canonical normalization pass.
 *
 * The contract this enforces is documented in
 * `docs/agent-ndjson-contract.md` § "Stable vs volatile fields". Adding a
 * new volatile field anywhere in the wire format means adding a redactor
 * here.
 *
 * Pure (no side effects, no async) — safe to call on captured arrays of
 * lines or a streamed in-memory buffer.
 */

/** Replacement tokens. Stable strings, never appear in real NDJSON output. */
export const REDACTED = {
  timestamp: '<TS>',
  uuid: '<UUID>',
  toolUseId: '<TOOL_USE_ID>',
  duration: '<DURATION>',
  installDir: '<INSTALL_DIR>',
} as const;

/**
 * UUID v4-ish pattern. Matches both canonical UUIDs and the wizard's
 * shorter randomBytes-derived run/session IDs.
 */
const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** ISO 8601 timestamp emitted by `new Date().toISOString()`. */
const ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

export interface RedactOptions {
  /**
   * Absolute path to the test's temp install directory. Any occurrence of
   * this prefix in payloads (file paths, resume commands) gets replaced
   * with `<INSTALL_DIR>`. Pass the same value the test built its scratch
   * dir with.
   */
  installDir?: string;
  /**
   * When true, redact tool-use IDs forwarded from the SDK on tool_call /
   * file_change events. These are random per call and carry no semantic
   * value to a snapshot — leaving them in would make every run differ.
   */
  redactToolUseIds?: boolean;
  /**
   * Additional duration field names to redact. `durationMs` and `elapsedMs`
   * are always redacted. Pass extras here when an event adds a new
   * wall-clock field.
   */
  extraDurationFields?: readonly string[];
}

const DEFAULT_DURATION_FIELDS = ['durationMs', 'elapsedMs'] as const;

/**
 * Redact a single parsed NDJSON event object. Mutates in place AND returns
 * the same reference for ergonomic chaining. Idempotent (already-redacted
 * values pass through unchanged).
 *
 * Volatile fields handled:
 *   - `@timestamp`            → `<TS>`
 *   - `session_id`, `run_id`  → `<UUID>`
 *   - `data.toolUseId`        → `<TOOL_USE_ID>` (when `redactToolUseIds`)
 *   - `data.durationMs`,      → `<DURATION>`
 *     `data.elapsedMs`,
 *     and any extras
 *   - Any string value containing the install-dir prefix → `<INSTALL_DIR>/...`
 *   - Any string value containing a UUID                → `<UUID>`
 */
export function redactEvent<T extends Record<string, unknown>>(
  event: T,
  options: RedactOptions = {},
): T {
  if ('@timestamp' in event && typeof event['@timestamp'] === 'string') {
    (event as Record<string, unknown>)['@timestamp'] = REDACTED.timestamp;
  }
  if (typeof event.session_id === 'string') {
    (event as Record<string, unknown>).session_id = REDACTED.uuid;
  }
  if (typeof event.run_id === 'string') {
    (event as Record<string, unknown>).run_id = REDACTED.uuid;
  }
  if (event.data && typeof event.data === 'object') {
    redactDataPayload(event.data as Record<string, unknown>, options);
  }
  return event;
}

function redactDataPayload(
  data: Record<string, unknown>,
  options: RedactOptions,
): void {
  const durationFields = [
    ...DEFAULT_DURATION_FIELDS,
    ...(options.extraDurationFields ?? []),
  ];
  for (const field of durationFields) {
    if (typeof data[field] === 'number') {
      data[field] = REDACTED.duration;
    }
  }
  if (options.redactToolUseIds && typeof data.toolUseId === 'string') {
    data.toolUseId = REDACTED.toolUseId;
  }
  // Walk the payload once, normalizing UUIDs and install-dir paths in any
  // string value. Recursive so nested arrays/objects (e.g. `setup_complete`
  // file lists, `needs_input` choices with metadata) get scrubbed too.
  walkStringValues(data, (s) => normalizeString(s, options));
}

function normalizeString(s: string, options: RedactOptions): string {
  let out = s;
  if (options.installDir && options.installDir.length > 0) {
    // Replace the absolute prefix wherever it appears (file paths, resume
    // commands, log lines). Use split/join to avoid regex-escaping the
    // path — paths can contain regex metacharacters on macOS (`+`).
    out = out.split(options.installDir).join(REDACTED.installDir);
  }
  out = out.replace(UUID_RE, REDACTED.uuid);
  out = out.replace(ISO_TIMESTAMP_RE, REDACTED.timestamp);
  return out;
}

function walkStringValues(
  value: unknown,
  transform: (s: string) => string,
): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      if (typeof v === 'string') {
        value[i] = transform(v);
      } else if (v && typeof v === 'object') {
        walkStringValues(v, transform);
      }
    }
    return;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (typeof v === 'string') {
        obj[key] = transform(v);
      } else if (v && typeof v === 'object') {
        walkStringValues(v, transform);
      }
    }
  }
}

/**
 * Parse an NDJSON stream (one JSON object per line) and return redacted
 * events. Skips blank lines so callers can hand it raw stdout buffers.
 * Throws on malformed JSON — fail loud, never silently drop a line.
 */
export function redactNdjsonStream(
  rawNdjson: string,
  options: RedactOptions = {},
): Array<Record<string, unknown>> {
  const lines = rawNdjson.split('\n').filter((l) => l.length > 0);
  return lines.map((line, idx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(
        `redactNdjsonStream: line ${idx + 1} is not valid JSON: ${
          (err as Error).message
        }`,
        { cause: err },
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(
        `redactNdjsonStream: line ${idx + 1} is not a JSON object`,
      );
    }
    return redactEvent(parsed as Record<string, unknown>, options);
  });
}

/**
 * Render a redacted event sequence back to NDJSON. Convenience for
 * snapshot tests that want to diff the textual form rather than the
 * parsed array — text diffs are easier to read in failure output.
 */
export function formatRedactedNdjson(
  events: ReadonlyArray<Record<string, unknown>>,
): string {
  return events.map((e) => JSON.stringify(e)).join('\n');
}
