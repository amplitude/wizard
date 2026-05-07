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

  it('uses signup-aware copy on the create-account onboarding path', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      authOnboardingPath: 'create_account',
      tosAccepted: true,
      loginUrl: 'https://app.amplitude.com/oauth?x=y',
      pendingOrgs: null,
    });
    const { lastFrame } = render(<AuthScreen store={store} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Complete sign-in in your browser');
  });

  it('hides [R] until a loginUrl is generated, but always offers [M] and [Esc]', () => {
    // Force the fresh-OAuth phase so we exercise the "Preparing your
    // sign-in link" copy specifically. Default 'idle' / 'verifying-session'
    // now correctly show "Verifying your session" — see follow-on test
    // below.
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      loginUrl: null,
      pendingOrgs: null,
      authPhase: 'opening-browser',
    });
    const { lastFrame } = render(<AuthScreen store={store} />);
    const frame = lastFrame() ?? '';
    // Placeholder copy keeps the URL slot non-empty.
    expect(frame).toContain('Preparing your sign-in link');
    expect(frame).not.toContain('Retry browser');
    expect(frame).toContain('Enter API key manually');
    expect(frame).toContain('Cancel');
  });

  // P0 hotfix regression: while the wizard is reusing a stored OAuth token
  // (no browser opening, no URL coming) the placeholder used to read
  // "Preparing your sign-in link…" — which looked like a hang because
  // there was no link being prepared. AuthPhase=verifying-session swaps
  // it for accurate copy.
  it('shows "Verifying your session" copy when authPhase is verifying-session', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      loginUrl: null,
      pendingOrgs: null,
      authPhase: 'verifying-session',
    });
    const { lastFrame } = render(<AuthScreen store={store} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Verifying your session');
    expect(frame).not.toContain('Preparing your sign-in link');
    // Manual fallback + cancel must remain reachable from this state.
    expect(frame).toContain('Enter API key manually');
    expect(frame).toContain('Cancel');
  });

  it('reverts to "Preparing your sign-in link" copy when authPhase is opening-browser', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      loginUrl: null,
      pendingOrgs: null,
      authPhase: 'opening-browser',
    });
    const { lastFrame } = render(<AuthScreen store={store} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Preparing your sign-in link');
    expect(frame).not.toContain('Verifying your session');
  });

  // Follow-on regression: AuthScreen mounts before the authTask wakes up
  // from its gate. During that window `authPhase` is still 'idle' — and
  // the original ternary fell through to "Preparing your sign-in link",
  // misleading users into thinking a browser launch was in flight when
  // really the wizard was just waiting to start verifying the cached
  // session. Treat 'idle' the same as 'verifying-session' so returning
  // users see accurate copy from the moment AuthScreen renders.
  it('shows "Verifying your session" copy when authPhase is idle (initial mount)', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      loginUrl: null,
      pendingOrgs: null,
      authPhase: 'idle',
    });
    const { lastFrame } = render(<AuthScreen store={store} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Verifying your session');
    expect(frame).not.toContain('Preparing your sign-in link');
    expect(frame).toContain('Enter API key manually');
    expect(frame).toContain('Cancel');
  });

  it('uses signup-aware placeholder before loginUrl exists', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      authOnboardingPath: 'create_account',
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
