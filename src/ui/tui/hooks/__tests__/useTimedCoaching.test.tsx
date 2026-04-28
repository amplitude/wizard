/**
 * useTimedCoaching — verify tier escalation and reset-on-progress.
 *
 * Renders the hook in a tiny Ink test component, advances fake timers
 * through the threshold boundaries, and asserts tier transitions match.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { useTimedCoaching } from '../useTimedCoaching.js';

function Harness({
  thresholds,
  signal,
}: {
  thresholds: readonly number[];
  signal?: unknown;
}) {
  const result = useTimedCoaching({
    thresholds,
    progressSignal: signal,
  });
  return (
    <Text>
      tier={result.tier} elapsed={result.elapsedSeconds}
    </Text>
  );
}

function lastTier(frame: string): number {
  const match = frame.match(/tier=(-?\d+)/);
  return match ? Number(match[1]) : -1;
}

describe('useTimedCoaching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at tier 0', () => {
    const { lastFrame } = render(<Harness thresholds={[60, 120, 300]} />);
    expect(lastTier(lastFrame() ?? '')).toBe(0);
  });

  it('escalates to tier 1 after crossing T1', async () => {
    const { lastFrame } = render(<Harness thresholds={[60, 120, 300]} />);
    expect(lastTier(lastFrame() ?? '')).toBe(0);

    await vi.advanceTimersByTimeAsync(61_000);
    expect(lastTier(lastFrame() ?? '')).toBe(1);
  });

  it('escalates to tier 2 after crossing T2', async () => {
    const { lastFrame } = render(<Harness thresholds={[60, 120, 300]} />);
    await vi.advanceTimersByTimeAsync(125_000);
    expect(lastTier(lastFrame() ?? '')).toBe(2);
  });

  it('escalates to tier 3 after crossing T3', async () => {
    const { lastFrame } = render(<Harness thresholds={[60, 120, 300]} />);
    await vi.advanceTimersByTimeAsync(310_000);
    expect(lastTier(lastFrame() ?? '')).toBe(3);
  });

  it('resets tier to 0 when progressSignal changes', async () => {
    const { lastFrame, rerender } = render(
      <Harness thresholds={[60, 120]} signal={0} />,
    );

    await vi.advanceTimersByTimeAsync(70_000);
    expect(lastTier(lastFrame() ?? '')).toBe(1);

    rerender(<Harness thresholds={[60, 120]} signal={1} />);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lastTier(lastFrame() ?? '')).toBe(0);
  });
});
