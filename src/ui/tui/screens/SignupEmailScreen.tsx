import { Box, Text } from 'ink';
import { useState } from 'react';
import { TextInput } from '@inkjs/ui';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { Colors, Icons } from '../styles.js';
import { EMAIL_REGEX } from '../../../lib/constants.js';

interface Props {
  store: WizardStore;
}

export const SignupEmailScreen = ({ store }: Props) => {
  useWizardStore(store);

  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!EMAIL_REGEX.test(trimmed)) {
      setError('Please enter a valid email');
      return;
    }
    setError(null);
    store.setSignupEmail(trimmed);
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.heading}>
          What email should we use for your new Amplitude account?
        </Text>
        <Text color={Colors.muted}>
          We'll send a verification link here after setup.
        </Text>
      </Box>

      <Box flexDirection="column" gap={1}>
        <TextInput placeholder="you@company.com" onSubmit={handleSubmit} />
        {error && (
          <Text color={Colors.error}>
            {Icons.warning} {error}
          </Text>
        )}
        <Text color={Colors.muted}>{Icons.dot} Press Enter to continue.</Text>
      </Box>
    </Box>
  );
};
