/**
 * HeadlessSignupScreen — Collects email and full name for browserless signup.
 *
 * Shown only when --signup is passed AND the wizard-headless-signup flag is on.
 * The authTask in bin.ts reads the submitted values from the session.
 */

import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { TextInput } from '@inkjs/ui';
import { z } from 'zod';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { Colors, Icons } from '../styles.js';

interface HeadlessSignupScreenProps {
  store: WizardStore;
}

const EmailSchema = z.string().trim().toLowerCase().email();
const FullNameSchema = z.string().trim().min(1, 'Full name is required');

// This screen is only rendered when CLI --email/--full-name were NOT provided.
// When both CLI args are present, the flow's isComplete predicate skips this
// screen entirely and bin.ts reads from session.signupEmail/session.signupFullName directly.
export const HeadlessSignupScreen = ({ store }: HeadlessSignupScreenProps) => {
  useWizardStore(store);

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [fullNameError, setFullNameError] = useState('');

  const handleEmailSubmit = (value: string) => {
    const result = EmailSchema.safeParse(value);
    if (!result.success) {
      setEmailError(
        value.trim()
          ? 'Please enter a valid email address'
          : 'Email is required',
      );
      return;
    }
    setEmailError('');
    setEmail(result.data);
    setEmailConfirmed(true);
  };

  const handleFullNameSubmit = (value: string) => {
    const result = FullNameSchema.safeParse(value);
    if (!result.success) {
      setFullNameError(
        result.error.issues[0]?.message ?? 'Full name is required',
      );
      return;
    }
    setFullNameError('');
    store.setHeadlessSignupData(email, result.data);
  };

  // Allow the user to back up to the email step after confirming it (e.g.
  // on a typo) without killing the wizard. Escape or Backspace on the
  // full-name step resets emailConfirmed.
  useInput(
    (_input, key) => {
      if (emailConfirmed && (key.escape || key.backspace)) {
        setEmailConfirmed(false);
        setFullNameError('');
      }
    },
    { isActive: emailConfirmed },
  );

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
