/**
 * RetryBanner — amber inline notice shown on RunScreen while the agent is
 * retrying after a transient LLM/proxy failure (504, stall, etc.). The parent
 * passes `now` each tick so the "next in Xs" countdown stays fresh without
 * spawning another timer.
 */

import { Box, Text } from 'ink';
import type { RetryState } from '../../../lib/wizard-session.js';
import { Colors, Icons } from '../styles.js';

interface RetryBannerProps {
  retryState: RetryState | null;
  now: number;
}

export const RetryBanner = ({ retryState, now }: RetryBannerProps) => {
  if (!retryState) return null;

  const secondsUntilNext = Math.max(
    0,
    Math.ceil((retryState.nextRetryAtMs - now) / 1000),
  );
  const etaText = secondsUntilNext > 0 ? `, next in ${secondsUntilNext}s` : '';
  const statusText = retryState.errorStatus
    ? ` (HTTP ${retryState.errorStatus})`
    : '';

  return (
    <Box marginTop={1}>
      <Text color={Colors.warning}>
        {Icons.warning} {retryState.reason}
        {statusText} {Icons.dash} retrying (attempt {retryState.attempt}/
        {retryState.maxRetries}
        {etaText})
      </Text>
    </Box>
  );
};
