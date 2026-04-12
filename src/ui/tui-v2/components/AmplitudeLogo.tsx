/**
 * Re-export animated logo from v1. Add a compact Wordmark for inline use.
 */

export {
  AmplitudeLogo,
  AnimatedAmplitudeLogo,
} from '../../tui/components/AmplitudeLogo.js';

export { AMP_BLUE, AMP_CYAN } from '../../tui/components/AmplitudeTextLogo.js';

import { Text } from 'ink';
import { Brand } from '../styles.js';

/** Compact single-line wordmark for headers and inline use. */
export const Wordmark = () => (
  <Text color={Brand.blueOnDark} bold>
    amplitude
  </Text>
);
