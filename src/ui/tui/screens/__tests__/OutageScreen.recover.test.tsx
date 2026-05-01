/**
 * OutageScreen — verifies the 30s background poll auto-dismisses the
 * overlay when service status flips back to healthy, and that polling
 * caps at 10 attempts before giving up.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { OutageScreen } from '../OutageScreen.js';
import { ServiceHealthStatus } from '../../../../lib/health-checks/types.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';

const checkAmplitudeOverallHealth = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/health-checks/index.js', () => ({
  checkAmplitudeOverallHealth,
}));

describe('OutageScreen — auto-recover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    checkAmplitudeOverallHealth.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a "Re-checking" indicator inline', () => {
    const store = makeStoreForSnapshot({
      serviceStatus: {
        description: 'Elevated error rates',
        statusPageUrl: 'https://status.amplitude.com',
      },
    });
    const { lastFrame } = render(<OutageScreen store={store} />);
    expect(lastFrame() ?? '').toContain('Re-checking');
    expect(lastFrame() ?? '').toContain('attempt 1 of 10');
  });

  it('auto-dismisses the overlay when status flips to healthy', async () => {
    checkAmplitudeOverallHealth.mockResolvedValue({
      status: ServiceHealthStatus.Healthy,
    });
    const store = makeStoreForSnapshot({
      serviceStatus: {
        description: 'Elevated error rates',
        statusPageUrl: 'https://status.amplitude.com',
      },
    });
    const popSpy = vi.spyOn(store, 'popOverlay');

    render(<OutageScreen store={store} />);

    // 30s poll fires.
    await vi.advanceTimersByTimeAsync(30_000);
    // Drain microtasks waiting on the resolved fetch promise.
    await vi.advanceTimersByTimeAsync(0);

    expect(checkAmplitudeOverallHealth).toHaveBeenCalled();
    expect(popSpy).toHaveBeenCalled();
  });

  it('keeps polling while status remains degraded', async () => {
    checkAmplitudeOverallHealth.mockResolvedValue({
      status: ServiceHealthStatus.Degraded,
    });
    const store = makeStoreForSnapshot({
      serviceStatus: {
        description: 'Elevated error rates',
        statusPageUrl: 'https://status.amplitude.com',
      },
    });
    const popSpy = vi.spyOn(store, 'popOverlay');

    render(<OutageScreen store={store} />);

    // First poll
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(0);
    // Second poll
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(0);

    expect(
      checkAmplitudeOverallHealth.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
    expect(popSpy).not.toHaveBeenCalled();
  });

  it('shows a give-up message after 10 failed attempts', async () => {
    checkAmplitudeOverallHealth.mockResolvedValue({
      status: ServiceHealthStatus.Degraded,
    });
    const store = makeStoreForSnapshot({
      serviceStatus: {
        description: 'Elevated error rates',
        statusPageUrl: 'https://status.amplitude.com',
      },
    });

    const { lastFrame } = render(<OutageScreen store={store} />);

    // 10 polls × 30s = 5 minutes, plus a tick to flush each promise.
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(0);
    }

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Still degraded after 10 checks');
  });
});
