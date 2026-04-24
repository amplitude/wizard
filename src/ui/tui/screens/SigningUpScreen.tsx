/**
 * SigningUpScreen — POST coordinator for the direct-signup flow.
 *
 * Fires `performSignupOrAuth` on mount with the values currently on the
 * session (email, fullName, region) and writes the outcome back to the
 * store:
 *
 * - `success` → setSignupAuth (flow proceeds with the new account)
 * - `needs_information` with a known, unmet field → setSignupRequiredFields
 *   (flow advances to SignupFullNameScreen; the subsequent remount fires
 *   the retry POST)
 * - `needs_information` with nothing actionable (all fields already sent,
 *   or an unknown field we can't collect) → setSignupAbandoned (flow
 *   falls through to AuthScreen → browser OAuth; AuthScreen surfaces the
 *   signup-specific copy when session.signup is true)
 * - `requires_redirect` / `error` → setSignupAbandoned
 *
 * Rendering: mirrors the layout of whichever input screen the user just
 * submitted (email or full-name). Combined with the transition-group
 * mapping in App.tsx (which suppresses the DissolveTransition animation
 * between SignupEmail ↔ SigningUp ↔ SignupFullName), the user sees a
 * continuous "same screen, now with a spinner" experience — even though
 * three distinct screen components are rendered.
 *
 * The in-flight POST is cancelled on unmount via AbortSignal so a user
 * who quits mid-request doesn't leak an HTTP connection.
 */

import { Box, Text } from 'ink';
import { useEffect } from 'react';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { Colors } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { performSignupOrAuth } from '../../../utils/signup-or-auth.js';
import { KNOWN_REQUIRED_FIELDS, fieldPresentOnSession } from '../flows.js';
import { useResolvedZone } from '../hooks/useResolvedZone.js';

interface SigningUpScreenProps {
  store: WizardStore;
}

export const SigningUpScreen = ({ store }: SigningUpScreenProps) => {
  useWizardStore(store);
  const zone = useResolvedZone(store.session);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      const s = store.session;
      const result = await performSignupOrAuth(
        {
          email: s.signupEmail,
          fullName: s.signupFullName,
          zone,
        },
        { signal: controller.signal },
      );
      if (cancelled) return;

      switch (result.kind) {
        case 'success':
          store.setSignupAuth(result);
          return;
        case 'needs_information': {
          const hasUnknownField = result.requiredFields.some(
            (f) => !KNOWN_REQUIRED_FIELDS.has(f),
          );
          if (hasUnknownField) {
            store.setSignupAbandoned(true);
            return;
          }
          const unmet = result.requiredFields.filter(
            (f) => !fieldPresentOnSession(s, f),
          );
          if (unmet.length === 0) {
            store.setSignupAbandoned(true);
            return;
          }
          store.setSignupRequiredFields(result.requiredFields);
          return;
        }
        case 'requires_redirect':
        case 'error':
          store.setSignupAbandoned(true);
          return;
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const session = store.session;

  // Pick the layout that matches whichever input screen the user most
  // recently submitted. If the name screen just ran (server asked for
  // full_name and the user filled it in), mirror that screen. Otherwise
  // we came from the email screen (or from flags with only email set).
  const cameFromNameScreen =
    session.signupRequiredFields.includes('full_name') &&
    session.signupFullName !== null;

  const heading = cameFromNameScreen
    ? 'Enter your full name:'
    : 'Enter the email for your new account:';
  const submittedValue = cameFromNameScreen
    ? session.signupFullName
    : session.signupEmail;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.heading}>
          {heading}
        </Text>
      </Box>
      <Box flexDirection="column" gap={1}>
        <Text color={Colors.muted}>{submittedValue}</Text>
        <Box gap={1}>
          <BrailleSpinner />
          <Text color={Colors.muted}>Signing up…</Text>
        </Box>
      </Box>
    </Box>
  );
};
