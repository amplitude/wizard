/**
 * FileWritesPanel — coverage for the live file-write activity panel.
 *
 * Locks down the contract:
 *   - Hidden when there are zero entries (so RunScreen stays compact
 *     during planning).
 *   - Shows the operation label (CREATE / MODIFY / DELETE), display path
 *     relativized against installDir, and a status icon per entry.
 *   - In-progress rows show "generating…" with elapsed time.
 *   - Applied rows show byte count + duration.
 *   - Failed rows show "failed".
 *   - The header counter switches between "X/Y written" and "N written"
 *     based on whether any entries are still in flight.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { FileWritesPanel } from '../FileWritesPanel.js';
import type { FileWriteEntry } from '../../store.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (s: string): string => s.replace(ANSI, '');

const t0 = 1_700_000_000_000;

const makeEntry = (overrides: Partial<FileWriteEntry>): FileWriteEntry => ({
  path: '/proj/src/file.ts',
  operation: 'create',
  status: 'applied',
  startedAt: t0,
  completedAt: t0 + 1200,
  bytes: 512,
  ...overrides,
});

describe('FileWritesPanel', () => {
  it('renders nothing when entries is empty', () => {
    const { lastFrame } = render(<FileWritesPanel entries={[]} />);
    // ink-testing-library returns an empty string for null-rendered roots.
    expect(stripAnsi(lastFrame() ?? '').trim()).toBe('');
  });

  it('relativizes the display path against installDir', () => {
    const { lastFrame } = render(
      <FileWritesPanel
        entries={[makeEntry({ path: '/proj/src/amplitude.ts' })]}
        installDir="/proj"
      />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('src/amplitude.ts');
    // Absolute path should NOT leak through.
    expect(out).not.toContain('/proj/src/amplitude.ts');
  });

  it('shows CREATE / MODIFY labels with the operation', () => {
    const entries: FileWriteEntry[] = [
      makeEntry({ path: '/proj/a.ts', operation: 'create' }),
      makeEntry({ path: '/proj/b.ts', operation: 'modify' }),
    ];
    const { lastFrame } = render(
      <FileWritesPanel entries={entries} installDir="/proj" />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('CREATE');
    expect(out).toContain('MODIFY');
  });

  it('shows generating… for in-progress rows with elapsed time', () => {
    const entry = makeEntry({
      status: 'planned',
      startedAt: t0,
      completedAt: undefined,
      bytes: undefined,
    });
    const { lastFrame } = render(
      <FileWritesPanel
        entries={[entry]}
        installDir="/proj"
        // 2.5 seconds into the row
        now={t0 + 2500}
      />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('generating…');
    expect(out).toContain('2.5s');
  });

  it('shows byte count and duration for applied rows', () => {
    const entry = makeEntry({
      status: 'applied',
      bytes: 1234,
      startedAt: t0,
      completedAt: t0 + 800,
    });
    const { lastFrame } = render(
      <FileWritesPanel entries={[entry]} installDir="/proj" />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('1,234 bytes');
    expect(out).toContain('800ms');
  });

  it('shows "failed" for failed rows', () => {
    const entry = makeEntry({ status: 'failed', bytes: undefined });
    const { lastFrame } = render(
      <FileWritesPanel entries={[entry]} installDir="/proj" />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('failed');
  });

  it('shows X/Y in the header while writes are in flight', () => {
    const entries: FileWriteEntry[] = [
      makeEntry({ path: '/proj/a.ts', status: 'applied' }),
      makeEntry({
        path: '/proj/b.ts',
        status: 'planned',
        completedAt: undefined,
      }),
    ];
    const { lastFrame } = render(
      <FileWritesPanel entries={entries} installDir="/proj" />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('1/2 written');
  });

  it('shows N written when no rows are in flight', () => {
    const entries: FileWriteEntry[] = [
      makeEntry({ path: '/proj/a.ts', status: 'applied' }),
      makeEntry({ path: '/proj/b.ts', status: 'applied' }),
    ];
    const { lastFrame } = render(
      <FileWritesPanel entries={entries} installDir="/proj" />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('2 written');
    expect(out).not.toContain('/');
  });

  it('caps visible rows to maxVisible and shows the most recent ones', () => {
    const entries: FileWriteEntry[] = Array.from({ length: 12 }, (_, i) =>
      makeEntry({
        path: `/proj/file-${i}.ts`,
        startedAt: t0 + i,
        completedAt: t0 + i + 100,
      }),
    );
    const { lastFrame } = render(
      <FileWritesPanel
        entries={entries}
        installDir="/proj"
        maxVisible={3}
      />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    // Last three rows = file-9 / file-10 / file-11.
    expect(out).toContain('file-11.ts');
    expect(out).toContain('file-10.ts');
    expect(out).toContain('file-9.ts');
    // Earlier rows should not render.
    expect(out).not.toContain('file-0.ts');
  });
});
