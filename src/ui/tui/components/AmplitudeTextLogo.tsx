import { Box, Text } from 'ink';
import { lerpColor } from '../utils/color.js';

const LOGO_LINES = [
  ' █████╗ ███╗   ███╗██████╗ ██╗     ██╗████████╗██╗   ██╗██████╗ ███████╗',
  '██╔══██╗████╗ ████║██╔══██╗██║     ██║╚══██╔══╝██║   ██║██╔══██╗██╔════╝',
  '███████║██╔████╔██║██████╔╝██║     ██║   ██║   ██║   ██║██║  ██║█████╗  ',
  '██╔══██║██║╚██╔╝██║██╔═══╝ ██║     ██║   ██║   ██║   ██║██║  ██║██╔══╝  ',
  '██║  ██║██║ ╚═╝ ██║██║     ███████╗██║   ██║   ╚██████╔╝██████╔╝███████╗',
  '╚═╝  ╚═╝╚═╝     ╚═╝╚═╝     ╚══════╝╚═╝   ╚═╝    ╚═════╝ ╚═════╝ ╚══════╝',
];

/**
 * Number of color segments per line. Each segment is a single <Text> element
 * sharing one interpolated color. 10 segments x 6 lines = 60 elements total
 * (vs ~430 with per-character rendering).
 */
const SEGMENTS_PER_LINE = 10;

/**
 * Brand gradient endpoints per row.
 * Top rows: bright blue range. Bottom rows: deep purple to blue.
 * Each entry is [leftColor, rightColor].
 */
const ROW_GRADIENT: [string, string][] = [
  ['#0c19df', '#5533ff'], // row 0 — brightest
  ['#1420d4', '#4a2df5'], // row 1
  ['#1c22c8', '#3f27eb'], // row 2
  ['#2420b8', '#3421e0'], // row 3
  ['#2c1ea8', '#291bd6'], // row 4
  ['#311b8e', '#0c19df'], // row 5 — deepest
];

/**
 * Pre-computed gradient lines. Built once at module load so React never
 * recalculates colors during renders.
 */
const GRADIENT_LINES: { chars: string; color: string }[][] = LOGO_LINES.map(
  (line, rowIndex) => {
    const [leftColor, rightColor] = ROW_GRADIENT[rowIndex];
    const charsPerSegment = Math.ceil(line.length / SEGMENTS_PER_LINE);
    const segments: { chars: string; color: string }[] = [];

    for (let s = 0; s < SEGMENTS_PER_LINE; s++) {
      const start = s * charsPerSegment;
      const end = Math.min(start + charsPerSegment, line.length);
      const chars = line.slice(start, end);
      if (!chars) continue;

      // Horizontal position for color interpolation
      const t = line.length > 1 ? start / (line.length - 1) : 0;
      const color = lerpColor(leftColor, rightColor, t);
      segments.push({ chars, color });
    }

    return segments;
  },
);

export const AmplitudeTextLogo = () => (
  <Box flexDirection="column" marginBottom={1}>
    {GRADIENT_LINES.map((segments, rowIndex) => (
      <Box key={rowIndex} flexDirection="row">
        {segments.map((seg, s) => (
          <Text key={s} color={seg.color}>
            {seg.chars}
          </Text>
        ))}
      </Box>
    ))}
  </Box>
);
