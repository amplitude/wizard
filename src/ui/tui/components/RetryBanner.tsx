/**
 * RetryStatusChip — a muted, calm inline indicator that the agent is
 * waiting on a transient retry (rate limit, gateway hiccup, stall).
 *
 * Design intent: rate-limit retries are common during a long agent run and
 * almost always self-resolve in seconds. The previous amber-warning banner
 * with raw HTTP codes and a ticking countdown made every blip feel like a
 * crisis. This version:
 *
 *   - Stays hidden for the first {@link RETRY_GRACE_MS} of a retry storm —
 *     transient blips never reach the user. (Anchored on the *storm* start
 *     timestamp, not the latest retry message — see `retry.ts`.)
 *   - Renders inline in the existing run-header status row, in muted text,
 *     with no warning icon.
 *   - Drops the HTTP status code and per-second countdown; the spinner
 *     already conveys liveness.
 *   - Hides the attempt counter for the common case (≤ 4 attempts) and
 *     swaps in a calm "still trying" suffix once a retry storm starts to
 *     look like a real problem (≥ 5 attempts).
 *
 * The legacy `RetryBanner` standalone-row component is preserved as a thin
 * wrapper so existing imports keep compiling, but `RunScreen` now consumes
 * the chip variant directly.
 */

import { Text } from 'ink';
import type { RetryState } from '../../../lib/wizard-session.js';
import { Colors, Icons } from '../styles.js';

/** Grace period — keep the chip hidden for transient retries. */
export const RETRY_GRACE_MS = 3_000;

/** Show a sustained-trouble suffix once we hit this many attempts. */
const SUSTAINED_ATTEMPT_THRESHOLD = 5;

/**
 * Pure helper: returns the user-visible text for a retry state, or `null`
 * when the chip should not render. Exported for tests.
 */
export function getRetryStatusText(
  retryState: RetryState | null,
  now: number,
): string | null {
  if (!retryState) return null;
  if (now - retryState.startedAt < RETRY_GRACE_MS) return null;

  // Soften status-code-driven copy. We deliberately do NOT surface the raw
  // HTTP code — users don't read HTTP, they read "uh oh".
  const base = phraseForStatus(retryState.errorStatus);

  if (retryState.attempt >= SUSTAINED_ATTEMPT_THRESHOLD) {
    return `${base} (still trying)`;
  }
  return base;
}

function phraseForStatus(status: number | null): string {
  if (status === 429) return 'slowing down to match Amplitude rate limits';
  if (status !== null && status >= 500) return 'reconnecting to Amplitude';
  if (status !== null && status >= 400) return 'retrying';
  return 'reconnecting';
}

interface RetryStatusChipProps {
  retryState: RetryState | null;
  now: number;
}

/**
 * Inline chip for the run-header status row. Renders `null` (no whitespace,
 * no Box) when there's nothing to show, so a parent `<Box gap={1}>` won't
 * leak an extra gap.
 */
export const RetryStatusChip = ({ retryState, now }: RetryStatusChipProps) => {
  const text = getRetryStatusText(retryState, now);
  if (!text) return null;
  return (
    <Text color={Colors.muted}>
      {Icons.dot} {text}
    </Text>
  );
};

/**
 * Legacy export — kept so any out-of-tree imports still compile. New
 * callers should prefer {@link RetryStatusChip} which is laid out inline
 * with the rest of the run-header status row.
 */
export const RetryBanner = RetryStatusChip;
