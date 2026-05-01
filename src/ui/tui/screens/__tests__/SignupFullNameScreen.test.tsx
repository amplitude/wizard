import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { SignupFullNameScreen } from '../SignupFullNameScreen.js';
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

describe('SignupFullNameScreen', () => {
  it('renders the heading', () => {
    const store = makeScreenTestStore({
      accountCreationFlow: true,
      signupRequiredFields: ['full_name'],
    });
    const { lastFrame } = render(<SignupFullNameScreen store={store} />);
    expect(lastFrame()).toContain('Enter your full name');
  });

  it('rejects empty input with an inline error', async () => {
    const store = makeScreenTestStore({
      accountCreationFlow: true,
      signupRequiredFields: ['full_name'],
    });
    const { lastFrame, stdin } = render(<SignupFullNameScreen store={store} />);
    stdin.write('   ');
    await new Promise((r) => setTimeout(r, 10));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame()).toMatch(/cannot be empty/i);
    expect(store.session.signupFullName).toBeNull();
  });

  it('writes trimmed value to session on valid submit', async () => {
    const store = makeScreenTestStore({
      accountCreationFlow: true,
      signupRequiredFields: ['full_name'],
    });
    const { stdin } = render(<SignupFullNameScreen store={store} />);
    stdin.write('  Jane Doe  ');
    await new Promise((r) => setTimeout(r, 10));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 20));
    expect(store.session.signupFullName).toBe('Jane Doe');
  });
});
