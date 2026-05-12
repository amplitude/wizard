import { z } from 'zod';
import { AuthOnboardingPath, type WizardSession } from './wizard-session.js';
import {
  KNOWN_REQUIRED_KEYS,
  type RequiredKey,
} from '../utils/direct-signup.js';
import { assertNever } from '../utils/assert-never.js';

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
 * Builds a Zod schema asserting that the session holds every field the
 * BE asked for in `needs_information.required`. Parameterized on the
 * `RequiredKey[]` so each call validates exactly the subset SigningUp
 * was told to collect — never more, never less.
 *
 * Replaces the previous fixed `FollowUpSessionReadySchema` (which
 * demanded both `signupFullName` AND `legalDocumentBundle` regardless
 * of what the BE asked for). After BA-149, the BE may ask for any
 * non-empty subset of `KNOWN_REQUIRED_KEYS`, and the readiness check
 * must mirror that subset — otherwise a `'terms_acceptance'`-only
 * ceremony fails readiness on the still-null `signupFullName` and
 * falls through to OAuth.
 *
 * The `assertNever` exhaustive switch is the source-of-truth gate for
 * new `RequiredKey` kinds — adding one to `KNOWN_REQUIRED_KEYS` becomes
 * a compile error here until the contributor maps it to a session field
 * (or explicitly opts out by adding it to the switch as a no-op).
 *
 * `.passthrough()` so the returned schema retains session fields outside
 * the asserted subset (the caller's session has many more fields than
 * this schema cares about; `.strict()` would fail on the first
 * non-required field).
 */
export function buildFollowUpSessionReadySchema(required: RequiredKey[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const key of required) {
    switch (key) {
      case 'full_name':
        shape.signupFullName = z.string();
        break;
      case 'terms_acceptance':
        shape.legalDocumentBundle = z.object({
          terms_of_service: z.string(),
          privacy_policy: z.string(),
        });
        shape.legalDocumentSource = z.enum(['server', 'local']);
        break;
      default:
        assertNever(key);
    }
  }
  return z.object(shape).passthrough();
}

/**
 * Narrowed session subset after `buildFollowUpSessionReadySchema(required)
 * .safeParse(session)` succeeds. Properties are optional because the
 * builder includes only the fields the BE asked for in this ceremony.
 *
 * `RequiredKey` is re-exported here as a convenience so consumers
 * (`SigningUpScreen`, tests) don't have to dual-import from
 * `direct-signup` alongside the builder. The actual definition still
 * lives in `direct-signup` as the wire-contract source of truth — see
 * `KNOWN_REQUIRED_KEYS`.
 */
export type FollowUpSessionReady = {
  signupFullName?: string;
  legalDocumentBundle?: {
    terms_of_service: string;
    privacy_policy: string;
  };
  legalDocumentSource?: 'server' | 'local';
};

export { KNOWN_REQUIRED_KEYS, type RequiredKey };
