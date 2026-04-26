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
