/**
 * DiscoveryFeed — fades in cold-start "insight chips" one at a time.
 *
 * The wizard already learns a handful of facts about the user's project
 * before the agent does anything — detected framework, package manager,
 * TypeScript yes/no, region, org/project, etc. Pre-#669 these all sat on
 * the session and went straight into the agent's preflight context block,
 * but never showed up to the user. RunScreen was a near-empty void during
 * the 30-60s cold-start window, and users complained it felt "lame".
 *
 * This component fills that void. It reads the append-only
 * `session.discoveryFacts` array and renders each fact as a row:
 *
 *   ✓ Framework       Next.js 15 (App Router)
 *   ✓ Package manager pnpm
 *   ✓ TypeScript      yes
 *   ◇ Region          us-east-1
 *
 * Reveal animation: the parent's spinner `tick` (200ms cadence) is used
 * to advance a reveal index. New facts appear ~1 step (200ms) after the
 * one before, so a burst of facts published in the same render frame
 * still trickle in instead of slamming the screen.
 *
 * Hidden when:
 *   - `cols < 60` — responsive guard, matches RunScreen's logo gate
 *   - `facts.length === 0` — nothing to show, no header reserved
 *
 * Cosmetic only: removing this component does not change agent behavior.
 */

import { Box, Text } from 'ink';
import { useMemo } from 'react';
import type { DiscoveryFact } from '../../../lib/wizard-session.js';
import { Colors, Icons } from '../styles.js';

/** Below this terminal width we collapse the feed to keep RunScreen scannable. */
export const MIN_COLS_FOR_DISCOVERY_FEED = 60;

/** Cap rendered rows — older facts slide off the head once we hit the limit. */
const MAX_VISIBLE = 8;

/** ms between reveal steps. Mirrors SPINNER_INTERVAL so the cadence feels coherent. */
const REVEAL_STEP_MS = 200;

interface DiscoveryFeedProps {
  facts: readonly DiscoveryFact[];
  /** Spinner tick from the parent — used to animate reveal. */
  tick: number;
  /** Terminal width — used to hide the panel on narrow terminals. */
  cols: number;
  /** Wall-clock now, for testing. Defaults to Date.now(). */
  now?: number;
}

/**
 * Pad a label to the column width used throughout the panel so the
 * value column lines up vertically. Uses ASCII spaces — Yoga's
 * monospace assumption keeps this honest.
 */
const LABEL_COL_WIDTH = 18;
const padRight = (s: string, width: number): string =>
  s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);

/**
 * Resolve the number of facts that should be visible right now based on
 * each fact's `discoveredAt` and the current wall-clock. Facts revealed
 * before `now` show; facts whose reveal time hasn't arrived yet stay
 * hidden until the next tick. Pure function — exported for unit tests.
 */
export function resolveVisibleCount(
  facts: readonly DiscoveryFact[],
  now: number,
): number {
  let count = 0;
  for (const fact of facts) {
    // Each fact gets one REVEAL_STEP_MS of "settle" so a burst trickles
    // in instead of all-at-once. Already-discovered facts (>= one step
    // old) show immediately on first render.
    if (now - fact.discoveredAt >= count * REVEAL_STEP_MS) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

export const DiscoveryFeed = ({
  facts,
  tick,
  cols,
  now = Date.now(),
}: DiscoveryFeedProps) => {
  // Reference `tick` so React doesn't dead-code-eliminate the parent's
  // spinner interval — it drives our re-render cadence.
  void tick;

  const visibleCount = resolveVisibleCount(facts, now);
  // Slice to the most recent N rows. The store doesn't cap discovery
  // facts (they're cheap to keep around for diagnostics), so the panel
  // applies its own cap so a generous SetupScreen doesn't push the rest
  // of the dashboard off-screen.
  const slice = useMemo(() => {
    const upTo = facts.slice(0, visibleCount);
    return upTo.length > MAX_VISIBLE
      ? upTo.slice(upTo.length - MAX_VISIBLE)
      : upTo;
  }, [facts, visibleCount]);

  if (cols < MIN_COLS_FOR_DISCOVERY_FEED) return null;
  if (facts.length === 0) return null;
  if (slice.length === 0) return null;

  return (
    // marginTop={1} reserves a blank row above the header so the
    // "Discovered · N facts" line reads as a NEW section rather than a
    // continuation of the task list / activity rows above it. Without
    // the gap a faint trailing row (e.g. ⋮ Progress) and the bold
    // "Discovered" header sit side-by-side and visually merge.
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={Colors.heading} bold>
          Discovered
        </Text>
        <Text color={Colors.subtle}> {Icons.dot} </Text>
        <Text color={Colors.muted}>
          {visibleCount} {visibleCount === 1 ? 'fact' : 'facts'}
        </Text>
      </Box>
      {slice.map((fact) => (
        <Box key={fact.id}>
          <Text> </Text>
          <Text color={Colors.success}>{Icons.checkmark}</Text>
          <Text> </Text>
          <Text color={Colors.muted}>
            {padRight(fact.label, LABEL_COL_WIDTH)}
          </Text>
          <Text color={Colors.body} wrap="truncate-end">
            {fact.value}
          </Text>
        </Box>
      ))}
    </Box>
  );
};

// Re-export for tests that want to assert the reveal cadence.
export { REVEAL_STEP_MS };
