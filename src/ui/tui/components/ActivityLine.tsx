/**
 * ActivityLine — single-line live "we're doing something" indicator.
 *
 * Renders the wizard's current long-running activity (compaction, retry
 * sleep, cold-start, ingestion poll, MCP tool call) directly under the
 * journey stepper. Returns `null` when `session.currentActivity` is null —
 * the wizard is either idle or doing something the user can already see
 * (per-message streaming, screen transitions).
 *
 * Format:
 *
 *     ▶ <message> (Ns elapsed, typically ~30-90s)
 *
 * The spinner ticks every 200ms regardless of whether new wizard events
 * fire — that 200ms tick is the literal difference between "stuck" and
 * "working slowly" from the user's perspective.
 *
 * Estimated-duration phrasing only appears when `estimatedDurationSec` is
 * provided by the caller so we never pull a number out of thin air; the
 * rate-limit-retry case sets it dynamically from `nextRetryAtMs`.
 *
 * Cold-start over-time hint: when a `cold-start` activity blows past its
 * estimated duration we swap the suffix from "typically ~Ns" to "this can
 * take up to 60s on first run" so a slow first-run still reads as expected
 * behavior instead of a hung process.
 */

import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { BrailleSpinner } from './BrailleSpinner.js';
import { Colors } from '../styles.js';

interface ActivityLineProps {
  store: WizardStore;
  /** Override `Date.now()` source — used by the snapshot tests. */
  now?: () => number;
}

export const ActivityLine = ({ store, now = Date.now }: ActivityLineProps) => {
  useWizardStore(store);

  const activity = store.session.currentActivity;
  const [tick, setTick] = useState(0);

  // Re-render every second so the elapsed-time number ticks up even when
  // the underlying session state is otherwise quiet.
  useEffect(() => {
    if (!activity) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [activity]);

  if (!activity || activity.kind === 'idle') return null;

  const elapsedSec = Math.max(
    0,
    Math.floor((now() - activity.startedAt) / 1000),
  );
  // Cold-start specific: once we've exceeded the estimate, swap the
  // suffix to a "this can take up to 60s on first run" message so a
  // slow first-run reads as known-duration patience instead of unknown
  // silence. Other activity kinds (compaction, retry, ingestion poll,
  // MCP) keep the static "typically ~Ns" copy because their callers
  // already update `message` mid-flight (e.g. retry shows the
  // attempt-counter live).
  const isColdStartOverTime =
    activity.kind === 'cold-start' &&
    activity.estimatedDurationSec !== undefined &&
    elapsedSec > activity.estimatedDurationSec;
  const eta = isColdStartOverTime
    ? ', this can take up to 60s on first run'
    : activity.estimatedDurationSec
      ? `, typically ~${activity.estimatedDurationSec}s`
      : '';
  // Reference `tick` so React doesn't dead-code-eliminate the interval.
  void tick;

  return (
    <Box paddingX={1}>
      <BrailleSpinner color={Colors.active} />
      <Text color={Colors.secondary}>{` ${activity.message}`}</Text>
      <Text color={Colors.subtle}>{` (${elapsedSec}s elapsed${eta})`}</Text>
    </Box>
  );
};
