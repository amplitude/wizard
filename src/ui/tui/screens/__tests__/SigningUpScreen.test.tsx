import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { SigningUpScreen } from '../SigningUpScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import { waitForFrame } from '../../__tests__/ink-stdin.js';

const performSignupOrAuth = vi.hoisted(() => vi.fn());

vi.mock('../../../../utils/signup-or-auth.js', () => ({
  performSignupOrAuth,
}));

describe('SigningUpScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('abandons instead of accepting success from the email-only probe before ToS', async () => {
    performSignupOrAuth.mockResolvedValue({
      kind: 'success',
      idToken: 'direct-id',
      accessToken: 'direct-access',
      refreshToken: 'direct-refresh',
      zone: 'us',
      userInfo: null,
      dashboardUrl: null,
    });
    const store = makeStoreForSnapshot({
      region: 'us',
      signupEmail: 'ada@example.com',
      signupFullName: null,
      signupRequiredFields: null,
      tosAccepted: null,
    });
    const setSignupAuthSpy = vi.spyOn(store, 'setSignupAuth');
    const setSignupAbandonedSpy = vi.spyOn(store, 'setSignupAbandoned');

    const view = render(<SigningUpScreen store={store} />);
    await waitForFrame();
    await waitForFrame();

    expect(setSignupAuthSpy).not.toHaveBeenCalled();
    expect(setSignupAbandonedSpy).toHaveBeenCalledWith(true);
    view.unmount();
  });
});
