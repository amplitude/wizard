import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WizardStore } from '../../store.js';
import { EMAIL_REGEX } from '../../../../lib/constants.js';

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
  return new WizardStore();
}

// Mirrors the handleSubmit logic from SignupEmailScreen so we can test
// validation and store interaction without a render environment.
function runHandleSubmit(store: WizardStore, rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!EMAIL_REGEX.test(trimmed)) {
    return 'Please enter a valid email';
  }
  store.setSignupEmail(trimmed);
  return null;
}

describe('SignupEmailScreen — submit logic', () => {
  let store: WizardStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
  });

  it('rejects an invalid email and does not write to session', () => {
    const error = runHandleSubmit(store, 'not-an-email');
    expect(error).toMatch(/valid email/i);
    expect(store.session.signupEmail).toBeNull();
  });

  it('rejects an address missing the local part', () => {
    const error = runHandleSubmit(store, '@missing-local.com');
    expect(error).toMatch(/valid email/i);
    expect(store.session.signupEmail).toBeNull();
  });

  it('writes the trimmed value to session on valid submit', () => {
    const error = runHandleSubmit(store, 'jane@example.com');
    expect(error).toBeNull();
    expect(store.session.signupEmail).toBe('jane@example.com');
  });

  it('accepts and trims an email with leading/trailing whitespace', () => {
    const error = runHandleSubmit(store, '  jane@example.com  ');
    expect(error).toBeNull();
    expect(store.session.signupEmail).toBe('jane@example.com');
  });
});
