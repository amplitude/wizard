/**
 * EmailCaptureScreen — Collect user email during --signup flow.
 *
 * Required before Terms of Service acceptance. Pre-populates from
 * --signup-email flag if provided.
 */

import { Box, Text } from 'ink';
import { useState } from 'react';
import { TextInput } from '@inkjs/ui';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { Colors, Icons } from '../styles.js';
import { useScreenHints } from '../hooks/useScreenHints.js';
import type { KeyHint } from '../components/KeyHintBar.js';
import { EMAIL_REGEX } from '../../../lib/constants.js';

const EMAIL_HINTS: readonly KeyHint[] = Object.freeze([
  { key: 'Enter', label: 'Continue' },
  { key: 'Esc', label: 'Cancel' },
]);

interface EmailCaptureScreenProps {
  store: WizardStore;
}

export const EmailCaptureScreen = ({ store }: EmailCaptureScreenProps) => {
  useWizardStore(store);
  useScreenHints(EMAIL_HINTS);

  const { session } = store;
  const [email, setEmail] = useState(session.signupEmail ?? '');
  const [fullName, setFullName] = useState(session.signupFullName ?? '');
  const [step, setStep] = useState<'email' | 'name'>('email');
  const [error, setError] = useState<string | null>(null);

  const handleEmailSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Email is required');
      return;
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      setError('Please enter a valid email address');
      return;
    }
    setEmail(trimmed);
    setError(null);
    setStep('name');
  };

  const handleNameSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Full name is required');
      return;
    }
    setFullName(trimmed);

    // Update session with captured email and full name
    store.setSignupEmail(email);
    store.setSignupFullName(trimmed);
    store.markEmailCaptureComplete();
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.heading}>
          Create your Amplitude account
        </Text>
        <Text color={Colors.muted}>
          {step === 'email'
            ? 'Enter your email to get started'
            : 'Enter your full name'}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {step === 'email' ? (
          <TextInput
            defaultValue={email}
            placeholder="your.email@example.com"
            onSubmit={handleEmailSubmit}
          />
        ) : (
          <TextInput
            defaultValue={fullName}
            placeholder="First Last"
            onSubmit={handleNameSubmit}
          />
        )}
        {error && (
          <Box marginTop={1}>
            <Text color={Colors.error}>
              {Icons.cross} {error}
            </Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={Colors.muted}>
          {Icons.dot} We&apos;ll use this to create your Amplitude account
        </Text>
        {step === 'email' && (
          <Text color={Colors.muted}>
            {Icons.dot} You&apos;ll need to accept our Terms of Service after
          </Text>
        )}
      </Box>
    </Box>
  );
};
