/**
 * Regression test for the ReportViewer overdraw bug.
 *
 * The viewer received `siblingRows` from its parent (OutroScreen's
 * showReport sub-view, which has a header + dashboard CTA + "[O] Open
 * in browser · [Esc] Back" hint footer). It computed
 * `visibleLines = baseRows - siblingRows`, reserved a Box of exactly
 * `visibleLines` rows, and rendered:
 *
 *   - `visibleLines` body rows from `lines.slice(offset, offset +
 *     visibleLines)`, AND
 *   - a "↑↓ to scroll · N/M lines" hint row when `lines.length >
 *     visibleLines`.
 *
 * Total rendered child rows: `visibleLines + 1` when paginated. The
 * Box's `height={visibleLines}` did NOT include `overflow="hidden"`,
 * so the +1 row overflowed downward into the next sibling — usually
 * the OutroScreen's "[O] Open in browser · [Esc] Back" strip on the
 * showReport tab, or in worst cases the table header row of the
 * markdown events table the viewer was rendering.
 *
 * Fix: subtract the hint row from the body budget when paginated, AND
 * add `overflow="hidden"` as defense in depth. This test pins both
 * invariants — render with a small budget, assert the rendered output
 * uses at most `visibleLines` body rows and the scroll hint appears in
 * the same `visibleLines` window (not below it).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { render } from 'ink-testing-library';
import { Box } from 'ink';
import { ReportViewer } from '../ReportViewer.js';
import { ContentAreaContext } from '../../context/ContentAreaContext.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const strip = (s: string) => s.replace(ANSI, '');

describe('ReportViewer overdraw', () => {
  it('renders at most `visibleLines` content rows when paginated', () => {
    // Build a report whose rendered output has many lines. Markdown
    // joins consecutive paragraphs onto a single rendered line, so
    // force line breaks with `\n\n` (paragraph) or fenced code (each
    // code line is its own row in marked-terminal).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-report-'));
    const reportPath = path.join(dir, 'amplitude-setup-report.md');
    const codeBlock = Array.from({ length: 50 }, (_, i) => `row ${i + 1}`).join(
      '\n',
    );
    fs.writeFileSync(reportPath, '```\n' + codeBlock + '\n```\n');

    // Force a small content area so `visibleLines` is small and the
    // overflow case is exercised.
    const contentHeight = 8;
    const Wrapper = () => (
      <ContentAreaContext.Provider value={{ height: contentHeight, width: 80 }}>
        <Box flexDirection="column">
          <ReportViewer filePath={reportPath} siblingRows={0} />
        </Box>
      </ContentAreaContext.Provider>
    );
    const { lastFrame, rerender, unmount } = render(<Wrapper />);
    // The viewer reads the file inside a useEffect, so the initial sync
    // frame shows the empty placeholder. Force a re-render to land on
    // the post-effect frame.
    rerender(<Wrapper />);
    const frame = strip(lastFrame() ?? '').replace(/[ \t]+$/gm, '');
    unmount();

    const lines = frame.split('\n').filter((l) => l.length > 0);
    // The frame should contain at most `contentHeight` non-empty rows
    // (body + scroll indicator). Before the fix, the scroll indicator
    // overflowed BEYOND the budget, producing `contentHeight + 1`
    // visible rows.
    expect(lines.length).toBeLessThanOrEqual(contentHeight);
    // And the scroll hint must appear — content is taller than viewport.
    expect(frame).toMatch(/↑↓ to scroll/);
  });

  it('renders the scroll hint inline (not overflowing the bottom)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-report-'));
    const reportPath = path.join(dir, 'amplitude-setup-report.md');
    const codeBlock = Array.from({ length: 40 }, (_, i) => `row ${i + 1}`).join(
      '\n',
    );
    fs.writeFileSync(reportPath, '```\n' + codeBlock + '\n```\n');

    // 6 rows total budget: 5 body rows + 1 scroll hint = 6 total.
    const contentHeight = 6;
    const Wrapper = () => (
      <ContentAreaContext.Provider value={{ height: contentHeight, width: 80 }}>
        <Box flexDirection="column">
          <ReportViewer filePath={reportPath} siblingRows={0} />
        </Box>
      </ContentAreaContext.Provider>
    );
    const { lastFrame, rerender, unmount } = render(<Wrapper />);
    // The viewer reads the file inside a useEffect, so the initial sync
    // frame shows the empty placeholder. Force a re-render to land on
    // the post-effect frame.
    rerender(<Wrapper />);
    const frame = strip(lastFrame() ?? '').replace(/[ \t]+$/gm, '');
    unmount();

    // The hint must appear inside the rendered output.
    const hintLine = frame
      .split('\n')
      .findIndex((l) => l.includes('↑↓ to scroll'));
    expect(hintLine).toBeGreaterThanOrEqual(0);
    // And total rendered non-empty rows must respect the budget — no
    // overflow into a downstream sibling.
    const lines = frame.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeLessThanOrEqual(contentHeight);
  });
});
