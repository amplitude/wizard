import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';

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

/** Amplitude blue gradient — bright core fading to dim. */
const WAVE_COLORS = [
  '#6b9af7', // light blue
  '#4478f2', // mid blue
  '#1e61f0', // Amplitude blue (brand)
  '#1a55d4', // deeper blue
  '#1549b8', // deep blue
  '#1a55d4', // deeper blue
  '#1e61f0', // Amplitude blue
  '#4478f2', // mid blue
  '#6b9af7', // light blue
];

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

export const AmplitudeLogo = ({ color = 'white' }: { color?: string }) => (
  <Box marginBottom={1}>
    <Text color={color}>{TEXT}</Text>
  </Box>
);

/** AmplitudeLogo with a colour wave (vertical) and a horizontal dissolve wave. */
export const AnimatedAmplitudeLogo = () => {
  // Vertical colour wave — advances every 110 ms
  const [colorFrame, setColorFrame] = useState(0);
  // Horizontal dissolve wave — tick advances every 50 ms
  const [waveTick, setWaveTick] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setColorFrame((f) => (f + 1) % WAVE_COLORS.length),
      110,
    );
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setWaveTick((t) => t + 1), 50);
    return () => clearInterval(id);
  }, []);

  // One dissolve wave every 4 s (80 ticks). The wave travels for the first
  // 36 ticks (~1.8 s), sweeping from left edge to right edge; the remaining
  // 44 ticks the logo rests at full resolution.
  const TICKS_PER_CYCLE = 80;
  const ACTIVE_TICKS = 54; // extra ticks to cover diagonal travel + right overshoot
  const frameInCycle = waveTick % TICKS_PER_CYCLE;
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
