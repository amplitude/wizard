import { z } from 'zod';
import { AuthOnboardingPath, type WizardSession } from './wizard-session.js';

/** Subset of session fields that gate direct (non-TUI) account provisioning. */
export type AccountCreationProvisioningSessionSlice = Pick<
  WizardSession,
  'authOnboardingPath' | 'signupEmail' | 'signupFullName'
>;

/**
 * Narrowed shape after the gate passes — both inputs are non-null so the
 * caller can use them without further null checks.
 */
export type ReadyForAccountCreationProvisioning =
  AccountCreationProvisioningSessionSlice & {
    signupEmail: string;
    signupFullName: string;
  };

/**
 * Schema-backed gate. Strictness matches the prior manual check exactly:
 * `signupEmail` and `signupFullName` must be non-null AND non-empty
 * strings (`.min(1)`); the auth path must be `create_account`. No regex
 * validation here — the upstream `CliArgsSchema` already regex-validates
 * email at the trust boundary.
 */
const ProvisioningReadySchema = z.object({
  authOnboardingPath: z.literal(AuthOnboardingPath.CreateAccount),
  signupEmail: z.string().min(1),
  signupFullName: z.string().min(1),
});

/**
 * True when the user is on the new-account path and both provisioning inputs
 * are present — safe to POST direct signup (agent/CI). Type predicate so the
 * caller sees `signupEmail` and `signupFullName` as `string` (not
 * `string | null`) inside the truthy branch.
 */
export function accountCreationProvisioningInputsReady(
  session: AccountCreationProvisioningSessionSlice,
): session is ReadyForAccountCreationProvisioning {
  return ProvisioningReadySchema.safeParse(session).success;
}

/**
 * Schema-backed readiness check for the session state that
 * `SigningUpScreen` needs to build a `kind: 'with_required_fields'` input. Matches
 * the prior manual null-check ladder exactly: each field must be
 * non-null, but no additional shape validation (e.g. URL regex) is
 * performed — the underlying types already constrain inner shapes, and
 * the upstream parser is the trust boundary for URL validation.
 *
 * Centralized here (rather than inlined at the screen) so the "what
 * makes a complete with_required_fields session" contract has one home, alongside
 * the related `ProvisioningReadySchema`.
 */
export const FollowUpSessionReadySchema = z.object({
  signupFullName: z.string(),
  legalDocumentBundle: z.object({
    terms_of_service: z.string(),
    privacy_policy: z.string(),
  }),
  legalDocumentSource: z.enum(['server', 'local']),
});

/** Narrowed session subset after `FollowUpSessionReadySchema.safeParse` succeeds. */
export type FollowUpSessionReady = z.infer<typeof FollowUpSessionReadySchema>;
