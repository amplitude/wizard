/**
 * AskBar — Tab-to-ask input surface (Timeline UX PR 6, killer feature).
 *
 * The user taps Tab on RunScreen with `WIZARD_NEW_UX === '1'` and AskBar
 * mounts at the bottom of the screen with the prompt focused. They type a
 * free-form question, hit Enter, and the RunScreen renders a synchronous
 * `› got it, pausing to look at that` ack line in the timeline as the
 * same React render tick as submission. That synchronous render is what
 * satisfies the 500ms-acknowledgement contract — there is no setTimeout
 * or microtask gap between Enter and the ack landing in the frame.
 *
 * Inputs vs outputs:
 *
 *   - `open` — true while the bar is mounted. When false, the component
 *     returns null. RunScreen passes `store.paused` through, which makes
 *     the bar a single-source-of-truth view of the same atom that gates
 *     the eventual SDK pause hook (see `lib/agentInterrupt.ts`).
 *   - `history` — the user's last few questions (most-recent first), used
 *     by ↑ / ↓ recall. RunScreen passes `store.askHistory` through.
 *   - `onSubmit(query)` — fires once per Enter press with a non-empty
 *     trimmed string. RunScreen does all the side effects: push history,
 *     record ack timestamp, call `agentInterrupt.inject(query)`. AskBar
 *     itself only owns the input state.
 *   - `onCancel()` — fires on Esc. RunScreen flips `paused = false` and
 *     calls `agentInterrupt.resume()` from there.
 *
 * Keybindings (Ink + `@inkjs/ui` TextInput):
 *
 *   - Enter   — submit (TextInput's `onSubmit`).
 *   - Esc     — cancel (sibling `useInput`, since TextInput swallows Esc).
 *   - ↑ / ↓   — history recall, most-recent-first / forward-walk. Pressed
 *               while the bar has focus; we update `defaultValue` via a
 *               keyed remount of TextInput so the input reflects the
 *               recalled string immediately.
 *   - Shift+Enter — would insert a newline. `@inkjs/ui` TextInput is
 *               single-line in the version pinned here and does not
 *               expose a multiline mode. Deferred — documented in PR.
 *
 * Esc / TextInput note: per CLAUDE.md, `@inkjs/ui` `TextInput` wires its
 * own stdin handler and Esc does not surface as router back by default.
 * We pair it with `useScreenInput` so Esc cancels even while focus is in
 * the input. The same pattern is used by SignupEmailScreen.
 *
 * Layout: a single-row Box pinned at the bottom of the parent column.
 * `overflow="hidden"` keeps long history recalls from blowing out the
 * row when the terminal is narrow.
 */

import { Box, Text } from 'ink';
import { useState, useMemo } from 'react';
import { TextInput } from '@inkjs/ui';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { Colors, Icons } from '../styles.js';

interface AskBarProps {
  /**
   * When false, returns null (no render). This is the closed state in the
   * snapshot suite. RunScreen passes `store.paused` through.
   */
  open: boolean;
  /**
   * Last few user questions, most-recent-first. AskBar walks this list
   * for ↑ / ↓ recall. Empty when nothing has been submitted yet.
   */
  history: readonly string[];
  /** Fires once per Enter press with a non-empty, already-trimmed string. */
  onSubmit: (query: string) => void;
  /** Fires once per Esc. */
  onCancel: () => void;
}

export const AskBar = ({ open, history, onSubmit, onCancel }: AskBarProps) => {
  // History recall walks `history` by index. `null` means "live input",
  // i.e. the user is composing a new query rather than viewing a past
  // one. The index is reset to null on every fresh open (the parent
  // remounts AskBar by toggling `open`, so the local state below is
  // already correctly reset on each open).
  const [recallIndex, setRecallIndex] = useState<number | null>(null);

  // The text shown in the input. When `recallIndex === null` we let the
  // user type freely (uncontrolled TextInput); when recall is active we
  // remount TextInput with a fresh `defaultValue` keyed on the index so
  // it picks up the recalled string immediately.
  const recallValue = useMemo<string | null>(() => {
    if (recallIndex === null) return null;
    return history[recallIndex] ?? null;
  }, [recallIndex, history]);

  useScreenInput(
    (_input, key) => {
      if (!open) return;
      if (key.escape) {
        onCancel();
        return;
      }
      // ↑ walks back in time (older entries), ↓ walks forward toward the
      // live input. We treat the index `history.length - 1` as the
      // oldest visible entry; pressing ↑ past it is a no-op.
      if (key.upArrow) {
        if (history.length === 0) return;
        setRecallIndex((current) => {
          if (current === null) return 0;
          return Math.min(current + 1, history.length - 1);
        });
        return;
      }
      if (key.downArrow) {
        if (history.length === 0) return;
        setRecallIndex((current) => {
          if (current === null) return null;
          if (current === 0) return null;
          return current - 1;
        });
        return;
      }
    },
    { isActive: open },
  );

  if (!open) return null;

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setRecallIndex(null);
    onSubmit(trimmed);
  };

  // Keying TextInput on `recallIndex` forces a remount when the user
  // walks history with ↑ / ↓ so the `defaultValue` prop actually shows
  // up. `@inkjs/ui` TextInput is uncontrolled — without the remount,
  // changes to `defaultValue` after mount are ignored.
  const inputKey = recallIndex === null ? 'live' : `recall:${recallIndex}`;
  const inputDefault = recallValue ?? '';

  return (
    <Box flexDirection="column" flexShrink={0} overflow="hidden" marginTop={1}>
      <Box paddingX={1}>
        <Text color={Colors.accent}>{Icons.chevronRight}</Text>
        <Text color={Colors.body}> ask </Text>
        <Box flexGrow={1}>
          <TextInput
            key={inputKey}
            defaultValue={inputDefault}
            placeholder="what's the agent doing right now?"
            onSubmit={handleSubmit}
          />
        </Box>
      </Box>
      <Box paddingX={1}>
        <Text color={Colors.muted}>
          {Icons.dot} Enter to send, Esc to resume
          {history.length > 0 ? `, ↑↓ to recall (${history.length})` : ''}
        </Text>
      </Box>
    </Box>
  );
};
