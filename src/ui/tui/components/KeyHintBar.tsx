/**
 * KeyHintBar — context-sensitive keyboard shortcut display.
 *
 * Each screen declares its available keys; the bar renders them.
 * Always shows / and Tab hints so users discover commands and questions.
 *
 * Width awareness:
 *   - At/above COMPACT_THRESHOLD (60 cols), renders the full
 *     "[Tab] Ask a question" form.
 *   - Below COMPACT_THRESHOLD, switches to a compact form
 *     ("tab ask", "/ cmds", "^C cancel", "←→ tabs") so single-token
 *     labels never wrap mid-word.
 *   - Below MIN_THRESHOLD (40 cols), drops non-essential hints from
 *     the right so the essentials (cancel + commands) always fit.
 *
 * The bar uses `flexShrink={0}` on each hint so individual hints can
 * overflow the row rather than being word-wrapped — the parent box
 * uses `overflow="hidden"` so ANSI control sequences stay clean.
 */

import { Box, Text } from 'ink';
import { Colors } from '../styles.js';

export interface KeyHint {
  key: string; // e.g. "Enter", "/", "Tab", "Esc"
  label: string; // e.g. "Continue", "Commands"
  /** Optional short forms used below COMPACT_THRESHOLD. */
  shortKey?: string;
  shortLabel?: string;
  /** When true, this hint is dropped first under MIN_THRESHOLD. */
  optional?: boolean;
}

interface KeyHintBarProps {
  hints?: KeyHint[];
  width: number;
  showDefaults?: boolean;
  /** When false, hides the "Tab → Ask a question" hint (e.g. before auth). */
  showAskHint?: boolean;
}

/** Below this width, render the compact label form. */
export const COMPACT_THRESHOLD = 60;
/** Below this width, drop optional hints to keep essentials visible. */
export const MIN_THRESHOLD = 40;

const COMMANDS_HINT: KeyHint = {
  key: '/',
  label: 'Commands',
  shortKey: '/',
  shortLabel: 'cmds',
};
const ASK_HINT: KeyHint = {
  key: 'Tab',
  label: 'Ask a question',
  shortKey: 'tab',
  shortLabel: 'ask',
  optional: true,
};

/**
 * Per-hint compact-mode short forms for known keys, applied when a hint
 * doesn't carry its own `shortKey` / `shortLabel`. Mirrors the Claude
 * Code key hint vocabulary so users with muscle memory still recognize
 * the bindings.
 */
const COMPACT_KEY_FALLBACKS: Record<string, string> = {
  'Ctrl+C': '^C',
  'Ctrl+D': '^D',
  Enter: 'enter',
  Esc: 'esc',
  Tab: 'tab',
};

const COMPACT_LABEL_FALLBACKS: Record<string, string> = {
  Cancel: 'cancel',
  Commands: 'cmds',
  Continue: 'go',
  'Ask a question': 'ask',
  Tabs: 'tabs',
  Navigate: 'nav',
  Select: 'pick',
};

const compactKey = (hint: KeyHint): string =>
  hint.shortKey ?? COMPACT_KEY_FALLBACKS[hint.key] ?? hint.key.toLowerCase();

const compactLabel = (hint: KeyHint): string =>
  hint.shortLabel ??
  COMPACT_LABEL_FALLBACKS[hint.label] ??
  hint.label.toLowerCase();

/**
 * Approximate column cost of a hint in full or compact mode. Used to
 * trim the hint list when the terminal is below MIN_THRESHOLD so single
 * hints never wrap and the most important hints stay visible.
 *
 * The estimate intentionally over-counts (uses the un-condensed form)
 * so we drop hints earlier rather than risk a wrap.
 */
const hintCols = (hint: KeyHint, compact: boolean): number => {
  const k = compact ? compactKey(hint) : hint.key;
  const l = compact ? compactLabel(hint) : hint.label;
  // Full:    "[" + key + "] " + label
  // Compact: key + " " + label
  return compact ? k.length + 1 + l.length : 1 + k.length + 2 + l.length;
};

export const KeyHintBar = ({
  hints = [],
  width,
  showDefaults = true,
  showAskHint = true,
}: KeyHintBarProps) => {
  const defaults = showDefaults
    ? showAskHint
      ? [COMMANDS_HINT, ASK_HINT]
      : [COMMANDS_HINT]
    : [];
  const allHints = [...hints, ...defaults];

  // Decide layout mode. Padding (2 cols) + a 2-col gap between hints
  // adds up quickly — switch to compact mode well above the absolute
  // floor so we have headroom.
  const compact = width < COMPACT_THRESHOLD;
  const dropOptional = width < MIN_THRESHOLD;

  // Drop optional hints first under the floor, preserving the order of
  // remaining hints. Cancel (registered as required by RunScreen) and
  // Commands (the default `/` hint) always stay so the user can always
  // bail or open the slash bar.
  const filtered = dropOptional
    ? allHints.filter((h) => !h.optional)
    : allHints;

  // Greedy fit: drop trailing hints until the visible row fits. With
  // padding+gap baked in, this prevents Ink from wrapping the bar and
  // smearing single-token labels across two rows.
  // Reserve: paddingX(1) on each side = 2 cols, plus one 2-col gap per
  // hint after the first.
  const overhead = 2;
  const gapPerHint = 2;
  const visible: KeyHint[] = [];
  let used = overhead;
  for (let i = 0; i < filtered.length; i++) {
    const cost =
      hintCols(filtered[i], compact) + (visible.length > 0 ? gapPerHint : 0);
    if (used + cost > width && visible.length > 0) break;
    visible.push(filtered[i]);
    used += cost;
  }

  return (
    <Box width={width} paddingX={1} gap={2} overflow="hidden">
      {visible.map((hint, index) => (
        <Box key={`${index}:${hint.key}:${hint.label}`} flexShrink={0}>
          {compact ? (
            <>
              <Text color={Colors.body} bold>
                {compactKey(hint)}
              </Text>
              <Text color={Colors.muted}> {compactLabel(hint)}</Text>
            </>
          ) : (
            <>
              <Text color={Colors.muted}>[</Text>
              <Text color={Colors.body} bold>
                {hint.key}
              </Text>
              <Text color={Colors.muted}>] {hint.label}</Text>
            </>
          )}
        </Box>
      ))}
    </Box>
  );
};
