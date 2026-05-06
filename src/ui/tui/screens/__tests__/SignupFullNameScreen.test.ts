import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WizardStore } from '../../store.js';

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

// Mirrors the handleSubmit logic from SignupFullNameScreen so we can test
// validation and store interaction without a render environment.
function runHandleSubmit(store: WizardStore, rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return 'Full name cannot be empty';
  }
  store.setSignupFullName(trimmed);
  return null;
}

describe('SignupFullNameScreen — submit logic', () => {
  let store: WizardStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
  });

  it('rejects empty input with an inline error and does not write to session', () => {
    const error = runHandleSubmit(store, '');
    expect(error).toMatch(/cannot be empty/i);
    expect(store.session.signupFullName).toBeNull();
  });

  it('rejects whitespace-only input the same way', () => {
    const error = runHandleSubmit(store, '   ');
    expect(error).toMatch(/cannot be empty/i);
    expect(store.session.signupFullName).toBeNull();
  });

  it('writes the trimmed value to session on valid submit', () => {
    const error = runHandleSubmit(store, '  Jane Doe  ');
    expect(error).toBeNull();
    expect(store.session.signupFullName).toBe('Jane Doe');
  });

  it('accepts a single-word name', () => {
    const error = runHandleSubmit(store, 'Jane');
    expect(error).toBeNull();
    expect(store.session.signupFullName).toBe('Jane');
  });
});
