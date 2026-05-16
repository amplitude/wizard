import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { SignupEmailScreen } from '../SignupEmailScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import { AuthOnboardingPath } from '../../../../lib/wizard-session.js';
import { analytics } from '../../../../utils/analytics.js';

// Each test seeds authOnboardingPath = CreateAccount because that's the
// only state where the user is actually on SignupEmailScreen — the
// flow predicate requires it. The schema default is 'sign_in', so
// without this seed the "flips to SignIn" assertion below would pass
// vacuously regardless of whether switchToLogin() ran.
const createAccountState = {
  authOnboardingPath: AuthOnboardingPath.CreateAccount,
} as const;

describe('SignupEmailScreen — sign-in escape', () => {
  it('renders the inline sign-in hint line under the input', () => {
    const store = makeStoreForSnapshot(createAccountState);
    const { lastFrame } = render(<SignupEmailScreen store={store} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain(
      'Already have an account? Press Tab to sign in via browser',
    );
  });

  it('flips authOnboardingPath to SignIn when Tab is pressed', () => {
    const store = makeStoreForSnapshot(createAccountState);
    expect(store.session.authOnboardingPath).toBe(
      AuthOnboardingPath.CreateAccount,
    );

    const { stdin } = render(<SignupEmailScreen store={store} />);
    stdin.write('\t');

    expect(store.session.authOnboardingPath).toBe(AuthOnboardingPath.SignIn);
  });

  it('captures the signup-switched-to-login event when Tab is pressed', () => {
    const store = makeStoreForSnapshot(createAccountState);
    const captureSpy = vi.spyOn(analytics, 'wizardCapture');
    const { stdin } = render(<SignupEmailScreen store={store} />);

    stdin.write('\t');

    const captured = captureSpy.mock.calls.find(
      (args) => args[0] === 'signup switched to login',
    );
    expect(captured).toBeDefined();
    expect(captured?.[1]).toMatchObject({ reason: 'existing user' });
  });

  it('does not leak a tab character into the email input buffer', () => {
    // Canary for a future @inkjs/ui upgrade that consumes Tab itself.
    const store = makeStoreForSnapshot(createAccountState);
    const { stdin, lastFrame } = render(<SignupEmailScreen store={store} />);

    stdin.write('\t');

    const frame = lastFrame() ?? '';
    expect(frame).toContain('your.email@example.com');
  });
});
