/**
 * SignupEmailScreen — Collects the user's email address before the
 * direct-signup ceremony begins.
 *
 * First step in the create-account flow. Hands off to SigningUpScreen
 * which probes the agentic provisioning endpoint with email-only and
 * routes to ToS / SignupFullName / Auth based on the response.
 *
 * Replaces the legacy two-step EmailCaptureScreen, which collected email
 * AND name AND posted in one screen — that flow asked for name and ToS
 * even when the server would have redirected (existing user) or errored.
 * The new flow defers name and ToS until the server confirms agentic
 * signup is happening.
 */

import { Box, Text } from 'ink';
import { useMemo, useState } from 'react';
import { TextInput } from '@inkjs/ui';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useScreenHints } from '../hooks/useScreenHints.js';
import { Colors, Icons } from '../styles.js';
import type { KeyHint } from '../components/KeyHintBar.js';
import { EMAIL_REGEX } from '../../../lib/constants.js';
import { AuthOnboardingPath } from '../../../lib/wizard-session.js';
import { analytics } from '../../../utils/analytics.js';

interface SignupEmailScreenProps {
  store: WizardStore;
}

export const SignupEmailScreen = ({ store }: SignupEmailScreenProps) => {
  useWizardStore(store);

  const { session } = store;
  const [draft, setDraft] = useState(session.signupEmail ?? '');
  const [error, setError] = useState<string | null>(null);

  const routerCanGoBack = store.canGoBack();
  const hints = useMemo<readonly KeyHint[]>(
    () => [
      { key: 'Enter', label: 'Continue' },
      { key: 'Tab', label: 'Sign in' },
      { key: 'Esc', label: routerCanGoBack ? 'Back' : 'Welcome' },
    ],
    [routerCanGoBack],
  );
  useScreenHints(hints);

  // @inkjs/ui's TextInput handles its own keypress events — wire Esc
  // (back-nav) and Tab (sign-in escape) on the screen. Tab flips
  // authOnboardingPath; create-account-only flow entries short-circuit
  // and the router routes to AuthScreen for browser OAuth. Not
  // setSignupAbandoned — that flag's contract is "ceremony probed and
  // aborted", and on this screen no probe has fired yet.
  useScreenInput((_input, key) => {
    if (key.escape) {
      analytics.wizardCapture('signup email screen back');
      if (store.canGoBack()) {
        store.goBack();
        return;
      }
      store.backToWelcome();
      return;
    }
    if (key.tab) {
      analytics.wizardCapture('signup email sign in chosen');
      store.setAuthOnboardingPath(AuthOnboardingPath.SignIn);
      return;
    }
  });

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Email is required');
      return;
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      setError('Please enter a valid email address');
      return;
    }
    setError(null);
    setDraft(trimmed);
    // Writing signupEmail makes this screen's `show` predicate go false
    // and the router advances to SigningUpScreen on the next render.
    store.setSignupEmail(trimmed);
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.heading}>
          Create your Amplitude account
        </Text>
        <Text color={Colors.muted}>Enter your email to get started</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <TextInput
          defaultValue={draft}
          placeholder="your.email@example.com"
          onSubmit={handleSubmit}
        />
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
        <Text color={Colors.muted}>
          {Icons.dot} Already have an account? Press [Tab] to sign in via
          browser
        </Text>
      </Box>
    </Box>
  );
};
