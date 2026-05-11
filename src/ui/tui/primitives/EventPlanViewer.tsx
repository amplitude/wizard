/**
 * EventPlanViewer — Renders a list of planned analytics events.
 *
 * Two-state rendering keyed on the file-change ledger:
 *
 *   - **Pending** events (no matching `track()` callsite found on disk
 *     yet) render with an open-circle glyph (○) and the **plan name**
 *     so the user sees what's about to land.
 *   - **Wired** events (a `track("…")` callsite appeared in one of the
 *     agent's file writes) render with a checkmark (✓) and the
 *     **wired-code name** — case-faithful to whatever the agent
 *     actually wrote on disk, even when that differs from the plan's
 *     normalized Title Case.
 *
 * This mirrors the source-of-truth fix already applied to the Outro
 * celebration screen (#746). Before this change, the Events tab during
 * the wiring phase blindly rendered `store.eventPlan` so any
 * normalize-mangling (e.g. `Ai` instead of `AI`) or user-feedback
 * divergence (the user asked for lowercase but the plan still held
 * Title Case) stuck around for the entire wiring phase.
 *
 * Why no internal ticking: the ledger lookup is memoized on the
 * caller-provided refresh key (typically `store.fileWritesTotal`, a
 * monotonic write counter). New file writes bump that counter and the
 * memo re-runs; no setInterval needed and no per-frame ledger walks.
 */

import { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { PlannedEvent } from '../store.js';
import { Colors, Icons } from '../styles.js';
import { getFileChangeLedger } from '../../../lib/file-change-ledger.js';
import {
  collectWiredEventNames,
  eventKey,
} from '../../../lib/wired-event-instrumentation.js';

interface EventPlanViewerProps {
  events: PlannedEvent[];
  /**
   * Cadence key used to invalidate the memoized ledger walk. Bump this
   * (typically `store.fileWritesTotal`) when new writes land so the
   * Events tab can re-classify plan entries as wired vs pending. When
   * absent or when no ledger is initialised, the viewer treats every
   * entry as pending — matching the original pre-#746 plan-only
   * rendering for tests / snapshot fixtures that don't bootstrap the
   * ledger.
   */
  refreshKey?: number;
}

export const EventPlanViewer = ({
  events,
  refreshKey,
}: EventPlanViewerProps) => {
  const visible = events.filter((e) => e.name.trim().length > 0);

  // Walk the ledger once per refreshKey bump. The ledger is per-run
  // and append-only during wiring, so reading it under useMemo is safe
  // — no subscription needed. When no ledger is initialised (snapshot
  // tests, the synthetic full-activation re-run path, or callers that
  // omit refreshKey), the empty map below makes every plan entry
  // render as pending — which degrades gracefully to the older
  // plan-only view.
  //
  // Bugbot 3221791773: `visible` was previously in the dep array, but
  // it's a fresh array reference every render (created by
  // `events.filter(...)` above), which defeated memoization entirely.
  // The walk is independent of `visible` — `collectWiredEventNames`
  // reads the ledger, not the plan — so dropping `visible` from the
  // deps is correct: invalidation only needs `refreshKey`.
  const wiredNames = useMemo(() => {
    const ledger = getFileChangeLedger();
    if (!ledger) return new Map<string, string>();
    return collectWiredEventNames(ledger.getEntries());
  }, [refreshKey]);

  if (visible.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>Event plan</Text>
        <Box height={1} />
        <Text color={Colors.muted}>
          Waiting for the agent to propose events...
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Event plan</Text>
      <Box height={1} />
      {visible.map((event) => {
        // wiredNames is keyed by the lowercase-collapsed event name and
        // its value is the original casing pulled from the `track()`
        // callsite. When present, that's our source of truth — render
        // it instead of the plan-normalized name.
        const wired = wiredNames.get(eventKey(event.name));
        const isWired = wired !== undefined;
        const displayName = wired ?? event.name;
        // Different glyph per state so the user can tell at a glance
        // which events have already landed in code (✓, success colour)
        // vs which the agent is still in the process of wiring (○,
        // muted). The wired-code casing in `displayName` makes the
        // source-of-truth visible too.
        const glyph = isWired ? Icons.checkmark : Icons.bulletOpen;
        const glyphColor = isWired ? Colors.success : Colors.muted;
        return (
          <Text key={event.name} color={Colors.muted}>
            <Text color={glyphColor}>{glyph}</Text>{' '}
            <Text color={Colors.accent} bold>
              {displayName}
            </Text>
            {event.description ? ` — ${event.description}` : ''}
          </Text>
        );
      })}
    </Box>
  );
};
