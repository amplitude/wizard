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
      const result = await performSignupOrAuth({ email, fullName, zone });

      if (signal.aborted) return;

      if (result.kind === 'success') {
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
      }

      if (result.kind === 'needs_information') {
        store.setSignupRequiredFields(result.requiredFields);
        return;
      }

      // redirect / error → fall through to browser OAuth via signupAbandoned.
      // The auth gate releases on signupAbandoned and AuthScreen opens the
      // browser. We don't surface the error message inline here because
      // the user's likely outcome (browser OAuth) is the same in both cases.
      store.setSignupAbandoned(true);
    },
    [email, fullName],
  );

  // Render mimics the previous input screen so the screen swap feels
  // continuous: same heading, the submitted value as a static line, and
  // a spinner. The TRANSITION_GROUPS map in App.tsx collapses the
  // dissolve between SignupEmail/FullName/SigningUp so the user sees one
  // screen "updating in place" rather than three discrete swaps.
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
