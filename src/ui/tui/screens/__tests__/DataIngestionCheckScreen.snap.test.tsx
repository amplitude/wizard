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
import {
  DataIngestionCheckScreen,
  BACKEND_SDK_INTEGRATIONS,
} from '../DataIngestionCheckScreen.js';
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
    // Skip verification vs exit hints
    expect(frame).toContain('[q]');
    expect(frame).toContain('Skip verification');
    expect(frame).toContain('[x]');
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

  describe('BACKEND_SDK_INTEGRATIONS gating', () => {
    // The catalog-as-success-signal fallback is gated to backend SDKs only.
    // Browser SDKs would falsely celebrate on schema registrations that
    // predate real ingestion. Mobile / native / engine integrations rely
    // on the PR's coaching tips instead.
    it('includes the canonical backend SDKs', () => {
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.django)).toBe(true);
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.flask)).toBe(true);
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.fastapi)).toBe(true);
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.go)).toBe(true);
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.java)).toBe(true);
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.javascriptNode)).toBe(
        true,
      );
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.python)).toBe(true);
    });

    it('excludes browser SDKs (catalog fallback would falsely celebrate)', () => {
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.nextjs)).toBe(false);
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.vue)).toBe(false);
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.reactRouter)).toBe(false);
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.javascript_web)).toBe(
        false,
      );
    });

    it('excludes mobile / native / engine integrations (rely on coaching tips)', () => {
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.swift)).toBe(false);
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.android)).toBe(false);
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.reactNative)).toBe(false);
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.flutter)).toBe(false);
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.unity)).toBe(false);
      expect(BACKEND_SDK_INTEGRATIONS.has(Integration.unreal)).toBe(false);
    });
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
