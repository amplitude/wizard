/**
 * RunTimeline — composer for the new Timeline UX (PR 4 of 10).
 *
 * Renders a vertical, append-friendly layout inside RunScreen when
 * `WIZARD_NEW_UX=1` is set:
 *
 *   ⠋ <latest status message>
 *
 *   ✓ Detected framework
 *   ❯ Wiring up SDK…
 *   ○ Confirm event plan
 *   ○ Save events
 *   ○ Build starter dashboard
 *
 *   ✎ src/amplitude.ts  +42 −0
 *   ✎ app/layout.tsx    +3 −1
 *   ✎ .env.local        modify
 *
 *   ◌ MCP install · Slack notify             (extras row, lilac)
 *
 *   elapsed 47s
 *
 * Subscriptions use `useAtomSelector` so each slice is memoized — when
 * the agent ticks but the slice we care about hasn't changed the
 * selector returns the same reference and downstream `React.memo`
 * can short-circuit.
 *
 * Capability detection is inlined (PR 1's terminalCapabilities helper
 * isn't yet on `feat/timeline-ux`) — we just check for UTF-8 in the
 * locale env vars, and honor `WIZARD_FORCE_ASCII=1` as an override.
 *
 * Extras row: PostAgentStep has no `type` discriminator, and MCP /
 * Slack are tracked via Overlay enum on the router, not via
 * postAgentSteps. So we surface lilac extras when those overlays are
 * pending — read by checking `router.hasOverlay` plus the queue if
 * exposed (today we only have a boolean). See AC notes in PR 4 body.
 */

import { Box, Text } from 'ink';
import { useCallback } from 'react';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { useAtomSelector, shallowArrayEqual } from '../hooks/useAtomSelector.js';
import { BrailleSpinner } from './BrailleSpinner.js';
import { RunTimelineTodos } from './RunTimelineTodos.js';
import { RunTimelineLedger } from './RunTimelineLedger.js';
import { Colors } from '../styles.js';
import { supportsUnicode } from '../lib/terminalCapabilities.js';
import type { WizardStore, TaskItem, FileWriteEntry } from '../store.js';

const MAX_TODOS = 5;
const LEDGER_WIDE_MAX = 5;
const LEDGER_NARROW_MAX = 3;
const NARROW_THRESHOLD = 100;
const EXTRAS_MIN_COLS = 60;

interface RunTimelineProps {
  store: WizardStore;
}

// Stable selectors hoisted so useAtomSelector doesn't resubscribe per
// render. Each one is a pure function over the store.
const selectLatestStatus = (store: WizardStore): string | null => {
  const all = store.statusMessages;
  if (all.length === 0) return null;
  return all[all.length - 1];
};

const selectTopTasks = (store: WizardStore): readonly TaskItem[] =>
  store.tasks.slice(0, MAX_TODOS);

const selectInstallDir = (store: WizardStore): string => store.session.installDir;

const selectRunStartedAt = (store: WizardStore): number | null =>
  store.session.runStartedAt;

const selectOverlayActive = (store: WizardStore): boolean => store.router.hasOverlay;

export const RunTimeline = ({ store }: RunTimelineProps) => {
  const [cols] = useStdoutDimensions();
  const narrow = cols < NARROW_THRESHOLD;
  const ledgerMax = narrow ? LEDGER_NARROW_MAX : LEDGER_WIDE_MAX;
  const unicode = supportsUnicode();

  const status = useAtomSelector(store, selectLatestStatus);
  const tasks = useAtomSelector(store, selectTopTasks, shallowArrayEqual);

  // Last-N file writes. Slicing inside a memoized selector keeps the
  // reference stable when the tail hasn't grown.
  const selectTailWrites = useCallback(
    (s: WizardStore): readonly FileWriteEntry[] => {
      const all = s.fileWrites;
      if (all.length <= ledgerMax) return all;
      return all.slice(all.length - ledgerMax);
    },
    [ledgerMax],
  );
  const tailWrites = useAtomSelector(store, selectTailWrites, shallowArrayEqual);

  const installDir = useAtomSelector(store, selectInstallDir);
  const runStartedAt = useAtomSelector(store, selectRunStartedAt);
  const overlayActive = useAtomSelector(store, selectOverlayActive);

  const elapsedSeconds =
    runStartedAt !== null
      ? Math.max(0, Math.floor((Date.now() - runStartedAt) / 1000))
      : null;

  return (
    <Box flexDirection="column" overflow="hidden">
      {status !== null && (
        <Box>
          <BrailleSpinner />
          <Text> </Text>
          <Text color={Colors.body}>{status}</Text>
        </Box>
      )}

      {tasks.length > 0 && (
        <Box flexDirection="column" marginTop={status !== null ? 1 : 0}>
          <RunTimelineTodos tasks={tasks} unicode={unicode} />
        </Box>
      )}

      {tailWrites.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <RunTimelineLedger
            entries={tailWrites}
            installDir={installDir}
            width={cols}
            unicode={unicode}
          />
        </Box>
      )}

      {cols >= EXTRAS_MIN_COLS && overlayActive && (
        <Box marginTop={1}>
          <Text color={Colors.accentSecondary}>
            {unicode ? '◌' : 'o'} queued: review pending step
          </Text>
        </Box>
      )}

      {elapsedSeconds !== null && (
        <Box marginTop={1}>
          <Text color={Colors.muted}>elapsed {elapsedSeconds}s</Text>
        </Box>
      )}
    </Box>
  );
};
