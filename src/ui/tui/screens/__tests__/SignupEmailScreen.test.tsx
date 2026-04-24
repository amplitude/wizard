import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { WizardStore } from '../../store.js';
import { buildSession } from '../../../../lib/wizard-session.js';
import { SignupEmailScreen } from '../SignupEmailScreen.js';

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

function makeStore(): WizardStore {
  const store = new WizardStore();
  store.session = { ...buildSession({}), signup: true };
  return store;
}

describe('SignupEmailScreen', () => {
  it('renders the heading', () => {
    const store = makeStore();
    const { lastFrame } = render(<SignupEmailScreen store={store} />);
    expect(lastFrame()).toContain('Enter the email for your new account');
  });

  it('rejects invalid email with an inline error', async () => {
    const store = makeStore();
    const { lastFrame, stdin } = render(<SignupEmailScreen store={store} />);
    stdin.write('not-an-email');
    await new Promise((r) => setTimeout(r, 10));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame()).toMatch(/valid email/i);
    expect(store.session.signupEmail).toBeNull();
  });

  it('writes email to session on valid submit', async () => {
    const store = makeStore();
    const { stdin } = render(<SignupEmailScreen store={store} />);
    stdin.write('jane@example.com');
    await new Promise((r) => setTimeout(r, 10));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 20));
    expect(store.session.signupEmail).toBe('jane@example.com');
  });
});
