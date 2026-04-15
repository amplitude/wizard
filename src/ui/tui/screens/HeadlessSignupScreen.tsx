/**
 * HeadlessSignupScreen — Collects email and full name for browserless signup.
 *
 * Shown only when --signup is passed AND the wizard-headless-signup flag is on.
 * The authTask in bin.ts reads the submitted values from the session.
 */

import { Box, Text } from 'ink';
import { useState } from 'react';
import { TextInput } from '@inkjs/ui';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { Colors, Icons } from '../styles.js';

interface HeadlessSignupScreenProps {
  store: WizardStore;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const HeadlessSignupScreen = ({ store }: HeadlessSignupScreenProps) => {
  useWizardStore(store);

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [fullNameError, setFullNameError] = useState('');

  const handleEmailSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setEmailError('Email is required');
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setEmailError('Please enter a valid email address');
      return;
    }
    setEmailError('');
    setEmail(trimmed);
    setEmailConfirmed(true);
  };

  const handleFullNameSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setFullNameError('Full name is required');
      return;
    }
    setFullNameError('');
    store.setHeadlessSignupData(email, trimmed);
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Text bold color={Colors.heading}>
          Create your Amplitude account
        </Text>
      </Box>

      {/* Email step */}
      {!emailConfirmed && (
        <Box flexDirection="column" gap={1}>
          <Text color={Colors.body}>Enter your email address</Text>
          <TextInput
            placeholder="you@example.com"
            onSubmit={handleEmailSubmit}
          />
          {emailError && <Text color={Colors.error}>{emailError}</Text>}
        </Box>
      )}

      {/* Full name step */}
      {emailConfirmed && (
        <Box flexDirection="column">
          <Text>
            <Text color={Colors.success}>{Icons.checkmark} </Text>
            <Text color={Colors.body}>Email: {email}</Text>
          </Text>
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color={Colors.body}>Enter your full name</Text>
            <TextInput
              placeholder="Jane Smith"
              onSubmit={handleFullNameSubmit}
            />
            {fullNameError && <Text color={Colors.error}>{fullNameError}</Text>}
          </Box>
        </Box>
      )}
    </Box>
  );
};
