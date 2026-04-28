/**
 * useTimedCoaching — escalating coaching messages on long-running screens.
 *
 * Spinners that spin forever with no acknowledgement are the worst UX sin in
 * a CLI. This hook gives screens a tiered escalation pattern: after T1
 * seconds of no progress, surface a calm reassurance line; after T2 escalate
 * to alternative actions; after T3 offer manual fallbacks. When a "progress
 * signal" changes (a task counter, a poll counter, anything monotonic) the
 * timer resets — the user is making forward motion, so we shouldn't nag.
 *
 * Returns the current `tier` (0–thresholds.length) plus `elapsedSeconds`,
 * which screens use to render the right copy.
 *
 * Example:
 *   const { tier, elapsedSeconds } = useTimedCoaching({
 *     thresholds: [60, 120, 300],
 *     progressSignal: tasks.length,
 *   });
 *   if (tier >= 1) <Text>Still working — switch to Logs (Tab)…</Text>
 *
 * Reference: DataIngestionCheckScreen has a hand-rolled version of this at
 * 60/90/120/180s; this hook generalises that pattern.
 */

import { useEffect, useRef, useState } from 'react';

export interface UseTimedCoachingOptions {
  /**
   * Seconds after which each tier becomes active. Must be sorted ascending.
   * tier 0 is "before T1", tier N is "past threshold N-1".
   */
  thresholds: readonly number[];
  /**
   * When this value changes (===), the elapsed timer resets to 0. Pass a
   * task counter, a poll count, or any monotonic indicator that "something
   * happened". If omitted, the timer never resets.
   */
  progressSignal?: unknown;
  /**
   * Tick interval in ms. Default 1000 (one re-render per second). Setting
   * this higher reduces re-renders on screens where second-level granularity
   * isn't needed.
   */
  tickIntervalMs?: number;
}

export interface UseTimedCoachingResult {
  /** Number of thresholds crossed. 0 = before T1, 1 = past T1, etc. */
  tier: number;
  /** Seconds since the last progressSignal change (or hook mount). */
  elapsedSeconds: number;
}

export function useTimedCoaching({
  thresholds,
  progressSignal,
  tickIntervalMs = 1000,
}: UseTimedCoachingOptions): UseTimedCoachingResult {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAtRef = useRef<number>(Date.now());
  const lastSignalRef = useRef<unknown>(progressSignal);

  // Reset on progress.
  useEffect(() => {
    if (lastSignalRef.current !== progressSignal) {
      lastSignalRef.current = progressSignal;
      startedAtRef.current = Date.now();
      setElapsedSeconds(0);
    }
  }, [progressSignal]);

  // Tick the elapsed counter.
  useEffect(() => {
    const id = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, tickIntervalMs);
    return () => clearInterval(id);
  }, [tickIntervalMs]);

  let tier = 0;
  for (const threshold of thresholds) {
    if (elapsedSeconds >= threshold) tier += 1;
    else break;
  }

  return { tier, elapsedSeconds };
}
