/**
 * SignupFullNameScreen — Collects full name when the agentic provisioning
 * endpoint has responded `needs_information` with `full_name` in the
 * `required` list AND the session doesn't already have a name (e.g. from
 * `--full-name`).
 *
 * Always renders AFTER the first SigningUpScreen probe, never before —
 * the entire point of the server-driven flow is to avoid asking for
 * fields the user doesn't need to provide (existing-user redirect would
 * skip this screen entirely).
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
import { analytics } from '../../../utils/analytics.js';

interface SignupFullNameScreenProps {
  store: WizardStore;
}

export const SignupFullNameScreen = ({ store }: SignupFullNameScreenProps) => {
  useWizardStore(store);

  const { session } = store;
  const [draft, setDraft] = useState(session.signupFullName ?? '');
  const [error, setError] = useState<string | null>(null);

  const hints = useMemo<readonly KeyHint[]>(
    () => [
      { key: 'Enter', label: 'Continue' },
      { key: 'Esc', label: 'Back' },
    ],
    [],
  );
  useScreenHints(hints);

  // Esc rewinds to the email screen so the user can correct a typo.
  // `setSignupEmail(null)` also resets the ceremony state internally,
  // so the SigningUpScreen will fire a fresh probe rather than
  // re-rendering this screen with stale required-fields state.
  useScreenInput((_input, key) => {
    if (!key.escape) return;
    analytics.wizardCapture('signup full name screen back', {});
    store.setSignupEmail(null);
  });

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Full name is required');
      return;
    }
    setError(null);
    setDraft(trimmed);
    store.setSignupFullName(trimmed);
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.heading}>
          One more thing
        </Text>
        <Text color={Colors.muted}>What&apos;s your full name?</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <TextInput
          defaultValue={draft}
          placeholder="First Last"
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
    </Box>
  );
};
