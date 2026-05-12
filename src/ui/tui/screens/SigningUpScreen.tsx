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
import { resolveZone } from '../../../lib/zone-resolution.js';
import { DEFAULT_AMPLITUDE_ZONE } from '../../../lib/constants.js';
import { createLogger } from '../../../lib/observability/logger.js';
import { assertNever } from '../../../utils/assert-never.js';
import type { SignupOrAuthInput } from '../../../utils/signup-or-auth.js';
import type {
  LegalDocumentBundle,
  LegalDocumentSource,
} from '../../../utils/direct-signup.js';

const log = createLogger('signing-up-screen');

interface SigningUpScreenProps {
  store: WizardStore;
}

export const SigningUpScreen = ({ store }: SigningUpScreenProps) => {
  useWizardStore(store);

  const { session } = store;
  const email = session.signupEmail;
  // Derived for `useAsyncEffect`'s deps and the rendered header. The
  // input-construction switch below reads directly from session for
  // the discriminated-union narrowing.
  const fullName =
    session.tosAccepted === true ? (session.signupFullName ?? null) : null;

  useAsyncEffect(
    async (signal) => {
      if (email === null) return; // SignupEmailScreen still pending

      const zone = resolveZone(session, DEFAULT_AMPLITUDE_ZONE, {
        readDisk: false,
      });

      // `signupRequiredFields !== null` means the BE returned
      // `needs_information` at least once this ceremony, so this is a
      // follow-up call. The flow's `requiredSatisfied` predicate keeps
      // us out of SigningUp until each required-key has its session
      // value populated; the per-field null checks below narrow
      // `string | null` to `string` for the wrapper input.
      const requiredFields = session.signupRequiredFields;

      let input: SignupOrAuthInput;
      if (requiredFields !== null) {
        // Per-RequiredKey exhaustive switch: validates session readiness AND
        // collects the input slot for each requested key. `assertNever`
        // makes adding a new `RequiredKey` (e.g. `phone_number`) a compile
        // error here until the contributor maps it to a session field and
        // an input slot — otherwise the new key would silently be treated
        // as "not collected" and abandon every ceremony.
        // Renamed (vs outer-scope `fullName` at line 58) so the inner
        // collected value doesn't shadow the outer derived one — the outer
        // feeds `useAsyncEffect`'s deps and the rendered header.
        let inputFullName: string | undefined;
        let inputLegalDocumentBundle: LegalDocumentBundle | undefined;
        let inputLegalDocumentSource: LegalDocumentSource | undefined;
        for (const key of requiredFields) {
          switch (key) {
            case 'full_name':
              if (session.signupFullName === null) {
                log.error(
                  'signup: re-fired in follow-up mode without full_name; abandoning',
                );
                store.setSignupAbandoned(true);
                return;
              }
              inputFullName = session.signupFullName;
              break;
            case 'terms_acceptance':
              if (
                session.legalDocumentBundle === null ||
                session.legalDocumentSource === null
              ) {
                log.error(
                  'signup: re-fired in follow-up mode without terms_acceptance state; abandoning',
                );
                store.setSignupAbandoned(true);
                return;
              }
              inputLegalDocumentBundle = session.legalDocumentBundle;
              inputLegalDocumentSource = session.legalDocumentSource;
              break;
            default:
              assertNever(key);
          }
        }
        input = {
          kind: 'with_required_fields',
          email,
          fullName: inputFullName,
          legalDocumentBundle: inputLegalDocumentBundle,
          legalDocumentSource: inputLegalDocumentSource,
          zone,
          signal,
        };
      } else {
        input = { kind: 'email_only', email, zone, signal };
      }

      log.debug('posting signup', { kind: input.kind });
      // `store.runSignupAttempt` is the sole TUI surface for the
      // agentic-signup POST: it wraps `performSignupOrAuth` in a
      // try/finally that toggles `signupInFlight` for the duration
      // of the call (clears even on signal-driven aborts). The
      // signup-ceremony FlowEntries gate `isWall` on that flag so
      // Esc cannot reset ceremony state mid-POST; otherwise the
      // response could land on a session that's been wiped.
      //
      // Threading `signal` through aborts the in-flight POSTs on
      // unmount AND skips the wrapper's `replaceStoredUser` write if
      // the user backed out before the success arm settled —
      // otherwise an abandoned ceremony can still leak tokens to
      // disk and make the next launch think the user is signed in.
      const result = await store.runSignupAttempt(input);

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
          // `setSignupAuth` folds in `signupTokensObtained=true`
          // atomically — the TUI auth-task gate releases on
          // `signupAuth` and reads `signupTokensObtained`; both must
          // land together so the gate-listener doesn't see a half-set
          // state and open browser OAuth despite valid tokens.
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
          // Order doesn't matter here — `signupMagicLinkUrl` isn't
          // gate-relevant.
          store.setSignupMagicLinkUrl(result.dashboardUrl);
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
          // a complete body and the server is still asking for these
          // fields), but the cost of the guard is one switch and the
          // failure mode it prevents has zero in-band recovery.
          const alreadySatisfied = result.requiredFields.every((field) => {
            switch (field) {
              case 'full_name':
                return fullName !== null;
              case 'terms_acceptance':
                return session.tosAccepted === true;
              default:
                return assertNever(field);
            }
          });
          if (alreadySatisfied) {
            log.warn(
              'signup: server re-requested already-provided fields; abandoning',
              { requiredFields: result.requiredFields },
            );
            store.setSignupAbandoned(true);
            return;
          }
          store.setSignupRequiredFields(result.requiredFields);
          // Persist the legal-doc URLs the parser produced for this
          // probe response. The ToSScreen reads from session.legalDocumentBundle
          // (no fallback at the screen — parser already normalized via the
          // spoof block when BE flag is OFF) and the follow-up POST body
          // pulls from the same field. Source is recorded so subsequent
          // telemetry arms can tag attempts without re-threading it.
          store.setLegalDocumentBundle(result.legalDocumentBundle);
          store.setLegalDocumentSource(result.legalDocumentSource);
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
  //
  // "Creating…" runs on every follow-up POST regardless of which fields
  // the user collected — `signupRequiredFields !== null` is the load-
  // bearing condition (BE has acknowledged the email and asked for at
  // least one field; we're committing the account). Conditioning on
  // `fullName !== null` was correct when full_name was always required
  // but rendered "Checking…" on terms-only follow-ups, which became
  // user-visible after BA-149 enabled that combination.
  const headerLabel =
    session.signupRequiredFields !== null
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
