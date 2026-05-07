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
 */

import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';

import { useWizardStore } from '../hooks/useWizardStore.js';
import type { WizardStore } from '../store.js';
import { Colors, Icons, Layout } from '../styles.js';
import type { PlannedEvent } from '../store.js';

/**
 * Rows of chrome consumed by everything OTHER than the events list:
 *   2  outer paddingY (top + bottom)
 *   2  title block (subtitle + bold title line)
 *   1  events-box marginTop
 *   1  hint-box marginTop
 *   1  hint content row
 */
const CHROME_ROWS = 7;

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

  const [planInputMode, setPlanInputMode] = useState<'options' | 'feedback'>(
    'options',
  );
  const [planFeedbackText, setPlanFeedbackText] = useState('');
  const [cursorVisible, setCursorVisible] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Rows available for the events list itself, derived from the current
  // viewport height. Sizing the window here (instead of from a hard cap
  // like MAX_VISIBLE_EVENTS) means events can never be silently clipped
  // by Yoga's overflow="hidden" — anything that doesn't fit goes behind
  // a scroll indicator the user can reach with the arrow keys.
  const eventsBudget = Math.max(1, height - CHROME_ROWS);
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
    { isActive: true },
  );

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
