/**
 * SignupEmailScreen — Tab escape contract.
 *
 * Locks in the "I already have an account" inline escape:
 *   - the hint line renders verbatim under the input
 *   - pressing Tab flips authOnboardingPath to SignIn
 *   - pressing Tab captures the `signup email sign in chosen` event
 *   - pressing Tab does not leak a tab character into the TextInput buffer
 *     (canary for a future @inkjs/ui upgrade that starts consuming Tab)
 *
 * Design + walkthrough:
 *   ~/repos/docs/projects/2026-05-14-single-continue-intro/
 */

import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { SignupEmailScreen } from '../SignupEmailScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import { AuthOnboardingPath } from '../../../../lib/wizard-session.js';
import { analytics } from '../../../../utils/analytics.js';

describe('SignupEmailScreen — sign-in escape', () => {
  it('renders the inline sign-in hint line under the input', () => {
    const store = makeStoreForSnapshot({});
    const { lastFrame } = render(<SignupEmailScreen store={store} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain(
      'Already have an account? Press [Tab] to sign in via browser',
    );
  });

  it('flips authOnboardingPath to SignIn when Tab is pressed', () => {
    const store = makeStoreForSnapshot({});
    const setPathSpy = vi.spyOn(store, 'setAuthOnboardingPath');
    const { stdin } = render(<SignupEmailScreen store={store} />);

    // Tab is ASCII 0x09.
    stdin.write('\t');

    expect(setPathSpy).toHaveBeenCalledWith(AuthOnboardingPath.SignIn);
  });

  it('captures the signup-sign-in analytics event when Tab is pressed', () => {
    const store = makeStoreForSnapshot({});
    const captureSpy = vi.spyOn(analytics, 'wizardCapture');
    const { stdin } = render(<SignupEmailScreen store={store} />);

    stdin.write('\t');

    const captured = captureSpy.mock.calls.find(
      (args) => args[0] === 'signup email sign in chosen',
    );
    expect(captured).toBeDefined();
  });

  it('does not leak a tab character into the email input buffer', () => {
    // Canary: @inkjs/ui's TextInput is greedy with input. If a future
    // version starts consuming Tab for autocomplete/focus behavior, this
    // test catches the regression — the placeholder would be replaced by
    // a tab-char display and the assertion would fail.
    const store = makeStoreForSnapshot({});
    const { stdin, lastFrame } = render(<SignupEmailScreen store={store} />);

    stdin.write('\t');

    const frame = lastFrame() ?? '';
    // Placeholder stays visible — proves the TextInput buffer is empty
    // (placeholder text only shows when the buffer has no content).
    expect(frame).toContain('your.email@example.com');
  });
});
