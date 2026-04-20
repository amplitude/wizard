import { Box, Text } from 'ink';

const LINES = [
  '     _.ΦΦ8$8ΦΦ..    ',
  '   .ΦΘΦƒⁿ"ΦΦΦΘ#ΦΦ.  ',
  ' /#8ΦΦ/ x  #Φ8ΦæΦΦ\\ ',
  '+ΦΦΦ+/ @A@ +ΦΦ8ΦΦ#Φ:',
  '+Φ(    ___       )Φ|',
  '\\ΦΦΦΓ áΦΦΦì  ΦΦ/Φ#Θ;',
  ' ΦæΦææ#ΦΘΦΦ+ +/ +ΦΦ ',
  '  `Φ8ΦΦ8ΦΦ#Φ\\_.ΦΦΦ  ',
  "    `-ΦΦΦµµΦΦΦ'''    ",
];

const TEXT = LINES.join('\n');

// ── Colour gradient helpers ────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  );
}

/**
 * Interpolate between anchor colors with per-segment step counts.
 * More steps = more time spent in that segment (natural easing via density).
 * Excludes the right endpoint of each segment to avoid duplicates.
 * Evaluated once at module load — zero per-render cost.
 */
function buildGradient(anchors: string[], steps: number[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = hexToRgb(anchors[i]);
    const b = hexToRgb(anchors[(i + 1) % anchors.length]);
    const n = steps[i];
    for (let s = 0; s < n; s++) {
      const t = s / n;
      result.push(
        rgbToHex(
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          a[2] + (b[2] - a[2]) * t,
        ),
      );
    }
  }
  return result;
}

/**
 * Non-uniform stop density creates implicit easing: fewer stops in the dark
 * segments (speeds through them), more stops near the bright peak (lingers).
 * Total: 4+10+16+16+10+4+4 = 64 stops. At 200ms/step, full rotation ≈ 12.8s.
 */
const WAVE_COLORS = buildGradient(
  [
    '#311b8e', // deep purple  ↘ dark, race through
    '#1522c4', // blue          ↗ brightening
    '#6980FF', // lilac         ↗ near peak
    '#4083FF', // blueOnDark   ← peak, linger
    '#6980FF', // lilac         ↘ from peak
    '#1522c4', // blue          ↘ darkening
    '#2a1da0', // mid purple    ↘ dark, race through
    '#311b8e', // deep purple  (wraps to start)
  ],
  [4, 10, 10, 16, 10, 4, 4],
);

/**
 * Characters substituted at each distance from the wave centre.
 * dist 0 → invisible, dist 1-3 → progressively larger dots, dist 4+ → original.
 */
const DECAY = [' ', '˙', '·', '∘'] as const;

const LOGO_WIDTH = LINES[0].length;
/** Radius of the dissolve zone in columns. */
const WAVE_RADIUS = 7;
/** Column shift per row — controls the diagonal angle. */
const ROW_SHIFT = 2;

/**
 * Replace each non-space character with its wave-decay substitute.
 * rowWaveX is the wave centre for this specific row (already shifted for angle).
 */
function applyHorizWave(line: string, rowWaveX: number): string {
  if (rowWaveX < -WAVE_RADIUS || rowWaveX > LOGO_WIDTH + WAVE_RADIUS)
    return line;
  return [...line]
    .map((char, col) => {
      if (char === ' ') return ' ';
      const dist = Math.abs(col - rowWaveX);
      return dist < DECAY.length ? DECAY[dist] : char;
    })
    .join('');
}

export const AmplitudeLogo = ({ color = '#0c19df' }: { color?: string }) => (
  <Box marginBottom={1}>
    <Text color={color}>{TEXT}</Text>
  </Box>
);

/**
 * AmplitudeLogo with a colour wave (vertical) and a horizontal dissolve wave.
 *
 * Driven entirely by the `tick` prop — no internal intervals. Callers should
 * advance `tick` on every spinner interval (200ms) so this component re-renders
 * in the same batch as the spinner, adding zero extra render cycles.
 *
 * Timing at 200ms/tick:
 *   - Colour: 1 step per tick (200ms), non-uniform density creates implicit easing
 *   - Dissolve sweep: 14 active ticks × 200ms ≈ 2.8s sweep, 6 tick rest ≈ 1.2s
 */
export const AnimatedAmplitudeLogo = ({ tick }: { tick: number }) => {
  // 3 steps per tick → 100ms per step. Full 64-stop rotation ≈ 12.8s.
  const colorFrame = (tick % WAVE_COLORS.length) * 3;

  // Dissolve sweep: 14 active ticks × 200ms = 2.8s (≈ original 2.7s sweep).
  // Rest: 6 ticks × 200ms = 1.2s. Total cycle: 20 ticks = 4s.
  const TICKS_PER_CYCLE = 20;
  const ACTIVE_TICKS = 14;
  const frameInCycle = tick % TICKS_PER_CYCLE;
  const waveX =
    frameInCycle < ACTIVE_TICKS
      ? Math.round(
          (frameInCycle / (ACTIVE_TICKS - 1)) *
            (LOGO_WIDTH + WAVE_RADIUS * 2 + 10) -
            WAVE_RADIUS,
        )
      : -999; // off-screen → no substitution

  return (
    <Box flexDirection="column" marginBottom={1}>
      {LINES.map((line, i) => (
        <Text
          key={i}
          color={WAVE_COLORS[(colorFrame + i) % WAVE_COLORS.length]}
        >
          {applyHorizWave(line, waveX - i * ROW_SHIFT)}
        </Text>
      ))}
    </Box>
  );
};
