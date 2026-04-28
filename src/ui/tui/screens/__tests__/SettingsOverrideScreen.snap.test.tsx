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

      // eslint-disable-next-line no-control-regex
      const csi = /\x1b\[[0-9;]*[A-Za-z]/g;
      // eslint-disable-next-line no-control-regex
      const osc = /\x1b\][^\x07]*\x07/g;
      const readFrame = () =>
        (lastFrame() ?? '').replace(csi, '').replace(osc, '');

      // Poll for a substring instead of using fixed sleeps — Node 20 imports
      // and renders this tree more slowly than Node 22/24, and 30 ms isn't
      // enough for ConfirmationInput to mount + register useInput. Waiting
      // for actual visible state makes the test deterministic across versions.
      const waitFor = async (
        predicate: () => boolean,
        ms = 2000,
      ): Promise<void> => {
        const start = Date.now();
        while (!predicate()) {
          if (Date.now() - start > ms) {
            throw new Error(
              `Timed out after ${ms}ms. Last frame:\n${readFrame()}`,
            );
          }
          await new Promise((r) => setTimeout(r, 10));
        }
      };

      // Wait for the initial render (Confirm prompt visible) before sending
      // Enter — otherwise the keystroke can land before useInput is wired up.
      await waitFor(() => readFrame().includes('Backup & continue'));

      // Retry the Enter keystroke until the state actually flips. On Node 20
      // there's a race between ink's handleReadable subscription and our
      // first stdin.write — the first \r can land before Ink is listening,
      // so a single keystroke isn't reliable. Sending \r every poll until
      // we see the failure-state markers makes the test deterministic
      // across Node versions without arbitrary fixed sleeps.
      const isInFailedState = () =>
        readFrame().includes('/tmp/snapshot-project/.claude/settings.json') &&
        !readFrame().includes('Backup & continue');
      const start = Date.now();
      while (!isInFailedState()) {
        if (Date.now() - start > 2000) {
          throw new Error(
            `Timed out waiting for failure state. Last frame:\n${readFrame()}`,
          );
        }
        stdin.write('\r'); // Enter
        await new Promise((r) => setTimeout(r, 20));
      }

      const frame = readFrame();

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
