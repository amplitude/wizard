/**
 * SignupFullNameScreen — Collect the user's full name when the signup
 * server responds with needs_information(['full_name']).
 *
 * Validates non-empty input after trim and writes the trimmed value to
 * `session.signupFullName` via `store.setSignupFullName`. The router
 * then re-posts the signup request with the collected field.
 */

import { Box, Text } from 'ink';
import { useState } from 'react';
import { TextInput } from '@inkjs/ui';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { Colors, Icons } from '../styles.js';

interface SignupFullNameScreenProps {
  store: WizardStore;
}

export const SignupFullNameScreen = ({ store }: SignupFullNameScreenProps) => {
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
          Enter your full name:
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
