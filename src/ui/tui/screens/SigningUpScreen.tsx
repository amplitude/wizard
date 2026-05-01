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
import { useResolvedZone } from '../hooks/useResolvedZone.js';
import { Colors } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import {
  performSignupOrAuth,
  trackSignupAttempt,
} from '../../../utils/signup-or-auth.js';
import { KNOWN_REQUIRED_FIELDS } from '../flows.js';

interface SigningUpScreenProps {
  store: WizardStore;
}

export const SigningUpScreen = ({ store }: SigningUpScreenProps) => {
  useWizardStore(store);
  // Resolve the zone via the shared TUI hook rather than reading the
  // raw session field. Matches the pattern used by sibling screens
  // (CreateProjectScreen, DataIngestionCheckScreen, SlackScreen) and
  // ConsoleView. Behaviorally equivalent in the normal flow — the
  // SigningUp predicate already requires region to be set — but it
  // removes an unsafe non-null assertion and gives us a sane
  // DEFAULT_AMPLITUDE_ZONE fallback if the predicate is ever bypassed.
  const zone = useResolvedZone(store.session);

  // Empty deps array: the effect runs exactly once per mount. The
  // request-time fields (signupEmail, region, optionally signupFullName)
  // are guaranteed to be present by the SigningUp flow predicate in
  // flows.ts — see the entry that gates `signupEmail !== null` and
  // `region !== null` before this screen can mount. If a future flow
  // reorder lets SigningUp mount before those fields are written, the
  // POST will fire with stale/null inputs and the failure will be
  // silent. Add a flow-invariants property test to lock this in if more
  // call sites accumulate.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      // Snapshot the fields we send IN the request — these are stable
      // for the lifetime of this screen (predicates above ensure
      // SignupEmail / SignupFullName aren't mounted simultaneously, so
      // they can't write while we're posting).
      const s = store.session;
      let result: Awaited<ReturnType<typeof performSignupOrAuth>>;
      try {
        result = await performSignupOrAuth(
          {
            email: s.signupEmail,
            fullName: s.signupFullName,
            zone,
            installDir: s.installDir,
          },
          { signal: controller.signal },
        );
      } catch {
        // performSignupOrAuth intentionally propagates errors from
        // `replaceStoredUser` (disk / permission failures on
        // ~/.ampli.json). Without this catch, the screen never writes
        // a terminal session field, the bin.ts signupCeremonySettled
        // wait never satisfies, and the wizard hangs indefinitely on
        // "Signing up…".
        //
        // Match runDirectSignupIfRequested's behavior: emit the
        // wrapper_exception telemetry, abandon, let bin.ts proceed to
        // OAuth fallback. We don't have direct access to the original
        // err here for logging — the wrapper already logged its
        // direct-signup throw at signup_error level; this catch is
        // only reached for the rarer post-tokens persistence failure.
        if (cancelled) return;
        trackSignupAttempt({ status: 'wrapper_exception', zone });
        store.setSignupAbandoned(true);
        return;
      }
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
          // setSignupRequiredFields nulls the matching session values so
          // the flow re-resolves back to the corresponding collection
          // screen for a re-prompt. The SignupFullName predicate gates on
          // `signupFullName === null`; without that clear, the session
          // still carries the value we just sent, the predicate skips
          // SignupFullName, and the router lands back on SigningUp with
          // no way to gather a fresh value (-> infinite spinner).
          store.setSignupRequiredFields(result.requiredFields);
          return;
        }
        case 'requires_redirect':
        case 'error':
          store.setSignupAbandoned(true);
          return;
        default:
          // Exhaustiveness guard. If a new arm is added to
          // PerformSignupOrAuthResult, `result satisfies never` fails at
          // compile time; at runtime we still fail closed so bin.ts's
          // signupCeremonySettled wait resolves and the wizard doesn't
          // hang indefinitely on "Signing up…".
          result satisfies never;
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
