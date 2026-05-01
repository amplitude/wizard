import type { WizardSession } from './wizard-session.js';

/** Subset of session fields that gate direct (non-TUI) account provisioning. */
export type AccountCreationProvisioningSessionSlice = Pick<
  WizardSession,
  'accountCreationFlow' | 'signupEmail' | 'signupFullName'
>;

/**
 * True when the user is on the new-account path and both provisioning inputs
 * are present — safe to POST direct signup (agent/CI/classic).
 */
export function accountCreationProvisioningInputsReady(
  session: AccountCreationProvisioningSessionSlice,
): boolean {
  return Boolean(
    session.accountCreationFlow &&
      session.signupEmail &&
      session.signupFullName,
  );
}
