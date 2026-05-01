/**
 * AuthScreen — browser-fallback coaching tests.
 *
 * The OAuth waiting state has been the worst stuck-spinner offender: on
 * SSH or codespace where opn() can't open a browser, users would stare at
 * a spinner for 120s before the OAuth call timed out. We now surface
 * [R]/[M]/[Esc] from t=0 (whenever a loginUrl exists) and layer a tier-1
 * "still waiting…" coaching message at 15s.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { AuthScreen } from '../AuthScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';

vi.mock('opn', () => ({
  default: vi.fn(() => ({ catch: () => undefined })),
}));

describe('AuthScreen — browser-fallback coaching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the always-on quick-exit hints from t=0 when a loginUrl exists', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      loginUrl: 'https://app.amplitude.com/oauth?x=y',
      pendingOrgs: null,
    });
    const { lastFrame } = render(<AuthScreen store={store} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Signing you in');
    // [R] only renders once we have a loginUrl — and we do here.
    expect(frame).toContain('Retry browser');
    expect(frame).toContain('Enter API key manually');
    expect(frame).toContain('Cancel');
    // Tier-1 emphatic coaching is silent before 15s.
    expect(frame).not.toContain('Still waiting');
  });

  it('uses signup-aware copy after --signup email capture', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      signup: true,
      emailCaptureComplete: true,
      tosAccepted: true,
      loginUrl: 'https://app.amplitude.com/oauth?x=y',
      pendingOrgs: null,
    });
    const { lastFrame } = render(<AuthScreen store={store} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Complete sign-in in your browser');
  });

  it('hides [R] until a loginUrl is generated, but always offers [M] and [Esc]', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      loginUrl: null,
      pendingOrgs: null,
    });
    const { lastFrame } = render(<AuthScreen store={store} />);
    const frame = lastFrame() ?? '';
    // Placeholder copy keeps the URL slot non-empty.
    expect(frame).toContain('Preparing your sign-in link');
    expect(frame).not.toContain('Retry browser');
    expect(frame).toContain('Enter API key manually');
    expect(frame).toContain('Cancel');
  });

  it('uses signup-aware placeholder before loginUrl exists', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      signup: true,
      emailCaptureComplete: true,
      tosAccepted: true,
      loginUrl: null,
      pendingOrgs: null,
    });
    const { lastFrame } = render(<AuthScreen store={store} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Opening your Amplitude sign-in page');
  });

  it('layers an emphatic "Still waiting…" coaching line at 15s', async () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      loginUrl: 'https://app.amplitude.com/oauth?x=y',
      pendingOrgs: null,
    });
    const { lastFrame } = render(<AuthScreen store={store} />);
    await vi.advanceTimersByTimeAsync(16_000);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Still waiting');
    // The login URL must remain visible.
    expect(frame).toContain('app.amplitude.com/oauth');
    // Quick exits stay visible too.
    expect(frame).toContain('Enter API key manually');
  });

  it('opens the manual API-key entry view when [M] is pressed (no waiting)', async () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      loginUrl: 'https://app.amplitude.com/oauth?x=y',
      pendingOrgs: null,
    });
    const { lastFrame, stdin } = render(<AuthScreen store={store} />);

    stdin.write('m');
    await vi.advanceTimersByTimeAsync(50);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Enter your project API key');
    // Login URL stays visible so the user can still finish browser auth.
    expect(frame).toContain('Or finish browser sign-in at:');
  });

  it('invokes opn when [R] is pressed and a loginUrl is set (no waiting)', async () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      loginUrl: 'https://app.amplitude.com/oauth?x=y',
      pendingOrgs: null,
    });
    const opnModule = await import('opn');
    const opnDefault = opnModule.default as unknown as ReturnType<typeof vi.fn>;

    const { stdin } = render(<AuthScreen store={store} />);

    stdin.write('r');
    await vi.advanceTimersByTimeAsync(50);

    expect(opnDefault).toHaveBeenCalledWith(
      'https://app.amplitude.com/oauth?x=y',
      { wait: false },
    );
  });
});
