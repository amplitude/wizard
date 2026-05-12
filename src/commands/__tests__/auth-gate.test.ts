import { describe, expect, it } from 'vitest';

// Skip the per-project storage bootstrap (migration shim + project log
// file routing) — same reason cli.test.ts sets it.
process.env.AMPLITUDE_WIZARD_SKIP_BOOTSTRAP = '1';

import { isAuthTaskGateReady, applyEnvSelectionDeferral } from '../helpers.js';
import { buildSession, type WizardSession } from '../../lib/wizard-session.js';
import type { ResolveCredentialsResult } from '../../lib/credential-resolution.js';

function s(overrides: Partial<WizardSession>): WizardSession {
  return { ...buildSession({}), ...overrides };
}

describe('isAuthTaskGateReady', () => {
  it('blocks until intro is dismissed', () => {
    expect(
      isAuthTaskGateReady(s({ introConcluded: false, region: 'us' })),
    ).toBe(false);
  });

  it('blocks until a region is picked', () => {
    expect(isAuthTaskGateReady(s({ introConcluded: true, region: null }))).toBe(
      false,
    );
  });

  it('blocks while regionForced is set (mid-/region pick)', () => {
    expect(
      isAuthTaskGateReady(
        s({ introConcluded: true, region: 'us', regionForced: true }),
      ),
    ).toBe(false);
  });

  it('releases for a non-signup user once intro + region are done', () => {
    expect(isAuthTaskGateReady(s({ introConcluded: true, region: 'us' }))).toBe(
      true,
    );
  });

  // Regression for the create-account onboarding path: the auth task used
  // to fire as soon as Region was picked, popping the OAuth browser before
  // the user could fill EmailCapture / accept ToS. Note that the *gate
  // itself* no longer checks `tosAccepted` — pre-PR-539 it held on
  // `emailCaptureComplete && !tosAccepted`, but the rewire moved the
  // gating predicate to "signup ceremony has settled"
  // (`signupAuth !== null || signupAbandoned`). These two cases pin that
  // various pre-ceremony `tosAccepted` values still hold the gate via the
  // ceremony-unsettled path, not via a ToS check.
  it('blocks create-account runs with tosAccepted=null (ceremony unsettled)', () => {
    expect(
      isAuthTaskGateReady(
        s({
          introConcluded: true,
          region: 'us',
          authOnboardingPath: 'create_account',
          tosAccepted: null,
        }),
      ),
    ).toBe(false);
  });

  it('blocks create-account runs with tosAccepted=false (ceremony unsettled)', () => {
    expect(
      isAuthTaskGateReady(
        s({
          introConcluded: true,
          region: 'us',
          authOnboardingPath: 'create_account',
          tosAccepted: false,
        }),
      ),
    ).toBe(false);
  });

  it('blocks create-account onboarding while signup ceremony is in flight', () => {
    // Even with intro+region+ToS, the gate must hold for the create-account
    // path until SigningUpScreen has settled the ceremony. Otherwise the
    // auth task opens browser OAuth concurrently with the in-flight POST.
    expect(
      isAuthTaskGateReady(
        s({
          introConcluded: true,
          region: 'us',
          authOnboardingPath: 'create_account',
          tosAccepted: true,
          signupAuth: null,
          signupAbandoned: false,
        }),
      ),
    ).toBe(false);
  });

  it('releases create-account onboarding once signupAuth is captured', () => {
    expect(
      isAuthTaskGateReady(
        s({
          introConcluded: true,
          region: 'us',
          authOnboardingPath: 'create_account',
          tosAccepted: true,
          signupAuth: {
            idToken: 'i',
            accessToken: 'a',
            refreshToken: 'r',
            zone: 'us',
            userInfo: null,
            dashboardUrl: null,
          },
          signupAbandoned: false,
        }),
      ),
    ).toBe(true);
  });

  it('releases create-account onboarding once SigningUpScreen abandons to OAuth', () => {
    // signupAbandoned is the wrapper's "fall through to browser OAuth"
    // signal — the auth task must release so the OAuth flow opens.
    expect(
      isAuthTaskGateReady(
        s({
          introConcluded: true,
          region: 'us',
          authOnboardingPath: 'create_account',
          tosAccepted: false,
          signupAuth: null,
          signupAbandoned: true,
        }),
      ),
    ).toBe(true);
  });
});

describe('applyEnvSelectionDeferral', () => {
  // Stand-in credentials shape that satisfies the session type — values are
  // load-bearing only insofar as `credentials !== null` is what feeds
  // `Auth.isComplete` in `src/ui/tui/flows.ts`.
  const staleCredentials: NonNullable<WizardSession['credentials']> = {
    accessToken: 'stale-access',
    idToken: 'stale-id',
    projectApiKey: 'stale-pak',
    host: 'https://us.amplitude.com',
    appId: 0,
  };

  // Regression test for the live race-condition bug: on rerun, a stored API
  // key (or checkpoint rehydration) leaves session.credentials non-null even
  // when the resolver just returned `needs_user_choice/environment_selection`.
  // Auth.isComplete then evaluates true (it doesn't gate on selectedEnvName),
  // the router advances past Auth to Setup, and the user is stranded with no
  // env-picker surface. The fix forces credentials back to null so the flow
  // gate fails and the router returns to AuthScreen.
  it('clears env/appId/credentials on needs_user_choice + environment_selection (interactive rerun path)', () => {
    const session = s({
      // Simulate rerun: credentials populated from a stored API key or
      // checkpoint rehydration.
      credentials: { ...staleCredentials },
      // Org/project still selected from prior run.
      selectedOrgId: 'org-1',
      selectedOrgName: 'Acme',
      selectedProjectId: 'proj-1',
      selectedProjectName: 'Mobile',
      // Stale env pre-selection that the resolver wants the user to revisit.
      selectedEnvName: 'staging',
      selectedAppId: '12345',
      ci: false,
      agent: false,
    });

    const resolution: ResolveCredentialsResult = {
      outcome: 'needs_user_choice',
      kind: 'environment_selection',
      envsWithKey: 2,
    };

    const applied = applyEnvSelectionDeferral(session, resolution);

    expect(applied).toBe(true);
    expect(session.selectedEnvName).toBeNull();
    expect(session.selectedAppId).toBeNull();
    // The new assertion that closes the bug — Auth.isComplete reads this.
    expect(session.credentials).toBeNull();
  });

  it('does nothing in --ci mode (structured rejection happens elsewhere)', () => {
    const session = s({
      credentials: { ...staleCredentials },
      selectedEnvName: 'staging',
      selectedAppId: '12345',
      ci: true,
      agent: false,
    });

    const applied = applyEnvSelectionDeferral(session, {
      outcome: 'needs_user_choice',
      kind: 'environment_selection',
      envsWithKey: 2,
    });

    expect(applied).toBe(false);
    expect(session.credentials).not.toBeNull();
    expect(session.selectedEnvName).toBe('staging');
    expect(session.selectedAppId).toBe('12345');
  });

  it('does nothing in --agent mode (structured rejection happens elsewhere)', () => {
    const session = s({
      credentials: { ...staleCredentials },
      selectedEnvName: 'staging',
      selectedAppId: '12345',
      ci: false,
      agent: true,
    });

    const applied = applyEnvSelectionDeferral(session, {
      outcome: 'needs_user_choice',
      kind: 'environment_selection',
      envsWithKey: 2,
    });

    expect(applied).toBe(false);
    expect(session.credentials).not.toBeNull();
  });

  // Negative regression: any outcome OTHER than
  // `needs_user_choice + environment_selection` must NOT clear credentials.
  // The discriminant gate exists so future `needs_user_choice` `kind`s can
  // opt in explicitly rather than inheriting credentials-clearing semantics
  // that may be wrong for them.
  it('preserves credentials for outcome=resolved', () => {
    const session = s({
      credentials: { ...staleCredentials },
      selectedEnvName: 'production',
      selectedAppId: '67890',
      ci: false,
      agent: false,
    });

    const applied = applyEnvSelectionDeferral(session, { outcome: 'resolved' });

    expect(applied).toBe(false);
    expect(session.credentials).not.toBeNull();
    expect(session.selectedEnvName).toBe('production');
    expect(session.selectedAppId).toBe('67890');
  });

  it('preserves credentials for outcome=api_key_notice', () => {
    const session = s({
      credentials: { ...staleCredentials },
      selectedEnvName: 'production',
      ci: false,
      agent: false,
    });

    const applied = applyEnvSelectionDeferral(session, {
      outcome: 'api_key_notice',
    });

    expect(applied).toBe(false);
    expect(session.credentials).not.toBeNull();
    expect(session.selectedEnvName).toBe('production');
  });

  it('preserves credentials for outcome=unauthenticated', () => {
    const session = s({
      credentials: { ...staleCredentials },
      ci: false,
      agent: false,
    });

    const applied = applyEnvSelectionDeferral(session, {
      outcome: 'unauthenticated',
    });

    expect(applied).toBe(false);
    expect(session.credentials).not.toBeNull();
  });

  it('preserves credentials for outcome=ci_env_token', () => {
    const session = s({
      credentials: { ...staleCredentials },
      ci: false,
      agent: false,
    });

    const applied = applyEnvSelectionDeferral(session, {
      outcome: 'ci_env_token',
    });

    expect(applied).toBe(false);
    expect(session.credentials).not.toBeNull();
  });
});
