/**
 * ScreenShell — canonical 3-region screen layout.
 *
 * Every Timeline-UX screen renders inside the same shell:
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │ ❯ welcome ✓ auth ● setup ○ verify ○ done            │  header
 *   │ Setup                                               │
 *   │ ─────────────────────────────────────────────────── │
 *   │                                                     │
 *   │  (screen body — children)                           │  body
 *   │                                                     │
 *   │ ─────────────────────────────────────────────────── │
 *   │ [Enter] continue   [Esc] back                       │  footer
 *   └─────────────────────────────────────────────────────┘
 *
 * The shell renders the step rail, title, and hotkey row consistently;
 * each screen only owns its body. PR 1 introduces the primitive but
 * does NOT migrate existing screens — that is staged in later PRs.
 *
 * Overdraw protection
 *
 *   `#779` documented Ink overdraw bugs when a body grew taller than
 *   the terminal. The body is rendered inside a Box with
 *   `overflow="hidden"` and explicit `flexShrink` so the header and
 *   footer stay pinned. Defensive only — actual prevention still lives
 *   at the screen level.
 */

import { Box, Text } from 'ink';
import { ReactNode } from 'react';
import { Colors, Layout } from '../styles.js';
import { StepIndicator } from './StepIndicator.js';
import { HotkeyPills, type HotkeyPill } from './HotkeyPills.js';
import { supportsUnicode } from '../lib/terminalCapabilities.js';

export interface ScreenShellStep {
  /** Display name of the active step. */
  name: string;
  /** Zero-based index into `all`. */
  currentIndex: number;
  /** Full ordered list of step names (rendered by StepIndicator). */
  all: string[];
}

export interface ScreenShellProps {
  step: ScreenShellStep;
  title: string;
  hotkeys: HotkeyPill[];
  children: ReactNode;
}

/**
 * Build the horizontal divider for the header / footer. UTF-8 terminals
 * get the thin `─` from `Layout.separatorChar`; ASCII falls back to `-`
 * so we never emit raw box-drawing bytes to a terminal that would render
 * them as tofu.
 *
 * The width is provided by the caller because the shell sits inside the
 * App's content area, which is itself sized to terminal dimensions — we
 * don't want to call `useStdoutDimensions` here and double-read the
 * stdout size.
 */
const Divider = ({ width }: { width: number }) => {
  const char = supportsUnicode() ? Layout.separatorChar : '-';
  // Cap the width so we don't draw a 1000-char line when the caller
  // accidentally passes a stale value.
  const safeWidth = Math.max(1, Math.min(width, 1000));
  return <Text color={Colors.border}>{char.repeat(safeWidth)}</Text>;
};

export const ScreenShell = ({
  step,
  title,
  hotkeys,
  children,
}: ScreenShellProps) => {
  // Use the shared layout token so the shell matches the rest of the
  // wizard's padding. Width-aware children should read stdout dims
  // themselves; we don't measure here.
  return (
    <Box flexDirection="column" paddingX={Layout.paddingX}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <Box flexDirection="column">
        <StepIndicator steps={step.all} currentIndex={step.currentIndex} />
        <Box marginTop={1}>
          <Text color={Colors.heading} bold>
            {title}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Divider width={Layout.minWidth} />
        </Box>
      </Box>

      {/* ── Body ────────────────────────────────────────────────── */}
      {/*
        `overflow="hidden"` is the defensive guard against the #779-class
        overdraw bug: when a screen's body legitimately grows past the
        terminal height, Ink's diff renderer can leave stale lines from
        the previous frame visible. Capping the box prevents the bleed
        into the footer divider. Real fix lives at each screen's content
        layer; the shell just stops the spill.
      */}
      <Box
        flexDirection="column"
        flexShrink={1}
        overflow="hidden"
        marginTop={1}
        marginBottom={1}
      >
        {children}
      </Box>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <Box flexDirection="column">
        <Divider width={Layout.minWidth} />
        <Box marginTop={1}>
          <HotkeyPills pills={hotkeys} />
        </Box>
      </Box>
    </Box>
  );
};
