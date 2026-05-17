/**
 * ScreenHeader — title + subtitle pair shared across the simpler screens.
 *
 * Five screens (SignupEmail, SignupFullName, SigningUp, RegionSelect, ToS)
 * render the same `<Box flexDirection="column" marginBottom={1}>` shell with
 * a bold `Colors.heading` title and a muted subtitle directly under it.
 * Inlining the markup at each callsite drifted slightly (literal vs.
 * interpolated subtitle, `<Text> </Text>` wrappers) and made changes like
 * "swap heading colour" land in five places.
 *
 * Lives in `screens/` rather than `primitives/` or `components/`: those
 * directories were swept in earlier rounds (#809, #832) and are off-limits
 * for this audit. The pattern is also screen-specific — a header style
 * tuned for the title-screen archetype, not a generic primitive.
 *
 * Output is byte-for-byte identical to the inlined JSX it replaces; the
 * snapshot tests for the affected screens continue to pass unchanged.
 */

import { Box, Text, type DOMElement } from 'ink';
import { type ReactNode, forwardRef } from 'react';
import { Colors } from '../styles.js';

interface ScreenHeaderProps {
  /** Bold, `Colors.heading` line — accepts a string or interpolated nodes. */
  title: ReactNode;
  /** Muted secondary line directly below the title. Optional. */
  subtitle?: ReactNode;
}

/**
 * `forwardRef` lets callers (e.g. flow-coordination screens that measure
 * chrome height for a layout calc) keep their existing `useRef<DOMElement>`
 * handles. None of the current callsites use it, but it costs nothing to
 * preserve the shape.
 */
export const ScreenHeader = forwardRef<DOMElement, ScreenHeaderProps>(
  ({ title, subtitle }, ref) => {
    return (
      <Box ref={ref} flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.heading}>
          {title}
        </Text>
        {subtitle !== undefined && subtitle !== null && (
          <Text color={Colors.muted}>{subtitle}</Text>
        )}
      </Box>
    );
  },
);

ScreenHeader.displayName = 'ScreenHeader';
