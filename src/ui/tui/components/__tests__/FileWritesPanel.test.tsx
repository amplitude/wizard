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

  it('does not falsely match sibling dirs that share a prefix with installDir', () => {
    // Regression: `/proj-backup/file.ts` must NOT be relativized against
    // `/proj` — it lives in a different directory entirely. Without a
    // directory-boundary check, startsWith('/proj') would match and the
    // panel would render the misleading `-backup/file.ts`.
    const { lastFrame } = render(
      <FileWritesPanel
        entries={[makeEntry({ path: '/proj-backup/file.ts' })]}
        installDir="/proj"
      />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).not.toContain('-backup/file.ts');
    // Outside-the-project paths fall back to the basename.
    expect(out).toContain('file.ts');
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
    // Header should not show the in-flight progress "X/Y" pattern. The
    // "/diff" hint is allowed (it's a slash-command discoverability cue
    // surfaced once at least one write has applied).
    expect(out).not.toMatch(/\d+\/\d+ written/);
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

  // ── Dedupe-by-path coverage ────────────────────────────────────────
  //
  // The store appends one entry per emission; the panel must collapse
  // repeats of the same path into a single row. Pre-fix the user saw 14
  // rows for ~6 distinct files ("oh god look how bad this is") — these
  // tests pin the new behavior.

  it('collapses three emissions of the same path into one row with × 3', () => {
    const entries: FileWriteEntry[] = [
      makeEntry({
        path: '/proj/share/ShareDialog.tsx',
        operation: 'modify',
        startedAt: t0,
        completedAt: t0 + 5,
      }),
      makeEntry({
        path: '/proj/share/ShareDialog.tsx',
        operation: 'modify',
        startedAt: t0 + 100,
        completedAt: t0 + 103,
      }),
      makeEntry({
        path: '/proj/share/ShareDialog.tsx',
        operation: 'modify',
        startedAt: t0 + 200,
        completedAt: t0 + 207,
      }),
    ];
    const { lastFrame } = render(
      <FileWritesPanel entries={entries} installDir="/proj" />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    // Single row only — split on the path string and confirm exactly
    // one row references it.
    const occurrences = out.split('share/ShareDialog.tsx').length - 1;
    expect(occurrences).toBe(1);
    // Edit-count annotation surfaces in the detail column.
    expect(out).toContain('3×');
    // Header counts deduped totals, not raw emissions.
    expect(out).toContain('1 written');
    expect(out).not.toContain('3 written');
  });

  it('renders 2 rows for 2 distinct paths and annotates only the doubled one', () => {
    const entries: FileWriteEntry[] = [
      makeEntry({
        path: '/proj/a.ts',
        operation: 'modify',
        startedAt: t0,
        completedAt: t0 + 4,
      }),
      makeEntry({
        path: '/proj/b.ts',
        operation: 'modify',
        startedAt: t0 + 50,
        completedAt: t0 + 53,
      }),
      makeEntry({
        path: '/proj/b.ts',
        operation: 'modify',
        startedAt: t0 + 100,
        completedAt: t0 + 107,
      }),
    ];
    const { lastFrame } = render(
      <FileWritesPanel entries={entries} installDir="/proj" />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    // Both files appear, exactly once each.
    expect(out.split('a.ts').length - 1).toBe(1);
    expect(out.split('b.ts').length - 1).toBe(1);
    // Only the doubled path gets a count annotation.
    expect(out).toContain('2×');
    // The single-edit row should NOT pick up an edit-count annotation.
    // We check that no `3×` / higher counts leak in.
    expect(out).not.toContain('3×');
    // Header counts deduped totals (2 distinct paths).
    expect(out).toContain('2 written');
  });

  it('uses the latest emission’s editTime / bytes for the collapsed row', () => {
    // Three emissions: the latest carries unique bytes + duration so we
    // can confirm the row reflects the most recent write, not the first.
    const entries: FileWriteEntry[] = [
      makeEntry({
        path: '/proj/p.ts',
        operation: 'modify',
        startedAt: t0,
        completedAt: t0 + 1,
        bytes: 100,
      }),
      makeEntry({
        path: '/proj/p.ts',
        operation: 'modify',
        startedAt: t0 + 50,
        completedAt: t0 + 51,
        bytes: 200,
      }),
      makeEntry({
        path: '/proj/p.ts',
        operation: 'modify',
        startedAt: t0 + 1000,
        completedAt: t0 + 1500,
        bytes: 999,
      }),
    ];
    const { lastFrame } = render(
      <FileWritesPanel entries={entries} installDir="/proj" />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    // Latest emission's bytes + duration win.
    expect(out).toContain('999 bytes');
    expect(out).toContain('500ms');
    // Earlier emissions' details are NOT rendered.
    expect(out).not.toContain('100 bytes');
    expect(out).not.toContain('200 bytes');
    expect(out).toContain('3×');
  });

  it('does not annotate single-edit rows', () => {
    // Make sure the × suffix only appears when N > 1.
    const entries: FileWriteEntry[] = [
      makeEntry({ path: '/proj/single.ts', operation: 'modify' }),
    ];
    const { lastFrame } = render(
      <FileWritesPanel entries={entries} installDir="/proj" />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('single.ts');
    // No edit-count annotation for single emissions — keeps the common
    // case clean.
    expect(out).not.toContain('1×');
    expect(out).not.toMatch(/edited\s+\d+×/);
  });
});
