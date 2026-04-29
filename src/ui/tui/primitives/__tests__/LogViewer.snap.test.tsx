import React from 'react';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { LogViewer } from '../LogViewer.js';

vi.mock('../../hooks/useStdoutDimensions.js', () => ({
  useStdoutDimensions: () => [80, 24] as const,
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

describe('LogViewer snapshots', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-log-viewer-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeLogFile(content: string): string {
    const filePath = path.join(tempDir, 'wizard.log');
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  function renderFrame(
    filePath: string,
    interact?: (
      stdin: ReturnType<typeof render>['stdin'],
      waitForFrame: () => Promise<void>,
    ) => Promise<void> | void,
  ): Promise<string> {
    return (async () => {
      const view = render(<LogViewer filePath={filePath} height={10} />);
      // A single `setTimeout(0)` is not enough to reliably let ink
      // consume a stdin write + propagate the resulting React state
      // updates to refs (modeRef / selectedLineRef) before the next
      // keypress is delivered. On Node 20 in particular the macrotask
      // ordering between `stream.write` -> `data` event and the
      // queued `setTimeout(0)` resolution is non-deterministic, so the
      // test would intermittently see the second keypress run against
      // stale state (e.g. errorIndexes still empty -> `n` no-ops).
      //
      // Two `setImmediate` ticks cover both halves of the round-trip:
      // ink processes the stdin data event, React re-renders, and the
      // ref-syncing `useEffect`s fire before we send the next char.
      const waitForFrame = async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        await new Promise<void>((resolve) => setImmediate(resolve));
      };
      // Two frames on mount: first lets the file-read `useEffect` run
      // and call setLines; second lets the resulting re-render commit
      // and update modeRef/selectedLineRef before any input is sent.
      await waitForFrame();
      await waitForFrame();
      await interact?.(view.stdin, waitForFrame);
      await waitForFrame();
      const frame = sanitize(view.lastFrame() ?? '');
      view.unmount();
      return frame;
    })();
  }

  it('renders the live follow tail view', async () => {
    const filePath = writeLogFile(
      [
        '[2026-04-26T16:00:00Z] INFO Start wizard',
        '[2026-04-26T16:00:01Z] WARN Slow API response',
        '[2026-04-26T16:00:02Z] ERROR Failed to create project',
        'Traceback: line 1',
        '[2026-04-26T16:00:03Z] INFO Retrying',
        '[2026-04-26T16:00:04Z] INFO Completed successfully',
      ].join('\n'),
    );

    await expect(renderFrame(filePath)).resolves.toMatchSnapshot();
  });

  it('renders inspect mode after jumping to the first error', async () => {
    const filePath = writeLogFile(
      [
        '[2026-04-26T16:00:00Z] INFO Start wizard',
        '[2026-04-26T16:00:01Z] WARN Slow API response',
        '[2026-04-26T16:00:02Z] ERROR Failed to create project while talking to an extremely verbose upstream service',
        'Traceback: line 1',
        '[2026-04-26T16:00:03Z] INFO Retrying',
        '[2026-04-26T16:00:04Z] ERROR Second failure happened in a very long diagnostic payload that requires horizontal panning',
        'Traceback: line 2',
      ].join('\n'),
    );

    const frame = await renderFrame(filePath, async (stdin, waitForFrame) => {
      stdin.write('g');
      await waitForFrame();
      stdin.write('n');
    });

    expect(frame).toMatchSnapshot();
  });

  it('returns to LIVE FOLLOW + latest line + col 1 when `0` is pressed from inspect mode', async () => {
    // The `0` keybinding is documented as "reset" in the help line. The
    // previous implementation only zeroed horizontalOffset, which was a
    // no-op the moment the user hadn't panned — they'd press `0` and see
    // nothing happen. This locks in the new full-reset behavior: drop
    // back to follow mode, jump to the latest line, reset column.
    const filePath = writeLogFile(
      [
        '[2026-04-26T16:00:00Z] INFO Start wizard',
        '[2026-04-26T16:00:01Z] INFO Step 1',
        '[2026-04-26T16:00:02Z] INFO Step 2',
        '[2026-04-26T16:00:03Z] INFO Step 3',
        '[2026-04-26T16:00:04Z] INFO Last entry',
      ].join('\n'),
    );

    const frame = await renderFrame(filePath, async (stdin, waitForFrame) => {
      // Jump into inspect mode at the top of the file.
      stdin.write('g');
      await waitForFrame();
      // Pan right so horizontalOffset is non-zero.
      stdin.write('l');
      await waitForFrame();
      // Now press `0` — should snap back to LIVE FOLLOW at the latest line.
      stdin.write('0');
    });

    expect(frame).toContain('LIVE FOLLOW');
    // Last line of the file should be the selection in the detail row.
    expect(frame).toContain('Last entry');
    // Horizontal offset reset to col 1.
    expect(frame).toContain('col 1');
  });

  it('renders the missing-log fallback state', async () => {
    const filePath = path.join(tempDir, 'missing.log');
    const frame = await renderFrame(filePath);
    // Mask the resolved tempdir path so the snapshot is stable across
    // platforms. The viewer prints the absolute path under the
    // placeholder so users can debug a hardcoded-vs-configured mismatch
    // — that's the diagnostic value we care about — but the exact bytes
    // vary by tmpdir convention (`/var/folders/...` on macOS is much
    // longer than `/tmp/...` on Linux CI) and the LogViewer truncates
    // long paths to fit the 80-column terminal. A literal
    // `frame.replace(filePath, ...)` only matches the unwrapped path,
    // which silently no-ops on macOS and breaks the snapshot in CI.
    //
    // Regex-mask the rendered "path:" line instead so the snapshot is
    // platform-agnostic.
    const masked = frame.replace(
      /^(\s*\d+\s+path:)\s+\S.*$/m,
      '$1 <TEMP>/missing.log',
    );
    expect(masked).toMatchSnapshot();
  });
});
