import { describe, expect, it } from 'vitest';

// Skip the per-project storage bootstrap (migration shim + project log
// file routing) — same reason cli.test.ts sets it.
process.env.AMPLITUDE_WIZARD_SKIP_BOOTSTRAP = '1';

import { isAuthTaskGateReady } from '../helpers.js';
import { buildSession, type WizardSession } from '../../lib/wizard-session.js';

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
  // the user could fill EmailCapture / accept ToS.
  it('blocks create-account runs until ToS is accepted', () => {
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

  it('blocks create-account runs that have only completed email capture', () => {
    expect(
      isAuthTaskGateReady(
        s({
          introConcluded: true,
          region: 'us',
          authOnboardingPath: 'create_account',
          emailCaptureComplete: true,
          tosAccepted: false,
        }),
      ),
    ).toBe(false);
  });

  it('releases create-account onboarding once ToS is accepted (no --signup)', () => {
    expect(
      isAuthTaskGateReady(
        s({
          introConcluded: true,
          region: 'us',
          authOnboardingPath: 'create_account',
          emailCaptureComplete: true,
          tosAccepted: true,
          accountCreationFlow: false,
          signupAuth: null,
          signupAbandoned: false,
        }),
      ),
    ).toBe(true);
  });

  it('blocks --signup after ToS until SigningUpScreen settles (no auth yet)', () => {
    expect(
      isAuthTaskGateReady(
        s({
          introConcluded: true,
          region: 'us',
          authOnboardingPath: 'create_account',
          emailCaptureComplete: true,
          tosAccepted: true,
          accountCreationFlow: true,
          signupAuth: null,
          signupAbandoned: false,
        }),
      ),
    ).toBe(false);
  });

  it('releases --signup once direct signup wrote signupAuth', () => {
    expect(
      isAuthTaskGateReady(
        s({
          introConcluded: true,
          region: 'us',
          accountCreationFlow: true,
          emailCaptureComplete: true,
          tosAccepted: true,
          signupAuth: {
            kind: 'success',
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

  it('releases --signup once SigningUpScreen abandoned to OAuth fallback', () => {
    expect(
      isAuthTaskGateReady(
        s({
          introConcluded: true,
          region: 'us',
          accountCreationFlow: true,
          emailCaptureComplete: true,
          tosAccepted: true,
          signupAuth: null,
          signupAbandoned: true,
        }),
      ),
    ).toBe(true);
  });
});
