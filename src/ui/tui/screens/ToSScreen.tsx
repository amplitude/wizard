/**
 * ToSScreen — Terms of Service acceptance for --signup flow.
 *
 * Pattern inspired by Stripe CLI: presents terms and privacy policy
 * links, requires explicit acceptance before proceeding to authentication.
 */

import { Box, Text } from 'ink';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { useEscapeBack } from '../hooks/useEscapeBack.js';
import { PickerMenu } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import type { KeyHint } from '../components/KeyHintBar.js';
import {
  TERMS_OF_SERVICE_URL,
  PRIVACY_POLICY_URL,
} from '../../../lib/constants.js';

const TOS_HINTS: readonly KeyHint[] = Object.freeze([
  { key: '↑↓', label: 'Navigate' },
  { key: 'Enter', label: 'Select' },
]);

interface ToSScreenProps {
  store: WizardStore;
}

const OPTIONS = [
  {
    label: 'I accept the Terms of Service and Privacy Policy',
    value: 'accept',
  },
  {
    label: 'I do not accept',
    value: 'decline',
  },
];

export const ToSScreen = ({ store }: ToSScreenProps) => {
  useWizardStore(store);
  useEscapeBack(store, { extraHints: TOS_HINTS });

  const handleSelect = (value: string | string[]) => {
    const choice = Array.isArray(value) ? value[0] : value;
    if (choice === 'accept') {
      store.acceptTermsOfService();
    } else {
      store.cancelWizard('Terms of Service not accepted');
    }
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.heading}>
          Terms of Service
        </Text>
        <Text color={Colors.muted}>
          By continuing, you agree to Amplitude&apos;s terms
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text>
          Please review and accept our{' '}
          <Text color={Colors.accent}>Terms of Service</Text> and{' '}
          <Text color={Colors.accent}>Privacy Policy</Text> to continue:
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={Colors.muted}>
            {Icons.arrowRight} Terms: {TERMS_OF_SERVICE_URL}
          </Text>
          <Text color={Colors.muted}>
            {Icons.arrowRight} Privacy: {PRIVACY_POLICY_URL}
          </Text>
        </Box>
      </Box>

      <PickerMenu<string> options={OPTIONS} onSelect={handleSelect} />

      <Box marginTop={1}>
        <Text color={Colors.muted}>
          {Icons.dot} This is required to create an Amplitude account
        </Text>
      </Box>
    </Box>
  );
};
