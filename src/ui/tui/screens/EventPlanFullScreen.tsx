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
 *   - Events list scrolls (`flexGrow={1}`, capped to MAX_VISIBLE with
 *     `+N more` tail so very long plans don't push the action hint
 *     off-screen on a tiny terminal)
 *   - Action hint pinned to bottom (`flexShrink={0}`) — `[Y] approve
 *     [S] skip [F] feedback` is ALWAYS visible
 *
 * Keyboard surface (matches the previous inline handler exactly):
 *   - Options mode: `Y` / `S` / `F`
 *   - Feedback mode: free-text input, Enter sends, Esc cancels
 */

import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';

import { useWizardStore } from '../hooks/useWizardStore.js';
import type { WizardStore } from '../store.js';
import { Colors, Icons, Layout } from '../styles.js';
import type { PlannedEvent } from '../store.js';

/**
 * Cap on visible event rows. Sized so a 24-row terminal still has room
 * for the title + action hint with this many rows in between. Anything
 * beyond is summarized as "+N more" so the action hint never gets
 * clipped off the bottom regardless of plan size.
 */
const MAX_VISIBLE_EVENTS = 12;

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
      // options mode — explicit Y/S/F so Enter alone can't accidentally
      // approve or skip when the user just wants to dismiss something.
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

  const overflow = Math.max(0, events.length - MAX_VISIBLE_EVENTS);
  const visible = events.slice(0, MAX_VISIBLE_EVENTS);

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

      {/* Events list — scrollable area, but capped to MAX_VISIBLE_EVENTS so
          the action hint below stays on screen even on tiny terminals. */}
      <Box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        overflow="hidden"
        marginTop={1}
        gap={1}
      >
        {visible.map((e, i) => (
          <Text key={e.name || i} wrap="truncate-end">
            <Text color={Colors.accent} bold>
              {Icons.bullet} {e.name}
            </Text>
            {e.description ? (
              <Text color={Colors.secondary}> — {e.description}</Text>
            ) : null}
          </Text>
        ))}
        {overflow > 0 && (
          <Text color={Colors.muted}>
            {Icons.dot} +{overflow} more event{overflow === 1 ? '' : 's'} (full
            list saved to .amplitude/events.json on approve)
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
          </Text>
        )}
      </Box>
    </Box>
  );
};
