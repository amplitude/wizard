/**
 * DataIngestionCheckScreen — "Start your app and trigger some actions"
 * polling page after MCP setup.
 *
 * The screen polls every 30s and renders progressive coaching tips. We
 * snapshot only the initial idle frame, where:
 *   - The primary heading is visible
 *   - The framework hint reflects the integration metadata
 *   - The dev-server restart reminder is present in interactive mode
 *
 * Mounting renders the spinner + listening state immediately. The
 * 30-second poll never resolves because we don't supply credentials,
 * so the frame stays stable for the snapshot.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { DataIngestionCheckScreen } from '../DataIngestionCheckScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';
import { Integration } from '../../../../lib/constants.js';

describe('DataIngestionCheckScreen snapshots', () => {
  it('renders the primary heading + listening spinner state', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      integration: Integration.nextjs,
      activationLevel: 'none',
    });
    const { frame } = renderSnapshot(
      <DataIngestionCheckScreen store={store} />,
      store,
    );
    expect(frame).toContain('Start your app and trigger some user actions');
    // Framework hint for Next.js (no port detected → idle copy)
    expect(frame).toContain('Start your dev server, then visit it and click');
    // Restart-reminder shown in interactive mode (not agent mode)
    expect(frame).toContain('restart it so the new env values load');
    // Exit-and-resume hint
    expect(frame).toContain('[q]');
    expect(frame).toContain('Exit and resume later');
  });

  it('omits the dev-server restart reminder in agent mode', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      integration: Integration.nextjs,
      agent: true,
      activationLevel: 'none',
    });
    const { frame } = renderSnapshot(
      <DataIngestionCheckScreen store={store} />,
      store,
    );
    expect(frame).not.toContain('restart it so the new env values load');
  });

  it('uses the native-app hint for React Native (no dev-server URL probe)', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      integration: Integration.reactNative,
      activationLevel: 'none',
    });
    const { frame } = renderSnapshot(
      <DataIngestionCheckScreen store={store} />,
      store,
    );
    expect(frame).toContain(
      'Open your app on a device or emulator and tap around',
    );
    // Native frameworks must not surface a localhost URL
    expect(frame).not.toContain('localhost');
  });

  it('uses the Django web hint (different default ports than Next.js)', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      integration: Integration.django,
      activationLevel: 'none',
    });
    const { frame } = renderSnapshot(
      <DataIngestionCheckScreen store={store} />,
      store,
    );
    expect(frame).toContain(
      'Start your dev server, then visit it and browse a few pages',
    );
  });

  it('does not show progressive coaching tips at t=0', () => {
    // The 60s/120s/180s tips are gated on elapsedSeconds — the first
    // render is at t=0 so they should NOT appear yet.
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      integration: Integration.nextjs,
      activationLevel: 'none',
    });
    const { frame } = renderSnapshot(
      <DataIngestionCheckScreen store={store} />,
      store,
    );
    expect(frame).not.toContain('Make sure your dev server is running');
    expect(frame).not.toContain('check the Network tab');
  });
});
