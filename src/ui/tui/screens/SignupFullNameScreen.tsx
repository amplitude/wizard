import { Box, Text } from 'ink';
import { useState } from 'react';
import { TextInput } from '@inkjs/ui';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { Colors, Icons } from '../styles.js';

interface Props {
  store: WizardStore;
}

export const SignupFullNameScreen = ({ store }: Props) => {
  useWizardStore(store);

  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setError('Full name cannot be empty');
      return;
    }
    setError(null);
    store.setSignupFullName(trimmed);
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.heading}>
          What name should we use for your new Amplitude account?
        </Text>
        <Text color={Colors.muted}>
          You can change this later in your account settings.
        </Text>
      </Box>

      <Box flexDirection="column" gap={1}>
        <TextInput placeholder="Jane Doe" onSubmit={handleSubmit} />
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
