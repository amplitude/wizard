import { describe, it, expect } from 'vitest';
import { FLAG_DIRECT_SIGNUP, isFlagEnabled } from '../feature-flags';

describe('FLAG_DIRECT_SIGNUP', () => {
  it('uses the wizard-direct-signup key', () => {
    expect(FLAG_DIRECT_SIGNUP).toBe('wizard-direct-signup');
  });
});

describe('isFlagEnabled dev override', () => {
  it('returns true for FLAG_DIRECT_SIGNUP when AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP=1', () => {
    const original = process.env.AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP;
    process.env.AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP = '1';
    try {
      expect(isFlagEnabled(FLAG_DIRECT_SIGNUP)).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env.AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP;
      } else {
        process.env.AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP = original;
      }
    }
  });

  it('does not affect other flags', () => {
    const original = process.env.AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP;
    process.env.AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP = '1';
    try {
      expect(isFlagEnabled('wizard-llm-analytics')).toBe(false);
    } finally {
      if (original === undefined) {
        delete process.env.AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP;
      } else {
        process.env.AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP = original;
      }
    }
  });
});
