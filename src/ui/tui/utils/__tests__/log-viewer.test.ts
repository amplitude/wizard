import { describe, expect, it } from 'vitest';
import {
  buildLogLineMeta,
  clampViewportTop,
  classifyLogLine,
  findErrorEntryIndexes,
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
