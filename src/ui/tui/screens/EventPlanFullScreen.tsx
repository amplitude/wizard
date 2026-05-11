/**
 * EventPlanFullScreen — full-terminal event-plan approval view.
 *
 * Rendered by App.tsx (NOT ConsoleView) when `store.pendingPrompt.kind ===
 * 'event-plan'`. Bypasses the journey stepper / header / tasks / file-writes
 * panel chrome so the prompt cannot be squeezed to zero height by parent
 * flex children — which is what made the inline ConsoleView path
 * intermittently invisible on smaller terminals (the user reported
 * "adjusting terminal size brought it back").
 *
 * On round 2+ (i.e. after the user gave feedback at least once via [F]),
 * the screen renders a conversational header showing what the user said
 * and per-event diff markers against the prior round: `+` added (green),
 * `−` removed (red, struck-through), unchanged events render plain. This
 * makes the feedback loop feel like a back-and-forth between the user
 * and the AI instead of an opaque list-replacement that erased context.
 *
 * Layout invariants:
 *   - Title pinned to top (`flexShrink={0}`)
 *   - Optional conversation block (rounds ≥ 2 only) — between title and list
 *   - Events list grows to fill available rows (`flexGrow={1}`,
 *     `overflow="hidden"`). The visible window is sized from the `height`
 *     prop so we never silently clip past the viewport, and any overflow
 *     is reachable via ↑/↓ / PgUp / PgDn scrolling.
 *   - Action hint pinned to bottom (`flexShrink={0}`) — `[Y] approve
 *     [S] skip [F] feedback` is ALWAYS visible, plus `[↑/↓] scroll` when
 *     the plan exceeds the viewport.
 *
 * Keyboard surface:
 *   - Options mode: `Y` / `S` / `F`, plus ↑/↓ / PgUp / PgDn for scroll
 *   - Feedback mode: free-text input, Enter sends, Esc cancels
 */

import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';

import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { useTimedCoaching } from '../hooks/useTimedCoaching.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import type { WizardStore } from '../store.js';
import { Colors, Icons, Layout } from '../styles.js';
import type { PlannedEvent } from '../store.js';

/**
 * Compute per-event diff between two plans. Membership is by name —
 * the agent regenerates descriptions on revision, so diffing on
 * description would falsely flag unchanged events as "modified".
 */
type DiffMarker = 'added' | 'removed' | 'unchanged';

function diffEvents(
  prior: PlannedEvent[],
  current: PlannedEvent[],
): {
  rows: Array<{ event: PlannedEvent; marker: DiffMarker }>;
  added: number;
  removed: number;
} {
  const priorNames = new Set(prior.map((e) => e.name));
  const currentNames = new Set(current.map((e) => e.name));
  const rows: Array<{ event: PlannedEvent; marker: DiffMarker }> = [];
  let added = 0;
  let removed = 0;
  // Render removed events first so the user sees what was dropped before
  // scanning the kept/added rows.
  for (const e of prior) {
    if (!currentNames.has(e.name)) {
      rows.push({ event: e, marker: 'removed' });
      removed += 1;
    }
  }
  for (const e of current) {
    if (priorNames.has(e.name)) {
      rows.push({ event: e, marker: 'unchanged' });
    } else {
      rows.push({ event: e, marker: 'added' });
      added += 1;
    }
  }
  return { rows, added, removed };
}

/**
 * Rows of chrome consumed by everything OTHER than the events list:
 *   2  outer paddingY (top + bottom)
 *   2  title block (subtitle + bold title line)
 *   1  events-box marginTop
 *   1  hint-box marginTop
 *   1  hint content row
 */
const CHROME_ROWS = 7;
/**
 * Extra rows the conversational header consumes when rendering
 * round ≥ 2: 1 spacer + 1 "you said" row + 1 quoted-feedback row +
 * 1 "+N -M" delta row + 1 trailing spacer = 5.
 */
const CONVO_HEADER_ROWS = 5;

interface EventPlanFullScreenProps {
  store: WizardStore;
  events: PlannedEvent[];
  width: number;
  height: number;
}

export const EventPlanFullScreen = ({
  store,
  events,
  width,
  height,
}: EventPlanFullScreenProps) => {
  // Subscribe to store changes so re-renders propagate (prevents the
  // intermittent-invisibility regression we hit when the inline render
  // depended on a parent re-render to read the freshest pendingPrompt).
  useWizardStore(store);

  // When the user just submitted feedback we keep this screen mounted
  // (via App.tsx's showEventPlan) and render a "Revising your plan…"
  // state instead of the plan list + input. The feedback text is
  // quoted back so the wait reads as "the agent is working on what I
  // asked for", not "the wizard skipped my feedback".
  const pendingFeedback = store.session.pendingEventPlanFeedback;
  const isRevising = pendingFeedback !== null;

  const [planInputMode, setPlanInputMode] = useState<'options' | 'feedback'>(
    'options',
  );
  const [planFeedbackText, setPlanFeedbackText] = useState('');
  const [cursorVisible, setCursorVisible] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Round-aware view: the prior round (if any) gives us the diff context
  // that turns this from "list replacement" into "conversation". `prior`
  // is the plan the user saw last time before they pressed `[F]`; `last`
  // is the round we're currently displaying.
  const rounds = store.eventPlanRounds;
  const last = rounds.length > 0 ? rounds[rounds.length - 1] : null;
  const prior = rounds.length > 1 ? rounds[rounds.length - 2] : null;
  const isRevision = last !== null && last.feedback !== null && prior !== null;
  const diff =
    isRevision && prior && last
      ? diffEvents(prior.plan, last.plan)
      : null;
  const rowsToRender: Array<{ event: PlannedEvent; marker: DiffMarker }> = diff
    ? diff.rows
    : events.map((event) => ({ event, marker: 'unchanged' as const }));

  // Rows available for the events list itself, derived from the current
  // viewport height. Sizing the window here (instead of from a hard cap
  // like MAX_VISIBLE_EVENTS) means events can never be silently clipped
  // by Yoga's overflow="hidden" — anything that doesn't fit goes behind
  // a scroll indicator the user can reach with the arrow keys.
  const chromeRows = CHROME_ROWS + (isRevision ? CONVO_HEADER_ROWS : 0);
  const eventsBudget = Math.max(1, height - chromeRows);
  const needsScroll = rowsToRender.length > eventsBudget;
  // Reserve one row for the scroll-state indicator when scrolling is on.
  const visibleCount = needsScroll
    ? Math.max(1, eventsBudget - 1)
    : eventsBudget;
  const maxOffset = Math.max(0, rowsToRender.length - visibleCount);
  const clampedOffset = Math.min(scrollOffset, maxOffset);
  const visible = rowsToRender.slice(
    clampedOffset,
    clampedOffset + visibleCount,
  );
  const above = clampedOffset;
  const below = rowsToRender.length - clampedOffset - visible.length;

  // Blink the cursor in feedback mode (purely cosmetic).
  useEffect(() => {
    if (planInputMode !== 'feedback') return;
    const id = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, [planInputMode]);

  // Coaching escalation while we wait for the agent's revised plan.
  // tier 0 (< 5s): just the spinner; tier 1 (>= 5s): add a "typically
  // 10–30s" hint so the user knows the wait is normal. progressSignal
  // pinned to the feedback text so a brand-new round-trip restarts
  // the timer cleanly.
  const { tier: revisingCoachingTier } = useTimedCoaching({
    thresholds: [5],
    progressSignal: pendingFeedback,
  });

  useInput(
    (char, key) => {
      if (planInputMode === 'feedback') {
        if (key.return) {
          const text = planFeedbackText.trim();
          if (text) {
            store.resolveEventPlan({ decision: 'revised', feedback: text });
            setPlanFeedbackText('');
            setPlanInputMode('options');
          }
          return;
        }
        if (key.escape) {
          setPlanInputMode('options');
          setPlanFeedbackText('');
          return;
        }
        if (key.backspace || key.delete) {
          setPlanFeedbackText((v) => v.slice(0, -1));
          return;
        }
        if (!key.ctrl && !key.meta && !key.tab && char) {
          setPlanFeedbackText((v) => v + char);
        }
        return;
      }
      // options mode — scroll first so arrow keys never fall through to
      // Y/S/F handling.
      if (key.upArrow) {
        setScrollOffset((o) => Math.max(0, o - 1));
        return;
      }
      if (key.downArrow) {
        setScrollOffset((o) => Math.min(maxOffset, o + 1));
        return;
      }
      if (key.pageUp) {
        setScrollOffset((o) => Math.max(0, o - visibleCount));
        return;
      }
      if (key.pageDown) {
        setScrollOffset((o) => Math.min(maxOffset, o + visibleCount));
        return;
      }
      // Explicit Y/S/F so Enter alone can't accidentally approve or skip
      // when the user just wants to dismiss something.
      const lc = char.toLowerCase();
      if (lc === 'y') {
        store.resolveEventPlan({ decision: 'approved' });
      } else if (lc === 's') {
        store.resolveEventPlan({ decision: 'skipped' });
      } else if (lc === 'f') {
        setPlanInputMode('feedback');
      }
    },
    // Suppress Y/S/F + scroll input while waiting for the revised
    // plan to land. The agent is mid-revision; another keypress here
    // would either be ignored (good) or, worse, sneak into a stale
    // resolveEventPlan call (bad — `pendingPrompt` is already null).
    { isActive: !isRevising },
  );

  // Revising state — replaces the plan list + Y/S/F hint with a
  // calm "we're working on it" panel. Renders BEFORE the normal
  // approval UI so the user never glimpses the old plan list with
  // their feedback typed below it during the round-trip.
  if (isRevising) {
    return (
      <Box
        flexDirection="column"
        width={width}
        height={height}
        paddingX={Layout.paddingX}
        paddingY={1}
      >
        <Box flexDirection="column" flexShrink={0}>
          <Text color={Colors.muted}>Updating your event plan:</Text>
          <Text color={Colors.heading} bold>
            Revising your plan…
          </Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} marginTop={1}>
          <Text color={Colors.muted}>Your feedback:</Text>
          <Text color={Colors.accent} wrap="wrap">
            “{pendingFeedback}”
          </Text>
          <Box marginTop={1}>
            <Text>
              <BrailleSpinner color={Colors.accent} />
              <Text color={Colors.secondary}>
                {' '}
                agent is generating a revised plan
              </Text>
            </Text>
          </Box>
          {revisingCoachingTier >= 1 && (
            <Box marginTop={1}>
              <Text color={Colors.muted}>
                This typically takes 10–30s — hang tight.
              </Text>
            </Box>
          )}
        </Box>
        <Box flexShrink={0} marginTop={1}>
          <Text color={Colors.muted}>
            The plan will reappear here automatically once the agent
            finishes.
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      paddingX={Layout.paddingX}
      paddingY={1}
    >
      {/* Title — pinned to top */}
      <Box flexDirection="column" flexShrink={0}>
        <Text color={Colors.muted}>
          {isRevision
            ? `Round ${rounds.length} — revised after your feedback:`
            : 'Suggested events for your app:'}
        </Text>
        <Text color={Colors.heading} bold>
          Instrumentation Plan ({events.length} event
          {events.length === 1 ? '' : 's'})
        </Text>
      </Box>

      {/* Conversational header — only on rounds ≥ 2. Quotes the user's
          most recent feedback and shows the AI's net response (+N added,
          -M removed) so the user can see at a glance whether their
          intent landed before scanning the list. */}
      {isRevision && last?.feedback && diff ? (
        <Box flexDirection="column" flexShrink={0} marginTop={1}>
          <Text color={Colors.muted}>
            <Text color={Colors.heading} bold>
              You
            </Text>
            : <Text color={Colors.secondary}>"{last.feedback}"</Text>
          </Text>
          <Text color={Colors.muted}>
            <Text color={Colors.heading} bold>
              AI
            </Text>
            : revised plan{' '}
            {diff.added > 0 ? (
              <Text color={Colors.success}>+{diff.added} added</Text>
            ) : null}
            {diff.added > 0 && diff.removed > 0 ? (
              <Text color={Colors.muted}> · </Text>
            ) : null}
            {diff.removed > 0 ? (
              <Text color={Colors.error}>−{diff.removed} removed</Text>
            ) : null}
            {diff.added === 0 && diff.removed === 0 ? (
              <Text color={Colors.muted}>(same set of events)</Text>
            ) : null}
          </Text>
        </Box>
      ) : null}

      {/* Events list — fills the remaining vertical space, but the visible
          window is bounded by `visibleCount` so nothing gets silently
          clipped. Anything outside the window is reachable via the scroll
          indicator below. */}
      <Box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        overflow="hidden"
        marginTop={1}
      >
        {visible.map((row, i) => {
          const { event: e, marker } = row;
          const markerGlyph =
            marker === 'added'
              ? '+'
              : marker === 'removed'
                ? '−'
                : Icons.bullet;
          const markerColor =
            marker === 'added'
              ? Colors.success
              : marker === 'removed'
                ? Colors.error
                : Colors.accent;
          const nameColor =
            marker === 'removed' ? Colors.muted : Colors.accent;
          return (
            <Text
              key={`${clampedOffset + i}-${marker}-${e.name || ''}`}
              wrap="truncate-end"
            >
              <Text color={markerColor} bold>
                {markerGlyph}{' '}
              </Text>
              <Text
                color={nameColor}
                bold
                strikethrough={marker === 'removed'}
              >
                {e.name}
              </Text>
              {e.description ? (
                <Text color={Colors.secondary}> — {e.description}</Text>
              ) : null}
            </Text>
          );
        })}
        {needsScroll && (
          <Text color={Colors.muted}>
            {Icons.dot}
            {above > 0 ? ` ${above} more above` : ''}
            {above > 0 && below > 0 ? ' ·' : ''}
            {below > 0 ? ` ${below} more below` : ''} (full list saved to
            .amplitude/events.json on approve)
          </Text>
        )}
      </Box>

      {/* Action hint — pinned to bottom, always visible */}
      <Box flexShrink={0} marginTop={1} flexDirection="column">
        {planInputMode === 'feedback' ? (
          <Box gap={1}>
            <Text color={Colors.muted}>Feedback: </Text>
            <Text>
              {planFeedbackText}
              {cursorVisible ? '▎' : ' '}
            </Text>
            <Text color={Colors.muted}>[Enter] send [Esc] cancel</Text>
          </Box>
        ) : (
          <Text color={Colors.muted}>
            [Y] approve [S] skip [F] give feedback
            {needsScroll ? ' [↑/↓] scroll' : ''}
          </Text>
        )}
      </Box>
    </Box>
  );
};
