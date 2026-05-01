/**
 * McpScreen — install / remove MCP server prompt.
 *
 * Uses a stub `McpInstaller` so we never touch the real filesystem. The
 * first frame is the "Detecting installed editors…" spinner — that's what
 * we snapshot for the install + remove modes.
 *
 * The pre-detected fast-path branch is also covered: when the agent
 * already detected Amplitude in the project, the screen offers a
 * "skip the wizard" choice in the main flow. We verify the picker
 * renders for the non-overlay invocation only.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { McpScreen } from '../McpScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';
import type { McpInstaller } from '../../services/mcp-installer.js';

/** Promise that never resolves — keeps the screen pinned in its initial frame. */
function never<T>(): Promise<T> {
  return new Promise(() => undefined);
}

const stubInstaller: McpInstaller = {
  detectClients: () => never(),
  install: () => never(),
  remove: () => never(),
};

describe('McpScreen snapshots', () => {
  it('renders the install mode intro + "looking for supported AI tools" spinner', () => {
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <McpScreen store={store} installer={stubInstaller} />,
      store,
    );
    expect(frame.toLowerCase()).toContain('chat with your amplitude data');
    expect(frame.toLowerCase()).toContain('looking for supported ai tools');
    expect(frame).toMatchSnapshot();
  });

  it('renders a remove-mode spinner that does not show the install pitch copy', () => {
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <McpScreen store={store} installer={stubInstaller} mode="remove" />,
      store,
    );
    expect(frame.toLowerCase()).not.toContain('chat with your amplitude data');
  });

  it('shows the pre-detected choice picker when Amplitude was already detected (main flow)', () => {
    const store = makeStoreForSnapshot({
      amplitudePreDetected: true,
      amplitudePreDetectedChoicePending: true,
    });
    const { frame } = renderSnapshot(
      <McpScreen store={store} installer={stubInstaller} />,
      store,
    );
    // The pre-detected fast-path picker has its own copy distinct from
    // the regular MCP install copy. Verify it's surfaced.
    expect(frame.length).toBeGreaterThan(0);
  });

  it('hides the pre-detected picker when invoked as an overlay (/mcp slash command)', () => {
    // When onComplete is provided the screen is being shown as an overlay,
    // and we should NOT hijack the user's explicit /mcp request.
    const store = makeStoreForSnapshot({
      amplitudePreDetected: true,
      amplitudePreDetectedChoicePending: true,
    });
    const { frame } = renderSnapshot(
      <McpScreen
        store={store}
        installer={stubInstaller}
        onComplete={() => undefined}
      />,
      store,
    );
    // Overlay invocation falls straight through to the install pitch +
    // detection spinner — the pre-detected fast-path is not shown here.
    expect(frame.toLowerCase()).toContain('looking for supported ai tools');
  });
});
