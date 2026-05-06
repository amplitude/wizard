/**
 * SigningUpScreen — Performs the agentic signup POST and routes the
 * session to the next screen based on the server's response.
 *
 * Single coordinator for the direct-signup ceremony's network I/O. Other
 * signup screens stay passive (they only read/write session fields); this
 * screen is the only one that talks to the provisioning endpoint.
 *
 * Response → session writes → router resolution:
 *
 *   server response          → store action                → next screen
 *   ─────────────────────────────────────────────────────────────────────
 *   oauth (success)          → setSignupAuth(...)          → Auth (uses
 *                                                            stored tokens)
 *   needs_information        → setSignupRequiredFields([]) → SignupFullName
 *                                                            (or ToS, etc.)
 *   requires_auth (redirect) → setSignupAbandoned(true)    → Auth (browser
 *                                                            OAuth)
 *   error                    → setSignupAbandoned(true)    → Auth (browser
 *                                                            OAuth)
 *
 * The wrapper (`performSignupOrAuth`) handles success-path persistence
 * (replaceStoredUser + provisioning-retry user fetch) so this screen just
 * captures the result and writes it to the session for the auth gate to
 * consume.
 */

import { Box, Text } from 'ink';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { useAsyncEffect } from '../hooks/useAsyncEffect.js';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { performSignupOrAuth } from '../../../utils/signup-or-auth.js';
import { resolveZone } from '../../../lib/zone-resolution.js';
import { DEFAULT_AMPLITUDE_ZONE } from '../../../lib/constants.js';
import { createLogger } from '../../../lib/observability/logger.js';
import { assertNever } from '../../../utils/assert-never.js';

const log = createLogger('signing-up-screen');

interface SigningUpScreenProps {
  store: WizardStore;
}

export const SigningUpScreen = ({ store }: SigningUpScreenProps) => {
  useWizardStore(store);

  const { session } = store;
  const email = session.signupEmail;
  // Only include `fullName` in the POST when ToS is accepted too — the
  // server creates the account on the success arm, and shipping the user
  // through provisioning before they confirm ToS is the regression we're
  // explicitly fixing. Without ToS, send email-only and let the server
  // route us to needs_information so the ToS screen renders next.
  const fullName =
    session.tosAccepted === true ? (session.signupFullName ?? null) : null;

  useAsyncEffect(
    async (signal) => {
      if (email === null) return; // SignupEmailScreen still pending
      log.debug('posting signup', { hasFullName: fullName !== null });

      const zone = resolveZone(session, DEFAULT_AMPLITUDE_ZONE, {
        readDisk: false,
      });
      // Thread `signal` through so axios cancels the in-flight POSTs on
      // unmount AND the wrapper skips its `replaceStoredUser` write if
      // the user backed out before the success arm settled. Without
      // this, an abandoned ceremony can still leak tokens to disk and
      // make the next launch think the user is signed in.
      const result = await performSignupOrAuth({
        email,
        fullName,
        zone,
        signal,
      });

      if (signal.aborted) return;

      // Exhaustive switch on the result kind. The `default: assertNever`
      // forces a compile error if `PerformSignupOrAuthResult` grows a
      // new arm — every new kind has to be explicitly considered here
      // (even if the answer is "fall through to OAuth like redirect").
      // Without this, a future arm like `kind: 'rate_limited'` would
      // silently route to OAuth and lose its semantics; the compile
      // error makes the contributor pick a behavior on purpose.
      switch (result.kind) {
        case 'success':
          store.setSignupAuth({
            idToken: result.idToken,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            zone: result.zone,
            userInfo: result.userInfo,
            dashboardUrl: result.dashboardUrl,
          });
          // Mirror the dashboard magic link onto the screen-managed slot
          // for parity with the legacy classic flow's outro display.
          store.setSignupMagicLinkUrl(result.dashboardUrl);
          // Mark signup tokens obtained so the post-TUI auth task hydrates
          // from disk instead of opening browser OAuth (matches the old
          // EmailCaptureScreen contract).
          store.markSignupTokensObtained();
          return;
        case 'needs_information': {
          // Defensive guard against a stuck-spinner deadlock: if the
          // server is asking for a field we already populated, the
          // ceremony can't make progress — `useAsyncEffect`'s deps
          // (`[email, fullName]`) won't change on the next
          // `setSignupRequiredFields` write, the screen won't re-mount,
          // and no further effect will fire. Without this guard the
          // user wedges on the spinner forever with no escape besides
          // Ctrl+C.
          //
          // Today this can only fire as a server bug (we just sent
          // `full_name` and the server is still asking for it), but
          // the cost of the guard is one branch and the failure mode
          // it prevents has zero in-band recovery.
          const alreadySatisfied = result.requiredFields.every((field) =>
            field === 'full_name' ? fullName !== null : false,
          );
          if (alreadySatisfied) {
            log.warn(
              'signup: server re-requested already-provided fields; abandoning',
              { requiredFields: result.requiredFields },
            );
            store.setSignupAbandoned(true);
            return;
          }
          store.setSignupRequiredFields(result.requiredFields);
          return;
        }
        case 'redirect':
        case 'error':
          // Fall through to browser OAuth via signupAbandoned. The auth
          // gate releases on signupAbandoned and AuthScreen opens the
          // browser. We don't surface the error message inline here
          // because the user's likely outcome (browser OAuth) is the
          // same in both cases.
          store.setSignupAbandoned(true);
          return;
        default:
          assertNever(result);
      }
    },
    [email, fullName],
  );

  // Render mimics the previous input screen so the screen swap feels
  // continuous: same heading, the submitted value as a static line, and
  // a spinner.
  const headerLabel =
    session.signupRequiredFields !== null && fullName !== null
      ? 'Creating your account…'
      : 'Checking your account…';

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.heading}>
          Create your Amplitude account
        </Text>
        <Text color={Colors.muted}>{headerLabel}</Text>
      </Box>

      {email && (
        <Box flexDirection="column" marginBottom={1}>
          <Text>{email}</Text>
          {fullName && <Text>{fullName}</Text>}
        </Box>
      )}

      <Box>
        <BrailleSpinner />
        <Text color={Colors.muted}> {Icons.dot} contacting Amplitude…</Text>
      </Box>
    </Box>
  );
};
