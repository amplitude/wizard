/**
 * AuthScreen — browser-fallback coaching tests.
 *
 * The OAuth waiting state has been the worst stuck-spinner offender: on
 * SSH or codespace where opn() can't open a browser, users would stare at
 * a spinner for 120s before the OAuth call timed out. These tests verify
 * the 60s coaching tier surfaces [R]/[M]/[Esc] actions and that [M]
 * routes the user into the existing manual API-key entry path.
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

  it('does not show fallback hints in the first 30s', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      loginUrl: 'https://app.amplitude.com/oauth?x=y',
      pendingOrgs: null,
    });
    const { lastFrame } = render(<AuthScreen store={store} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Waiting for authentication');
    expect(frame).not.toContain('Retry browser launch');
  });

  it('surfaces [R]/[M]/[Esc] hints after 60s of waiting', async () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      loginUrl: 'https://app.amplitude.com/oauth?x=y',
      pendingOrgs: null,
    });
    const { lastFrame } = render(<AuthScreen store={store} />);
    await vi.advanceTimersByTimeAsync(65_000);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Retry browser launch');
    expect(frame).toContain('Enter API key manually');
    expect(frame).toContain('Cancel');
    // The login URL must remain visible so [M] and "paste in browser" both work.
    expect(frame).toContain('app.amplitude.com/oauth');
  });

  it('opens the manual API-key entry view when [M] is pressed', async () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      loginUrl: 'https://app.amplitude.com/oauth?x=y',
      pendingOrgs: null,
    });
    const { lastFrame, stdin } = render(<AuthScreen store={store} />);
    await vi.advanceTimersByTimeAsync(65_000);
    expect(lastFrame() ?? '').toContain('Retry browser launch');

    stdin.write('m');
    await vi.advanceTimersByTimeAsync(50);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Enter your project API key');
    // Login URL stays visible so the user can still finish browser auth.
    expect(frame).toContain('Or finish browser sign-in at:');
  });

  it('invokes opn again when [R] is pressed', async () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      loginUrl: 'https://app.amplitude.com/oauth?x=y',
      pendingOrgs: null,
    });
    const opnModule = await import('opn');
    const opnDefault = opnModule.default as unknown as ReturnType<typeof vi.fn>;

    const { stdin } = render(<AuthScreen store={store} />);
    await vi.advanceTimersByTimeAsync(65_000);

    stdin.write('r');
    await vi.advanceTimersByTimeAsync(50);

    expect(opnDefault).toHaveBeenCalledWith(
      'https://app.amplitude.com/oauth?x=y',
      { wait: false },
    );
  });
});
