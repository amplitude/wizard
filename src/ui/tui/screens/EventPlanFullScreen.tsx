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
 * Layout invariants:
 *   - Title pinned to top (`flexShrink={0}`)
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
 *   - Revising state: Esc cancels the revision (preserves original plan)
 *
 * Revising recovery (this file, below):
 *   - Progressive coaching tiers escalate at 30s / 60s / 180s so the user
 *     never stares at "the agent is working" forever.
 *   - Esc clears `pendingEventPlanFeedback` and surfaces an abandonment
 *     banner above the original plan ("feedback wasn't applied…").
 *   - A 5-minute watchdog fires the same cancel path with a timeout
 *     banner so a stuck agent can't trap the wizard indefinitely.
 */

import { Box, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';

import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import type { WizardStore } from '../store.js';
import { Colors, Icons, Layout } from '../styles.js';
import type { PlannedEvent } from '../store.js';

/**
 * Revising-state escalation thresholds. Exported so tests can pin the
 * boundaries without time-travelling around magic numbers.
 *
 * Names match the tier VALUE rendered by `revisingCoachingCopy`, not
 * an ordinal "second / third / fourth" position — `REVISION_TIER_1_MS`
 * is the threshold at which `revisingTier` flips to 1, etc. The earlier
 * `_TWO / _THREE / _FOUR` naming was off by one and Bugbot-flagged
 * (comment 3235276642) as confusing for future threshold edits.
 *
 *   tier 1 (>= 30s)  — "taking a bit longer than usual"
 *   tier 2 (>= 60s)  — "may have decided your feedback wasn't actionable…"
 *   tier 3 (>= 3min) — strong nudge to press Esc
 *   watchdog (5min)  — auto-cancel the revision with a timeout banner
 */
export const REVISION_TIER_1_MS = 30_000;
export const REVISION_TIER_2_MS = 60_000;
export const REVISION_TIER_3_MS = 3 * 60_000;
export const REVISION_WATCHDOG_MS = 5 * 60_000;

/** Tick cadence for the elapsed counter while revising. */
const REVISION_TICK_MS = 1_000;

/** Banner copy strings — exported for test pinning. */
export const REVISION_ABANDONED_BANNER =
  "(feedback wasn't applied — agent didn't return a revised plan)";
export const REVISION_TIMEOUT_BANNER =
  'Revision timed out after 5min. Original plan preserved.';

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
 * Additional rows consumed when the abandon/timeout banner is showing
 * above the title. The banner renders with `wrap="wrap"` — its copy is
 * ~50–60 chars so on a 120-col terminal it's one row, and on a narrow
 * 60-col terminal it can wrap to two. Reserve two rows so the events
 * list can never get silently clipped past the viewport when the
 * banner is up (Bugbot MEDIUM — comment 3235276632).
 */
const BANNER_ROWS = 2;

interface EventPlanFullScreenProps {
  store: WizardStore;
  events: PlannedEvent[];
  width: number;
  height: number;
}

/**
 * Progressive coaching copy for the revising state. Tiers escalate as
 * `revisingElapsedMs` crosses the `REVISION_TIER_*_MS` thresholds — the
 * goal is that a user who typed a non-actionable thing like "hey" reads
 * the screen and eventually presses Esc instead of staring at a forever
 * spinner. Exported so tests can pin the exact strings.
 */
export function revisingCoachingCopy(tier: number): string {
  if (tier >= 3) {
    return "Agent hasn't returned. Your feedback may not have been actionable (e.g. too vague, contradictory). Press [Esc] to keep the original plan.";
  }
  if (tier >= 2) {
    return "The agent may have decided your feedback wasn't actionable. Press [Esc] to keep the original plan and continue, or wait another minute.";
  }
  if (tier >= 1) {
    return 'Taking a bit longer than usual — the agent is still working.';
  }
  return 'This typically takes 10–30s — hang tight.';
}

/** Format `elapsedMs` as `12s` or `1m 42s`. */
export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
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

  // Abandonment banner — surfaced above the original plan list after
  // the user (or the watchdog) cancels an in-flight revision. Lives in
  // session state (NOT local React state) because the cancel path
  // also clears `pendingEventPlanFeedback`, and `pendingEventPlanFeedback
  // → null` used to unmount this whole screen via App.tsx's
  // `showEventPlan` check, destroying any component-local banner before
  // the user ever read it. App.tsx now also keeps the screen mounted
  // while the banner is non-null. (Bugbot HIGH — comment 3235276649.)
  const abandonedBanner = store.session.eventPlanRevisionBanner;

  // "Banner-only" state: the user already resolved the original
  // `confirm_event_plan` prompt with feedback (so $pendingPrompt is
  // null) and then either pressed Esc or hit the 5-minute watchdog
  // (clearing pendingEventPlanFeedback while raising the banner).
  // EventPlanFullScreen is only mounted here because the banner is
  // non-null — there's no prompt left to approve / skip / feedback.
  // Y/S/F would all silently no-op against the resolveEventPlan guard,
  // which Bugbot MEDIUM (comment 3235413202) flagged as a trap UX. We
  // render a [Dismiss] hint instead, and treat any keypress as
  // "ack the banner, take me back to the run view". The agent moves
  // on through whatever phase it's in next.
  const pendingPrompt = store.pendingPrompt;
  const bannerOnly =
    abandonedBanner !== null && pendingPrompt === null && !isRevising;

  // Rows available for the events list itself, derived from the current
  // viewport height. Sizing the window here (instead of from a hard cap
  // like MAX_VISIBLE_EVENTS) means events can never be silently clipped
  // by Yoga's overflow="hidden" — anything that doesn't fit goes behind
  // a scroll indicator the user can reach with the arrow keys.
  //
  // When the abandon/timeout banner is up the title block grows by 1–2
  // rows (long copy may wrap on narrow terminals), so we widen the
  // chrome budget accordingly. Without this the visible slice would
  // overestimate available rows and the bottom events would be silently
  // clipped under `overflow="hidden"`. (Bugbot MEDIUM — 3235276632.)
  const chromeRows = CHROME_ROWS + (abandonedBanner !== null ? BANNER_ROWS : 0);
  const eventsBudget = Math.max(1, height - chromeRows);
  const needsScroll = events.length > eventsBudget;
  // Reserve one row for the scroll-state indicator when scrolling is on.
  const visibleCount = needsScroll
    ? Math.max(1, eventsBudget - 1)
    : eventsBudget;
  const maxOffset = Math.max(0, events.length - visibleCount);
  const clampedOffset = Math.min(scrollOffset, maxOffset);
  const visible = events.slice(clampedOffset, clampedOffset + visibleCount);
  const above = clampedOffset;
  const below = events.length - clampedOffset - visible.length;

  // Blink the cursor in feedback mode (purely cosmetic).
  useEffect(() => {
    if (planInputMode !== 'feedback') return;
    const id = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, [planInputMode]);

  // Elapsed-since-feedback-sent tracking for the revising state. We can't
  // reuse `useTimedCoaching` here because (a) we need millisecond
  // granularity for the watchdog and (b) we want a real `Date.now()`
  // baseline that survives Ink re-renders. The baseline pins on the
  // feedback text so a fresh round-trip restarts the timer cleanly.
  const [revisingElapsedMs, setRevisingElapsedMs] = useState(0);
  const revisingStartRef = useRef<number | null>(null);
  // Guard so the watchdog fires exactly once per pending-feedback
  // instance — without it a rapid burst of timer ticks past the
  // threshold could call the cancel path repeatedly.
  const watchdogFiredRef = useRef(false);

  useEffect(() => {
    if (!isRevising) {
      revisingStartRef.current = null;
      watchdogFiredRef.current = false;
      setRevisingElapsedMs(0);
      return;
    }
    revisingStartRef.current = Date.now();
    watchdogFiredRef.current = false;
    setRevisingElapsedMs(0);
    const id = setInterval(() => {
      if (revisingStartRef.current === null) return;
      const elapsed = Date.now() - revisingStartRef.current;
      setRevisingElapsedMs(elapsed);
      if (
        elapsed >= REVISION_WATCHDOG_MS &&
        !watchdogFiredRef.current &&
        store.session.pendingEventPlanFeedback !== null
      ) {
        watchdogFiredRef.current = true;
        // Set the banner FIRST so the next render (driven by the
        // clear-feedback emitChange) already has both pieces of state
        // ready — otherwise there's a one-frame window where
        // pendingEventPlanFeedback is null and the banner is still null,
        // which would briefly render the plain plan list before the
        // banner pops in.
        store.setEventPlanRevisionBanner(REVISION_TIMEOUT_BANNER);
        store.clearPendingEventPlanFeedback();
      }
    }, REVISION_TICK_MS);
    return () => clearInterval(id);
    // pendingFeedback pinned so a fresh feedback round restarts cleanly;
    // `store` is stable for the lifetime of the screen so it does not
    // need to be a dependency.
  }, [isRevising, pendingFeedback]);

  // Tier derivation from elapsed ms. Plain number comparison so test
  // fixtures can step the clock and assert tier copy directly.
  let revisingTier = 0;
  if (revisingElapsedMs >= REVISION_TIER_1_MS) revisingTier = 1;
  if (revisingElapsedMs >= REVISION_TIER_2_MS) revisingTier = 2;
  if (revisingElapsedMs >= REVISION_TIER_3_MS) revisingTier = 3;

  // Esc cancels the revision: clears the pending feedback (returning the
  // user to the original plan) and raises an abandonment banner so the
  // next render explains why the input was discarded. Active only while
  // revising; the main `useInput` below already handles Esc inside the
  // feedback typing mode.
  useScreenInput(
    (_char, key) => {
      if (!key.escape) return;
      if (store.session.pendingEventPlanFeedback === null) return;
      // Banner first (same ordering rationale as the watchdog) — the
      // emitChange from clearPendingEventPlanFeedback then drives a
      // single render with both the banner present AND the original
      // plan visible.
      store.setEventPlanRevisionBanner(REVISION_ABANDONED_BANNER);
      store.clearPendingEventPlanFeedback();
    },
    { isActive: isRevising },
  );

  useInput(
    (char, key) => {
      // Banner-only state: there's no prompt to act on. Treat any key
      // as "dismiss banner and return to the run view" so the user
      // isn't trapped staring at non-functional Y/S/F hints. (Bugbot
      // MEDIUM — comment 3235413202.) Ctrl/meta combos pass through
      // untouched so Ctrl+C still exits.
      if (bannerOnly) {
        if (key.ctrl || key.meta) return;
        store.setEventPlanRevisionBanner(null);
        return;
      }
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
    const coachingCopy = revisingCoachingCopy(revisingTier);
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
          <Box marginTop={1}>
            <Text color={Colors.muted} wrap="wrap">
              {coachingCopy}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={Colors.subtle}>
              elapsed: {formatElapsed(revisingElapsedMs)}
            </Text>
          </Box>
        </Box>
        <Box flexShrink={0} marginTop={1}>
          <Text color={Colors.muted}>
            [Esc] keep original plan · the revised plan will appear here
            automatically once the agent finishes.
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
        {abandonedBanner !== null && (
          <Text color={Colors.warning} wrap="wrap">
            {Icons.warning} {abandonedBanner}
          </Text>
        )}
        <Text color={Colors.muted}>Suggested events for your app:</Text>
        <Text color={Colors.heading} bold>
          Instrumentation Plan ({events.length} event
          {events.length === 1 ? '' : 's'})
        </Text>
      </Box>

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
        {visible.map((e, i) => (
          <Text
            key={`${clampedOffset + i}-${e.name || ''}`}
            wrap="truncate-end"
          >
            <Text color={Colors.accent} bold>
              {Icons.bullet} {e.name}
            </Text>
            {e.description ? (
              <Text color={Colors.secondary}> — {e.description}</Text>
            ) : null}
          </Text>
        ))}
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

      {/* Action hint — pinned to bottom, always visible. Three modes:
          - banner-only (no prompt to act on, user just needs to ack
            the abandon/timeout banner)
          - feedback typing
          - normal Y/S/F options */}
      <Box flexShrink={0} marginTop={1} flexDirection="column">
        {bannerOnly ? (
          <Text color={Colors.muted}>
            [Any key] dismiss · the agent is moving on to the next step
          </Text>
        ) : planInputMode === 'feedback' ? (
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
