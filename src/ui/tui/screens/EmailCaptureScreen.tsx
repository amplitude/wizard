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
import { useScreenInput } from '../hooks/useScreenInput.js';
import { Colors, Icons } from '../styles.js';
import { useScreenHints } from '../hooks/useScreenHints.js';
import type { KeyHint } from '../components/KeyHintBar.js';
import {
  DEFAULT_AMPLITUDE_ZONE,
  EMAIL_REGEX,
} from '../../../lib/constants.js';
import { performDirectSignup } from '../../../utils/direct-signup.js';
import type { StoredUser } from '../../../utils/ampli-settings.js';
import { replaceStoredUser } from '../../../utils/ampli-settings.js';
import { fetchAmplitudeUser } from '../../../lib/api.js';
import { PickerMenu } from '../primitives/index.js';
import { analytics } from '../../../utils/analytics.js';
import { resolveZone } from '../../../lib/zone-resolution.js';

const EMAIL_HINTS: readonly KeyHint[] = Object.freeze([
  { key: 'Enter', label: 'Continue' },
  { key: 'Esc', label: 'Back' },
]);

const EXISTING_USER_OPTIONS = [
  { label: 'Log in with existing account', value: 'login' },
  { label: 'Use a different email', value: 'retry' },
  { label: 'Cancel', value: 'cancel' },
];

interface EmailCaptureScreenProps {
  store: WizardStore;
}

export const EmailCaptureScreen = ({ store }: EmailCaptureScreenProps) => {
  useWizardStore(store);
  useScreenHints(EMAIL_HINTS);

  const { session } = store;
  const [email, setEmail] = useState(session.signupEmail ?? '');
  const [step, setStep] = useState<'email' | 'name' | 'existing_user'>('email');
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  // TextInput from @inkjs/ui does not surface Esc — handle it here so the user
  // can return to the name step or exit to the welcome screen.
  useScreenInput(
    (_input, key) => {
      if (!key.escape || isChecking) return;
      if (step === 'name') {
        setStep('email');
        setError(null);
        setInputKey((k) => k + 1);
        return;
      }
      if (step === 'existing_user') {
        setEmail('');
        setError(null);
        setStep('email');
        return;
      }
      analytics.wizardCapture('signup email screen back', {});
      store.rewindIntro();
    },
    { isActive: !isChecking },
  );

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
    setInputKey((k) => k + 1); // Force input to clear
  };

  const handleNameSubmit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Full name is required');
      return;
    }

    setError(null);
    setIsChecking(true);

    const zone = resolveZone(session, DEFAULT_AMPLITUDE_ZONE, {
      readDisk: false,
    });
    try {
      const result = await performDirectSignup({
        email,
        fullName: trimmed,
        zone,
      });

      if (result.kind === 'error' && result.code === 'user_already_exists') {
        analytics.wizardCapture('existing user detected during signup', {
          zone,
          'error code': result.code,
        });
        setIsChecking(false);
        setStep('existing_user');
        return;
      }

      if (result.kind === 'success') {
        const tokens = {
          accessToken: result.tokens.accessToken,
          idToken: result.tokens.idToken,
          refreshToken: result.tokens.refreshToken,
          expiresAt: result.tokens.expiresAt,
        };

        let user: StoredUser;
        try {
          const userInfo = await fetchAmplitudeUser(tokens.idToken, zone);
          user = {
            id: userInfo.id,
            firstName: userInfo.firstName,
            lastName: userInfo.lastName,
            email: userInfo.email,
            zone,
            tosAccepted: true,
            tosAcceptedAt: new Date().toISOString(),
          };
        } catch {
          const parts = trimmed.split(/\s+/);
          user = {
            id: 'pending',
            firstName: parts[0] ?? '',
            lastName: parts.slice(1).join(' '),
            email,
            zone,
            tosAccepted: true,
            tosAcceptedAt: new Date().toISOString(),
          };
        }

        replaceStoredUser(user, tokens);
        store.markSignupTokensObtained();
      }

      setIsChecking(false);
      store.setSignupEmail(email);
      store.setSignupFullName(trimmed);
      store.markEmailCaptureComplete();
    } catch {
      setIsChecking(false);
      store.setSignupEmail(email);
      store.setSignupFullName(trimmed);
      store.markEmailCaptureComplete();
    }
  };

  const handleExistingUserChoice = (value: string | string[]) => {
    const choice = Array.isArray(value) ? value[0] : value;
    if (choice === 'login') {
      store.switchToLogin();
      store.markEmailCaptureComplete();
    } else if (choice === 'retry') {
      setEmail('');
      setError(null);
      setStep('email');
    } else {
      store.cancelWizard('User cancelled signup');
    }
  };

  if (step === 'existing_user') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={Colors.heading}>
            Account already exists
          </Text>
          <Text color={Colors.muted}>
            The email <Text bold>{email}</Text> is already registered.
          </Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          <Text>What would you like to do?</Text>
        </Box>

        <PickerMenu<string>
          options={EXISTING_USER_OPTIONS}
          onSelect={handleExistingUserChoice}
        />
      </Box>
    );
  }

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
        {isChecking ? (
          <Text color={Colors.muted}>
            {Icons.dot} Checking account status...
          </Text>
        ) : step === 'email' ? (
          <TextInput
            key={`email-${inputKey}`}
            defaultValue={email}
            placeholder="your.email@example.com"
            onSubmit={handleEmailSubmit}
          />
        ) : (
          <TextInput
            key={`name-${inputKey}`}
            defaultValue={session.signupFullName ?? ''}
            placeholder="First Last"
            onSubmit={(value) => {
              void handleNameSubmit(value);
            }}
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

      {!isChecking && (
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
      )}
    </Box>
  );
};
