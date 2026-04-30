import { Colors } from '../styles.js';

export type LogEntryKind = 'default' | 'error' | 'warning' | 'success';

export interface LogLineMeta {
  color: string;
  entryKind: LogEntryKind;
  entryStartIndex: number;
}

const TIMESTAMP_RE = /^\[/;
const ERROR_RE = /\berror\b|\bfail(?:ed)?\b/i;
const WARN_RE = /\bwarn(?:ing)?\b/i;
const SUCCESS_RE = /\bsucceed(?:ed)?\b|\bcompleted?\b/i;

/**
 * Match the ISO-8601 timestamp at the start of a wizard log line. The
 * formatter at `src/lib/observability/logger.ts:354` writes
 *   `[2026-04-30T04:11:58.038Z] [d82db118] [legacy] DEBUG …`
 * — we anchor on `[<iso>]` so JSON dump continuation lines (`{`, `"…":`)
 * fall through and inherit the previous entry's session-membership.
 */
const ENTRY_TIMESTAMP_RE = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/;

/**
 * Find the first index in `lines` belonging to the current wizard session.
 *
 * Rationale: `~/.amplitude/wizard/runs/<install-hash>/log.txt` is
 * append-only across runs (5 MB rotation), so a fresh wizard launch sees
 * the previous session's tail above its own startup banner. The TUI Logs
 * tab passes `sessionStartMs` from `getSessionStartMs()`; lines whose
 * timestamp predates that get hidden by default. Multi-line JSON
 * payloads (no leading `[ts]`) inherit their parent entry's classification,
 * so they're never split mid-block.
 *
 * Returns `0` when `sessionStartMs` is null (no scoping requested) or
 * when no line is recent enough — in the latter case the caller renders
 * an empty viewport, which is correct behavior (file exists but pre-dates
 * the session).
 *
 * Exported for unit tests.
 */
export function findSessionStartIndex(
  lines: string[],
  sessionStartMs: number | null,
): number {
  if (sessionStartMs === null) return 0;
  for (let i = 0; i < lines.length; i++) {
    const match = ENTRY_TIMESTAMP_RE.exec(lines[i]);
    if (!match) continue;
    const ts = Date.parse(match[1]);
    if (Number.isNaN(ts)) continue;
    if (ts >= sessionStartMs) return i;
  }
  // No timestamped entry from the current session yet — caller should
  // render the placeholder rather than the entire historical tail.
  return lines.length;
}

export function classifyLogLine(line: string): LogEntryKind {
  if (ERROR_RE.test(line)) return 'error';
  if (WARN_RE.test(line)) return 'warning';
  if (SUCCESS_RE.test(line)) return 'success';
  return 'default';
}

export function getLogEntryColor(kind: LogEntryKind): string {
  switch (kind) {
    case 'error':
      return Colors.error;
    case 'warning':
      return Colors.warning;
    case 'success':
      return Colors.success;
    default:
      return Colors.muted;
  }
}

export function buildLogLineMeta(lines: string[]): LogLineMeta[] {
  let entryStartIndex = 0;
  let entryKind: LogEntryKind = 'default';

  return lines.map((line, index) => {
    if (TIMESTAMP_RE.test(line)) {
      entryStartIndex = index;
      entryKind = classifyLogLine(line);
    }

    return {
      color: getLogEntryColor(entryKind),
      entryKind,
      entryStartIndex,
    };
  });
}

export function findErrorEntryIndexes(meta: LogLineMeta[]): number[] {
  const indexes: number[] = [];

  for (let index = 0; index < meta.length; index++) {
    if (
      meta[index].entryKind === 'error' &&
      meta[index].entryStartIndex === index
    ) {
      indexes.push(index);
    }
  }

  return indexes;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampViewportTop(
  requestedTop: number,
  totalLines: number,
  viewportHeight: number,
): number {
  const maxTop = Math.max(0, totalLines - viewportHeight);
  return clamp(requestedTop, 0, maxTop);
}

export function sliceViewportText(
  line: string,
  horizontalOffset: number,
  width: number,
): string {
  if (width <= 0) return '';
  return line.slice(horizontalOffset, horizontalOffset + width);
}
