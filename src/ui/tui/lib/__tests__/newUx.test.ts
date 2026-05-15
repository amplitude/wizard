import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isNewUxEnabled } from '../newUx';

describe('isNewUxEnabled', () => {
  const original = process.env.WIZARD_OLD_UX;

  beforeEach(() => {
    delete process.env.WIZARD_OLD_UX;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.WIZARD_OLD_UX;
    } else {
      process.env.WIZARD_OLD_UX = original;
    }
  });

  it('returns true when WIZARD_OLD_UX is unset (new UX is the default)', () => {
    expect(isNewUxEnabled()).toBe(true);
  });

  it('returns false when WIZARD_OLD_UX === "1" (explicit opt-out)', () => {
    process.env.WIZARD_OLD_UX = '1';
    expect(isNewUxEnabled()).toBe(false);
  });

  it('returns true when WIZARD_OLD_UX === "" (empty string is not opt-out)', () => {
    process.env.WIZARD_OLD_UX = '';
    expect(isNewUxEnabled()).toBe(true);
  });

  it('returns true for any non-"1" value (e.g. "0", "false", "true")', () => {
    for (const value of ['0', 'false', 'true', 'yes', 'no']) {
      process.env.WIZARD_OLD_UX = value;
      expect(isNewUxEnabled()).toBe(true);
    }
  });
});
