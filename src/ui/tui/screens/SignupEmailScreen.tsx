/**
 * SignupEmailScreen — Collect the email for a new direct-signup account.
 *
 * Shown when `--signup` is passed without `--email`. Validates input
 * against the shared EMAIL_REGEX and writes the trimmed value to
 * `session.signupEmail` via `store.setSignupEmail`. The router then
 * advances to `SigningUpScreen` which POSTs the signup request.
 */

import { Box, Text } from 'ink';
import { useState } from 'react';
import { TextInput } from '@inkjs/ui';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { Colors, Icons } from '../styles.js';
import { EMAIL_REGEX } from '../../../lib/constants.js';

interface SignupEmailScreenProps {
  store: WizardStore;
}

export const SignupEmailScreen = ({ store }: SignupEmailScreenProps) => {
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
          Enter the email for your new account:
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
