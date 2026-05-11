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
 * True when the user is on the new-account path and both provisioning inputs
 * are present — safe to POST direct signup (agent/CI). Type predicate so the
 * caller sees `signupEmail` and `signupFullName` as `string` (not
 * `string | null`) inside the truthy branch.
 */
export function accountCreationProvisioningInputsReady(
  session: AccountCreationProvisioningSessionSlice,
): session is ReadyForAccountCreationProvisioning {
  return (
    session.authOnboardingPath === AuthOnboardingPath.CreateAccount &&
    session.signupEmail !== null &&
    session.signupEmail.length > 0 &&
    session.signupFullName !== null &&
    session.signupFullName.length > 0
  );
}
