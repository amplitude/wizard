import { Box, Text } from 'ink';

const LOGO_LINES = [
  ' █████╗ ███╗   ███╗██████╗ ██╗     ██╗████████╗██╗   ██╗██████╗ ███████╗',
  '██╔══██╗████╗ ████║██╔══██╗██║     ██║╚══██╔══╝██║   ██║██╔══██╗██╔════╝',
  '███████║██╔████╔██║██████╔╝██║     ██║   ██║   ██║   ██║██║  ██║█████╗  ',
  '██╔══██║██║╚██╔╝██║██╔═══╝ ██║     ██║   ██║   ██║   ██║██║  ██║██╔══╝  ',
  '██║  ██║██║ ╚═╝ ██║██║     ███████╗██║   ██║   ╚██████╔╝██████╔╝███████╗',
  '╚═╝  ╚═╝╚═╝     ╚═╝╚═╝     ╚══════╝╚═╝   ╚═╝    ╚═════╝ ╚═════╝ ╚══════╝',
];

const AMP_BLUE = '#1E61F0';
const AMP_CYAN = '#00D4AA';

function lerpColor(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16),
    ag = parseInt(a.slice(3, 5), 16),
    ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16),
    bg = parseInt(b.slice(3, 5), 16),
    bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t)
    .toString(16)
    .padStart(2, '0');
  const g = Math.round(ag + (bg - ag) * t)
    .toString(16)
    .padStart(2, '0');
  const bv = Math.round(ab + (bb - ab) * t)
    .toString(16)
    .padStart(2, '0');
  return `#${r}${g}${bv}`;
}

export const AmplitudeTextLogo = () => (
  <Box flexDirection="column" alignItems="center" marginBottom={1}>
    {LOGO_LINES.map((line, i) => {
      const chars = line.split('');
      const last = chars.length - 1;
      return (
        <Box key={i} flexDirection="row">
          {chars.map((char, j) => (
            <Text
              key={j}
              color={lerpColor(AMP_BLUE, AMP_CYAN, last > 0 ? j / last : 0)}
            >
              {char}
            </Text>
          ))}
        </Box>
      );
    })}
  </Box>
);
