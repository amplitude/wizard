import { describe, it, expect } from 'vitest';
import { FLAG_DIRECT_SIGNUP } from '../feature-flags';

describe('FLAG_DIRECT_SIGNUP', () => {
  it('uses the wizard-direct-signup key', () => {
    expect(FLAG_DIRECT_SIGNUP).toBe('wizard-direct-signup');
  });
});
