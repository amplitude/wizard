/**
 * SigningUpScreen — POST coordinator for the direct-signup flow.
 *
 * Fires `performSignupOrAuth` on mount with the values currently on the
 * session (email, fullName, region) and writes the outcome back to the
 * store:
 *
 * - `success` → setSignupAuth (flow proceeds with the new account)
 * - `needs_information` with a known, unmet field → setSignupRequiredFields
 *   (flow advances to the corresponding field-collection screen; a
 *   remount fires the retry POST)
 * - `needs_information` with nothing actionable (all fields already sent,
 *   or an unknown field we can't collect) → hold a short transition
 *   message then setSignupAbandoned (flow falls through to AuthScreen →
 *   browser OAuth)
 * - `requires_redirect` / `error` → same transition + abandon
 *
 * The in-flight POST is cancelled on unmount via AbortSignal so a user
 * who quits mid-request doesn't leak an HTTP connection.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { Colors } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { performSignupOrAuth } from '../../../utils/signup-or-auth.js';
import { KNOWN_REQUIRED_FIELDS, fieldPresentOnSession } from '../flows.js';

interface SigningUpScreenProps {
  store: WizardStore;
}

const TERMINAL_HOLD_MS = 1000;

type Phase = 'loading' | 'terminal';

export const SigningUpScreen = ({ store }: SigningUpScreenProps) => {
  useWizardStore(store);
  const [phase, setPhase] = useState<Phase>('loading');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const abandonAfterHold = () => {
      setPhase('terminal');
      timeoutRef.current = setTimeout(() => {
        if (cancelled) return;
        store.setSignupAbandoned(true);
      }, TERMINAL_HOLD_MS);
    };

    void (async () => {
      const s = store.session;
      const result = await performSignupOrAuth(
        {
          email: s.signupEmail,
          fullName: s.signupFullName,
          zone: s.region!,
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
            abandonAfterHold();
            return;
          }
          const unmet = result.requiredFields.filter(
            (f) => !fieldPresentOnSession(s, f),
          );
          if (unmet.length === 0) {
            abandonAfterHold();
            return;
          }
          store.setSignupRequiredFields(result.requiredFields);
          return;
        }
        case 'requires_redirect':
        case 'error':
          abandonAfterHold();
          return;
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (phase === 'loading') {
    return (
      <Box flexDirection="row" gap={1}>
        <BrailleSpinner />
        <Text color={Colors.muted}>Loading…</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color={Colors.muted}>
        Please sign up or log in in your browser. Opening momentarily.
      </Text>
    </Box>
  );
};
