import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { SettingsOverrideScreen } from '../SettingsOverrideScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';

describe('SettingsOverrideScreen snapshots', () => {
  it('renders nothing when no settings overrides are detected', () => {
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <SettingsOverrideScreen store={store} />,
      store,
    );
    expect(frame).toMatchSnapshot();
  });

  it('renders the conflict modal when settings override blocking env vars', () => {
    const store = makeStoreForSnapshot({
      settingsOverrideKeys: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'],
    });
    const { frame } = renderSnapshot(
      <SettingsOverrideScreen store={store} />,
      store,
    );
    expect(frame).toMatchSnapshot();
  });
});

describe('SettingsOverrideScreen backup-failed branch (anti-dead-end)', () => {
  it('shows file path + open-in-editor hint when backup fails', async () => {
    // Drive the store into the failed branch by registering a backup
    // function that returns false; then press Enter via stdin so
    // ConfirmationInput's onConfirm fires — which sets `feedback`.
    const store = makeStoreForSnapshot({
      installDir: '/tmp/snapshot-project',
      settingsOverrideKeys: ['ANTHROPIC_BASE_URL'],
    });
    // showSettingsOverride returns a Promise we don't await — we just need
    // it to register the failing backup callback on the store.
    void store.showSettingsOverride(['ANTHROPIC_BASE_URL'], () => false);

    // Pin EDITOR so the snapshot is deterministic regardless of the host's
    // shell env (CI may have it unset, dev may have vim).
    const prevEditor = process.env.EDITOR;
    process.env.EDITOR = 'nano';
    try {
      const { lastFrame, stdin, unmount } = render(
        <SettingsOverrideScreen store={store} />,
      );
      // Wait for autoFocus to settle on the Confirm option, then press
      // Enter so ConfirmationInput's onConfirm fires the failing backup.
      await new Promise((r) => setTimeout(r, 30));
      stdin.write('\r'); // Enter
      await new Promise((r) => setTimeout(r, 30));

      // eslint-disable-next-line no-control-regex
      const csi = /\x1b\[[0-9;]*[A-Za-z]/g;
      // eslint-disable-next-line no-control-regex
      const osc = /\x1b\][^\x07]*\x07/g;
      const frame = (lastFrame() ?? '').replace(csi, '').replace(osc, '');

      // The failure-state copy must include:
      // - the absolute file path (so the user knows what to edit)
      expect(frame).toContain('/tmp/snapshot-project/.claude/settings.json');
      // - the conflicting key (so the user knows what to remove)
      expect(frame).toContain('ANTHROPIC_BASE_URL');
      // - the open-in-editor affordance (so $EDITOR users have one keystroke)
      expect(frame).toMatch(/Open in nano/);
      // - Esc as the only remaining recovery action
      expect(frame).toMatch(/\[Esc\]/);
      // The original "Backup & continue" action is GONE in this state —
      // pressing it again would do the same failing thing.
      expect(frame).not.toMatch(/Backup & continue/);

      unmount();
    } finally {
      if (prevEditor === undefined) delete process.env.EDITOR;
      else process.env.EDITOR = prevEditor;
    }
  });
});
