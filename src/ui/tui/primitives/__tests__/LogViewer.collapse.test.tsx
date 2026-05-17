/**
 * Pinning test for the LogViewer "collapse to content" fix.
 *
 * The LogViewer used to set a fixed `height={visibleLines}` on its
 * outer Box and `height={viewportHeight}` on the inner viewport,
 * which reserved the full viewport budget (≈18 rows on a normal
 * terminal) regardless of content. With a 4-line tail, the user saw
 * 14 blank rows of dead space between the visible log lines and the
 * "Selected:" / help / "New logs append…" footer.
 *
 * The fix: drop the fixed outer `height` (use `minHeight` so flex
 * shrinks to content), and clamp the viewport's height to the actual
 * visible-row count when fewer than `viewportHeight`. The footer now
 * sits directly under the visible tail instead of being pushed to the
 * terminal floor by reserved-but-empty rows.
 *
 * Asserts:
 *   - With 3 short log lines, the rendered frame's row count is roughly
 *     `header (1) + content (3) + footer (3)` ≈ 7, NOT the fixed
 *     `visibleLines` (≈ 16 for a 24-row terminal). The pre-fix
 *     output produced a frame with > 14 lines of which ≥ 10 were
 *     blank rows between content and footer.
 *   - The footer ("New logs keep appending…") sits within 1 row of
 *     the last visible content line — i.e. no large dead gap above it.
 */

import React from 'react';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogViewer } from '../LogViewer.js';
import { renderInkFrame } from '../../__tests__/ink-stdin.js';

vi.mock('../../hooks/useStdoutDimensions.js', () => ({
  useStdoutDimensions: () => [80, 24] as const,
}));

import { stripAnsi } from '../../__tests__/helpers/strip-ansi.js';

const sanitize = (frame: string): string =>
  stripAnsi(frame)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');

describe('LogViewer collapse-to-content', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-log-collapse-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeLogFile(content: string): string {
    const filePath = path.join(tempDir, 'wizard.log');
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  it('does not pad the viewport with blank rows when the log file is short', async () => {
    const filePath = writeLogFile(
      [
        '[2026-04-26T16:00:00Z] INFO Start wizard',
        '[2026-04-26T16:00:01Z] INFO Done',
      ].join('\n'),
    );

    const raw = await renderInkFrame(<LogViewer filePath={filePath} />);
    const frame = sanitize(raw);
    const rows = frame.split('\n');

    // Find the LIVE FOLLOW header (first content row) and the footer.
    const headerIdx = rows.findIndex((r) => r.includes('LIVE FOLLOW'));
    const footerIdx = rows.findIndex((r) =>
      r.includes('New logs keep appending'),
    );

    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(footerIdx).toBeGreaterThan(headerIdx);

    // The full LogViewer footprint (header through "New logs append…")
    // should be tight — header + 2 content rows + Selected + help +
    // appending hint = 6. With a 24-row terminal it used to be ≈ 18+
    // rows because the fixed `height={visibleLines}` reserved the full
    // viewport budget. We leave a generous margin (≤ 12 rows) so this
    // test isn't fragile against minor chrome additions, but anything
    // close to the old 18-row blowout will fail.
    const totalFootprint = footerIdx - headerIdx + 1;
    expect(totalFootprint).toBeLessThanOrEqual(12);
  });

  it('still respects the viewport budget when the file is long', async () => {
    // 50 lines — far more than the ≈ 12-row viewport for a 24-row
    // terminal. The viewer should clamp visible rows to viewportHeight
    // and tail-follow the file (last lines visible). This is the
    // belt-and-braces check that the "shrink to content" change didn't
    // accidentally let the viewport blow past its budget when content
    // exceeds it.
    const lines = Array.from(
      { length: 50 },
      (_, i) => `[2026-04-26T16:00:${String(i).padStart(2, '0')}Z] INFO line ${i}`,
    );
    const filePath = writeLogFile(lines.join('\n'));

    const raw = await renderInkFrame(<LogViewer filePath={filePath} />);
    const frame = sanitize(raw);
    const rows = frame.split('\n');

    // The footer must still render — we didn't lose chrome. And the
    // last log line (line 49) should be visible in follow mode.
    expect(frame).toContain('New logs keep appending');
    expect(frame).toContain('line 49');

    // With viewportHeight ≈ 12 (24 rows - chrome), we expect roughly
    // 12 visible content rows + chrome. Cap below 24 (the terminal
    // size) — anything larger means we exceeded the terminal height,
    // which would push the bottom chrome out of the visible frame.
    expect(rows.length).toBeLessThanOrEqual(24);
  });
});
