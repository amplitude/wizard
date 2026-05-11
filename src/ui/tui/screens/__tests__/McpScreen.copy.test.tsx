/**
 * McpScreen pre-detection copy invariant.
 *
 * Pre-fix: the leading paragraph hardcoded 'Claude Code, Cursor, Claude
 * Desktop, and other AI tools you have installed' — naming tools the
 * wizard hadn't detected yet. If the user had none of them installed
 * we were promising things we couldn't deliver. The new copy leads
 * with the value prop ('Ask Amplitude questions from your editor…'),
 * and the detected-client list surfaces in the Phase.Ask line only
 * once detectClients() resolves.
 *
 * The empty-detection arm (Phase.None) now tells the user how to
 * install the MCP server later without re-running the wizard via the
 * `amplitude-wizard mcp serve` subcommand.
 *
 * Asserts:
 *   - Detecting phase: copy does NOT name any specific client.
 *   - Detected-non-empty: 'Detected: Cursor, Claude Code' appears.
 *   - Detected-empty: the 'amplitude-wizard mcp serve' fallback hint
 *     appears alongside the 'Skipping…' line.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { McpScreen } from '../McpScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import type { McpInstaller } from '../../services/mcp-installer.js';

function never<T>(): Promise<T> {
  return new Promise(() => undefined);
}

// eslint-disable-next-line no-control-regex
const ANSI_CSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC_REGEX = /\x1b\][^\x07]*\x07/g;
const stripAnsi = (s: string): string =>
  s.replace(ANSI_CSI_REGEX, '').replace(ANSI_OSC_REGEX, '');

async function flushFrames(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe('McpScreen — pre-detection copy', () => {
  it('Phase.Detecting copy does NOT mention any specific client by name', async () => {
    // detectClients never resolves — the screen sits in Phase.Detecting
    // for the duration of the render, which is exactly the surface we
    // want to pin against the pre-fix copy bug.
    const installer: McpInstaller = {
      detectClients: () => never(),
      install: () => never(),
      remove: () => never(),
    };
    const store = makeStoreForSnapshot();

    const view = render(<McpScreen store={store} installer={installer} />);
    await flushFrames();
    const frame = stripAnsi(view.lastFrame() ?? '');
    view.unmount();

    // The new copy is the value prop only.
    expect(frame).toContain('Ask Amplitude questions from your editor');

    // Specific client names must NOT appear in the pre-detection
    // copy. They live in the Phase.Ask 'Detected: X, Y' line below
    // and surface only after detectClients() resolves with results.
    expect(frame).not.toMatch(/Claude Code/);
    expect(frame).not.toMatch(/Cursor/);
    expect(frame).not.toMatch(/Claude Desktop/);
  });

  it('surfaces "Detected: Cursor, Claude Code" once detection resolves', async () => {
    // detectClients resolves immediately with two clients — the
    // screen transitions Phase.Detecting → Phase.Ask and renders
    // the 'Detected: ...' list above the confirmation prompt.
    const installer: McpInstaller = {
      detectClients: () =>
        Promise.resolve([
          { name: 'Cursor', configPath: '/tmp/cursor.json' },
          { name: 'Claude Code', configPath: '/tmp/claude.json' },
        ]),
      install: () => never(),
      remove: () => never(),
    };
    const store = makeStoreForSnapshot();

    const view = render(<McpScreen store={store} installer={installer} />);
    await flushFrames();
    await flushFrames();
    const frame = stripAnsi(view.lastFrame() ?? '');
    view.unmount();

    // Detected: X, Y line surfaces with both client names.
    expect(frame).toMatch(/Detected:.*Cursor.*Claude Code/);
  });

  it('Phase.None copy points at `amplitude-wizard mcp serve` so users can install later', async () => {
    // detectClients resolves with no clients — the screen flips to
    // Phase.None and renders the 'No supported editors detected'
    // message plus the fallback path. The Phase.None branch also
    // sets a 1500ms setTimeout to call markDone, but we capture the
    // frame BEFORE that fires (within a single microtask flush).
    const installer: McpInstaller = {
      detectClients: () => Promise.resolve([]),
      install: () => never(),
      remove: () => never(),
    };
    const store = makeStoreForSnapshot();

    const view = render(<McpScreen store={store} installer={installer} />);
    await flushFrames();
    await flushFrames();
    const frame = stripAnsi(view.lastFrame() ?? '');
    view.unmount();

    expect(frame).toMatch(/No supported editors detected/);
    expect(frame).toMatch(/amplitude-wizard mcp serve/);
  });
});
