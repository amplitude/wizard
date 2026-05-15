/**
 * ScreenHotkeyBar — width-aware hotkey rail at the foot of a screen.
 *
 * Replaces and absorbs the older `HotkeyPills` component (re-exported
 * below so existing import sites keep compiling for one release). The
 * rail advertises the small set of keys a user can press right now —
 * e.g. `[k] paste api key  [/]  commands  [Tab]  ask`.
 *
 * Layout policy:
 *   • Default (≥ 80 cols): render all pills inline, separated by two
 *     spaces.
 *   • < 80 cols: wrap pills (Ink `flexWrap="wrap"`).
 *   • < 60 cols: truncate from the tail with an ellipsis pill, never
 *     dropping the first two pills (they're the most discoverable
 *     hotkeys — usually [k] and [/]).
 *
 * Design notes:
 *   • Each pill renders as `[K] label` with bold-accent brackets so the
 *     key is visually distinct without relying on color alone (a11y).
 *   • Renders nothing when given an empty array — callers don't need to
 *     guard the call site for the "no hotkeys" case.
 */

import { Box, Text } from 'ink';
import { Colors, Icons } from '../styles.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';

export interface HotkeyPill {
  /** The keyboard key shown inside the brackets (e.g. "L", "Esc", "/"). */
  key: string;
  /** Short verb describing what pressing the key does. */
  label: string;
}

export interface ScreenHotkeyBarProps {
  pills: HotkeyPill[];
  /**
   * Optional width override. When provided, the bar uses this value
   * instead of consulting `useStdoutDimensions()`. Tests pass an
   * explicit width to exercise narrow / wide branches deterministically
   * without needing to mock the hook.
   */
  width?: number;
}

/**
 * Rough character cost of rendering a single pill, including the
 * leading two-space gap before the next pill. Used to estimate which
 * pills fit at narrow widths.
 */
const pillCost = (pill: HotkeyPill): number =>
  // `[` + key + `]` + ` ` + label + two-space gap
  3 + pill.key.length + 1 + pill.label.length + 2;

/**
 * Pick which pills to render at narrow widths. Returns the original
 * array when there's room, or a truncated subset followed by an
 * ellipsis pill when there isn't. Never drops the first two pills —
 * they're the discoverability anchors (`[k] paste api key  [/] commands`).
 */
const truncateForWidth = (
  pills: HotkeyPill[],
  cols: number,
): { pills: HotkeyPill[]; truncated: boolean } => {
  if (pills.length <= 2) return { pills, truncated: false };
  let running = 0;
  const kept: HotkeyPill[] = [];
  for (const pill of pills) {
    running += pillCost(pill);
    if (running > cols && kept.length >= 2) {
      return { pills: kept, truncated: true };
    }
    kept.push(pill);
  }
  return { pills: kept, truncated: false };
};

export const ScreenHotkeyBar = ({ pills, width }: ScreenHotkeyBarProps) => {
  const [autoCols] = useStdoutDimensions();
  const cols = width ?? autoCols;

  if (pills.length === 0) return null;

  // < 60 cols: truncate from the tail to avoid wrap-storm on tiny
  // terminals. Keep the first two pills no matter what so the primary
  // affordance survives.
  const isVeryNarrow = cols < 60;
  // < 80 cols (but not very narrow): allow wrap.
  const isNarrow = cols < 80;

  const { pills: renderedPills, truncated } = isVeryNarrow
    ? truncateForWidth(pills, cols)
    : { pills, truncated: false };

  return (
    <Box flexDirection="row" gap={2} flexWrap={isNarrow ? 'wrap' : 'nowrap'}>
      {renderedPills.map((pill, index) => (
        <Box key={`${index}:${pill.key}`}>
          {/* `[K]` rendered with accent brackets + bold key glyph so the
              eye picks up the hotkey before the label. The bracket
              characters are themselves the affordance — color is a
              redundancy, not the signal — so this stays legible on
              monochrome terminals or with a11y high-contrast themes. */}
          <Text color={Colors.accent}>[</Text>
          <Text color={Colors.accent} bold>
            {pill.key}
          </Text>
          <Text color={Colors.accent}>]</Text>
          <Text color={Colors.body}> {pill.label}</Text>
        </Box>
      ))}
      {truncated && (
        <Box>
          <Text color={Colors.muted}>{Icons.ellipsis}</Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * @deprecated Use `ScreenHotkeyBar` — removed next release.
 *
 * Backwards-compatible shim. `HotkeyPills` was the original name for
 * this component; it now delegates to `ScreenHotkeyBar` so existing
 * import sites keep compiling while we migrate callsites.
 */
export const HotkeyPills = (props: { pills: HotkeyPill[] }) => (
  <ScreenHotkeyBar pills={props.pills} />
);
