import { describe, expect, it } from 'vitest';
import {
  buildLogLineMeta,
  clampViewportTop,
  classifyLogLine,
  findErrorEntryIndexes,
  findSessionStartIndex,
  sliceViewportText,
} from '../log-viewer.js';

describe('classifyLogLine', () => {
  it('detects error, warning, and success lines', () => {
    expect(classifyLogLine('[x] ERROR request failed')).toBe('error');
    expect(classifyLogLine('[x] warning retrying')).toBe('warning');
    expect(classifyLogLine('[x] completed successfully')).toBe('success');
    expect(classifyLogLine('[x] ordinary output')).toBe('default');
  });
});

describe('buildLogLineMeta', () => {
  it('carries entry kind across multiline log entries', () => {
    const meta = buildLogLineMeta([
      '[2026] ERROR failed to connect',
      'stack line one',
      'stack line two',
      '[2026] ordinary output',
      'details continue',
    ]);

    expect(meta[0].entryKind).toBe('error');
    expect(meta[1].entryKind).toBe('error');
    expect(meta[2].entryStartIndex).toBe(0);
    expect(meta[3].entryKind).toBe('default');
    expect(meta[4].entryStartIndex).toBe(3);
  });
});

describe('findErrorEntryIndexes', () => {
  it('returns only the first line of each error entry', () => {
    const meta = buildLogLineMeta([
      '[1] ERROR first failure',
      'stack',
      '[2] warning',
      '[3] failed again',
      'more',
    ]);

    expect(findErrorEntryIndexes(meta)).toEqual([0, 3]);
  });
});

describe('clampViewportTop', () => {
  it('keeps viewport within available lines', () => {
    expect(clampViewportTop(-2, 20, 5)).toBe(0);
    expect(clampViewportTop(4, 20, 5)).toBe(4);
    expect(clampViewportTop(50, 20, 5)).toBe(15);
  });
});

describe('sliceViewportText', () => {
  it('returns an unwrapped horizontal slice', () => {
    expect(sliceViewportText('abcdefghij', 3, 4)).toBe('defg');
  });
});

describe('findSessionStartIndex', () => {
  // Real-shape lines from `src/lib/observability/logger.ts:354`. Two prior
  // wizard runs (Apr 28 + Apr 29 morning) above today's session that
  // started at `sessionStartMs`.
  const lines = [
    '[2026-04-28T23:57:09.376Z] [5b9c573c] [legacy] DEBUG yesterday line 1',
    '[2026-04-28T23:57:09.436Z] [5b9c573c] [legacy] DEBUG yesterday line 2',
    '[2026-04-29T04:27:13.900Z] [03a3e2f9] [legacy] DEBUG morning line 1',
    '[2026-04-30T04:11:58.037Z] [d82db118] [legacy] DEBUG today line 1',
    '  "type": "user",',
    '  "session_id": "abc"',
    '}',
    '[2026-04-30T04:11:58.038Z] [d82db118] [legacy] DEBUG today line 2',
  ];

  it('returns 0 when sessionStartMs is null (no scoping requested)', () => {
    expect(findSessionStartIndex(lines, null)).toBe(0);
  });

  it('finds the first line at or after sessionStartMs', () => {
    const todayMs = Date.parse('2026-04-30T04:00:00.000Z');
    expect(findSessionStartIndex(lines, todayMs)).toBe(3);
  });

  it('skips multi-line JSON continuations (no leading [ts])', () => {
    // The cut still lands on the first timestamped entry of the session,
    // not on a continuation line.
    const todayMs = Date.parse('2026-04-30T04:00:00.000Z');
    const idx = findSessionStartIndex(lines, todayMs);
    expect(lines[idx]).toMatch(/today line 1/);
  });

  it('returns lines.length when no entry is recent enough', () => {
    const farFutureMs = Date.parse('2030-01-01T00:00:00.000Z');
    expect(findSessionStartIndex(lines, farFutureMs)).toBe(lines.length);
  });

  it('handles malformed timestamps gracefully', () => {
    const garbage = [
      '[not-a-timestamp] foo',
      'bare line',
      '[2026-04-30T04:11:58.037Z] [run] DEBUG today',
    ];
    const todayMs = Date.parse('2026-04-30T04:00:00.000Z');
    expect(findSessionStartIndex(garbage, todayMs)).toBe(2);
  });
});
