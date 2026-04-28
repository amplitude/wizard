/**
 * DataSetupScreen — verifies the 30s timeout fallback path.
 *
 * If the activation API hangs (proxy with no response), the spinner
 * used to tick forever. Now we surface a manual decision prompt:
 * "Couldn't reach Amplitude — continue anyway?"
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { DataSetupScreen } from '../DataSetupScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';

const fetchProjectActivationStatus = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/api.js', () => ({
  fetchProjectActivationStatus,
}));

vi.mock('../../../../lib/detect-amplitude.js', () => ({
  detectAmplitudeInProject: () => ({ confidence: 'none', reason: null }),
}));

function seedStore() {
  const store = makeStoreForSnapshot({
    region: 'us',
    selectedOrgId: 'org-1',
    selectedWorkspaceId: 'ws-1',
    credentials: {
      accessToken: 'tok',
      idToken: 'id',
      projectApiKey: 'k',
      host: 'https://api.amplitude.com',
      appId: 999,
    },
  });
  return store;
}

describe('DataSetupScreen — 30s timeout fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchProjectActivationStatus.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('surfaces "Couldn\'t reach Amplitude" prompt after 30s of no response', async () => {
    // Never resolves — simulates a hung proxy.
    fetchProjectActivationStatus.mockReturnValue(new Promise(() => {}));

    const store = seedStore();
    const { lastFrame } = render(<DataSetupScreen store={store} />);

    // Advance past the 30s withTimeout boundary.
    await vi.advanceTimersByTimeAsync(31_000);

    const frame = lastFrame() ?? '';
    expect(frame).toContain("Couldn't reach Amplitude");
    expect(frame).toContain('Yes, continue');
    expect(frame).toContain('Cancel and go back');
  });

  it('continues on [Y] by setting activationLevel to none', async () => {
    fetchProjectActivationStatus.mockReturnValue(new Promise(() => {}));

    const store = seedStore();
    const setActivationLevelSpy = vi.spyOn(store, 'setActivationLevel');

    const { stdin } = render(<DataSetupScreen store={store} />);

    await vi.advanceTimersByTimeAsync(31_000);
    setActivationLevelSpy.mockClear();

    stdin.write('y');
    await vi.advanceTimersByTimeAsync(50);

    expect(setActivationLevelSpy).toHaveBeenCalledWith('none');
  });
});
