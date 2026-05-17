/**
 * Shared helpers for BDD step definitions.
 *
 * These helpers extract the small set of session-mutation primitives that
 * every wizard step file was previously duplicating. They mirror what the
 * real screens / store would write in production — keep them aligned with
 * the live router resolution invariants in `src/ui/tui/router.ts`.
 */
import { WizardRouter } from '../../src/ui/tui/router.js';
import { Flow } from '../../src/ui/tui/flows.js';
import {
  buildSession,
  type WizardSession,
} from '../../src/lib/wizard-session.js';

/** Standard credentials block used by every wizard test that needs to look authenticated. */
export function mockCredentials(): WizardSession['credentials'] {
  return {
    accessToken: 'access-abc',
    projectApiKey: 'api-key-xyz',
    host: 'https://api.amplitude.com',
    appId: 123456,
  };
}

/** Fill in default org / project / env names so identity-gated screens unblock. */
export function ensureIdentityNames(s: WizardSession): void {
  s.selectedOrgName = s.selectedOrgName ?? 'Test Org';
  s.selectedProjectName = s.selectedProjectName ?? 'Default';
  s.selectedEnvName = s.selectedEnvName ?? 'Default';
}

/**
 * Mark the session as past intro + region + auth so the router lands on the
 * Data Setup / Activation Check phase. Leaves `projectHasData` as `false`
 * (a fresh project) unless overridden by the caller.
 */
export function advancePastAuth(s: WizardSession): void {
  s.introConcluded = true;
  s.credentials = mockCredentials();
  ensureIdentityNames(s);
  s.region = 'us';
  s.projectHasData = false;
}

/** Build a fresh router + session pair pinned to a per-scenario installDir. */
export function newRouterAndSession(
  options: { installDir?: string; flow?: Flow } = {},
): { router: WizardRouter; session: WizardSession } {
  return {
    router: new WizardRouter(options.flow ?? Flow.Wizard),
    session: buildSession(
      options.installDir ? { installDir: options.installDir } : {},
    ),
  };
}
