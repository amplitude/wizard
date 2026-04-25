import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { SignupEmailScreen } from '../SignupEmailScreen.js';
import { makeScreenTestStore } from '../../__tests__/screen-test-utils.js';

vi.mock('../../../../utils/analytics.js', () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    setSessionProperty: vi.fn(),
    setDistinctId: vi.fn(),
    identifyUser: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    isFeatureFlagEnabled: vi.fn().mockReturnValue(true),
  },
  sessionProperties: vi.fn(() => ({})),
  sessionPropertiesCompact: vi.fn(() => ({})),
}));

describe('SignupEmailScreen', () => {
  it('renders the heading', () => {
    const store = makeScreenTestStore({ signup: true });
    const { lastFrame } = render(<SignupEmailScreen store={store} />);
    expect(lastFrame()).toContain('Enter the email for your new account');
  });

  it('rejects invalid email with an inline error', async () => {
    const store = makeScreenTestStore({ signup: true });
    const { lastFrame, stdin } = render(<SignupEmailScreen store={store} />);
    stdin.write('not-an-email');
    await new Promise((r) => setTimeout(r, 10));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame()).toMatch(/valid email/i);
    expect(store.session.signupEmail).toBeNull();
  });

  it('writes email to session on valid submit', async () => {
    const store = makeScreenTestStore({ signup: true });
    const { stdin } = render(<SignupEmailScreen store={store} />);
    stdin.write('jane@example.com');
    await new Promise((r) => setTimeout(r, 10));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 20));
    expect(store.session.signupEmail).toBe('jane@example.com');
  });
});
