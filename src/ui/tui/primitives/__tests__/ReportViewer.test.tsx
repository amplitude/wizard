import React from 'react';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ReportViewer,
  sliceAnsiHorizontal,
  visibleLength,
} from '../ReportViewer.js';
import {
  renderInkFrame,
  type RenderInkFrameOptions,
} from '../../__tests__/ink-stdin.js';

// Mock a generous terminal so the assertions below operate on the
// pan/slice math, not Ink's outer-frame truncation. The actual content
// area we feed to ReportViewer is forced narrower via the
// ContentAreaContext mock just below.
vi.mock('../../hooks/useStdoutDimensions.js', () => ({
  useStdoutDimensions: () => [80, 24] as const,
}));

// Force a small content-area width so we don't have to construct
// thousand-character test strings to overflow the viewport. The
// terminal mock above (80 cols) is the OUTER frame; this is the inner
// content area we deliberately squeeze to make panning observable.
vi.mock('../../context/ContentAreaContext.js', () => ({
  useContentArea: () => ({ width: 24, height: 12 }),
}));

// eslint-disable-next-line no-control-regex
const ANSI_CSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC_REGEX = /\x1b\][^\x07]*\x07/g;

const sanitize = (frame: string): string =>
  frame
    .replace(ANSI_CSI_REGEX, '')
    .replace(ANSI_OSC_REGEX, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');

describe('sliceAnsiHorizontal', () => {
  it('preserves ANSI color codes when slicing past the open marker', () => {
    // The whole line is wrapped in red. Slicing into the middle must
    // keep the open code (so the slice still renders red) and the
    // closing reset (so color cannot leak past the boundary). The
    // walker emits escape sequences in the order it encounters them,
    // so the open `[31m` lands first, then the visible window, then
    // the source's own `[0m`, then our appended hard reset.
    const colored = '\x1b[31mhello world\x1b[0m';
    const sliced = sliceAnsiHorizontal(colored, 6, 5);
    expect(sliced).toBe('\x1b[31mworld\x1b[0m\x1b[0m');
  });

  it('shifts the visible window when panOffset is non-zero', () => {
    // Bug repro for the "stop trimming stuff there" complaint: a line
    // wider than the column width must surface its tail when the user
    // pans right, instead of getting silently clipped.
    const long = 'abcdefghijklmnop';
    expect(sliceAnsiHorizontal(long, 0, 4)).toBe('abcd\x1b[0m');
    expect(sliceAnsiHorizontal(long, 4, 4)).toBe('efgh\x1b[0m');
    expect(sliceAnsiHorizontal(long, 12, 4)).toBe('mnop\x1b[0m');
  });

  it('returns empty for non-positive widths', () => {
    expect(sliceAnsiHorizontal('hello', 0, 0)).toBe('');
    expect(sliceAnsiHorizontal('hello', 0, -1)).toBe('');
  });
});

describe('visibleLength', () => {
  it('ignores ANSI escapes when measuring width', () => {
    expect(visibleLength('hello')).toBe(5);
    expect(visibleLength('\x1b[31mhello\x1b[0m')).toBe(5);
    // Hyperlink OSC sequence sandwiches visible text with non-visible
    // open/close markers — the visible width should be the inner text.
    expect(visibleLength('\x1b]8;;https://x\x07click\x1b]8;;\x07')).toBe(5);
  });
});

describe('ReportViewer horizontal scrolling', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-report-viewer-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeReport(content: string): string {
    const filePath = path.join(tempDir, 'amplitude-setup-report.md');
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  async function renderFrame(
    filePath: string,
    interact?: RenderInkFrameOptions['interact'],
  ): Promise<string> {
    const raw = await renderInkFrame(
      <ReportViewer filePath={filePath} />,
      interact ? { interact } : {},
    );
    return sanitize(raw);
  }

  it('does not clip a line wider than the column width — pan reveals the tail', async () => {
    // Fenced code block: marked-terminal preserves long lines verbatim
    // (no soft-wrap inside `<pre>`). That's exactly the truncation
    // case the old `wrap="truncate"` clipped with "…" — events tables
    // and code samples would silently lose their right edge no matter
    // how wide the terminal got. After this change the tail becomes
    // reachable via horizontal pan.
    const longLine = 'aaa_START_111222333444555666777888999_END';
    const fixture = '```\n' + longLine + '\n```';
    const initial = await renderFrame(writeReport(fixture));
    expect(initial).toContain('aaa_START');
    expect(initial).not.toContain('999_END');

    const panned = await renderFrame(
      writeReport(fixture),
      async (stdin, waitForFrame) => {
        // Press 'l' enough times to scroll past the end. Each press
        // moves HORIZONTAL_STEP=8 cols; 5 presses = 40 cols which is
        // more than the line is wider than the viewport.
        for (let i = 0; i < 5; i++) {
          stdin.write('l');
          await waitForFrame();
        }
      },
    );
    expect(panned).toContain('999_END');
  });

  it('shifts the visible content when h/l shift the pan offset', async () => {
    // Distinct tokens at known column offsets so we can assert which
    // window of the line is currently visible. Wrap in a code fence
    // so marked-terminal preserves the long line instead of soft-
    // wrapping it.
    const line = 'TOKEN_A_padding_padding_padding_padding_padding_TOKEN_B';
    const fixture = '```\n' + line + '\n```';
    const before = await renderFrame(writeReport(fixture));
    expect(before).toContain('TOKEN_A');

    const after = await renderFrame(
      writeReport(fixture),
      async (stdin, waitForFrame) => {
        // Pan all the way right.
        for (let i = 0; i < 8; i++) {
          stdin.write('l');
          await waitForFrame();
        }
      },
    );
    expect(after).toContain('TOKEN_B');
    // The pan progress indicator only renders once horizontal scrolling
    // is non-zero — confirms the keystroke actually shifted state.
    expect(after).toMatch(/col \d+/);
  });

  it('shows the key-hint footer with all documented controls', async () => {
    const filePath = writeReport('# Setup Report\n\nA short report.');
    const frame = await renderFrame(filePath);
    expect(frame).toContain('scroll');
    expect(frame).toContain('pan');
    expect(frame).toContain('top/bottom');
    expect(frame).toContain('reset');
    expect(frame).toContain('Esc');
  });

  it('resets pan offset when 0 is pressed', async () => {
    const line = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA_TAIL_BBBBBBBBBBBB';
    const fixture = '```\n' + line + '\n```';
    const frame = await renderFrame(
      writeReport(fixture),
      async (stdin, waitForFrame) => {
        for (let i = 0; i < 4; i++) {
          stdin.write('l');
          await waitForFrame();
        }
        stdin.write('0');
      },
    );
    // After reset, the leading characters are visible again and the
    // "col N" indicator drops back below the "show only when panned"
    // threshold (longestLineWidth - cols > 0 still, so the indicator
    // would re-appear if pan > 0; we assert it's gone).
    expect(frame).toContain('AAAA');
    expect(frame).not.toMatch(/col [2-9]/);
  });
});
