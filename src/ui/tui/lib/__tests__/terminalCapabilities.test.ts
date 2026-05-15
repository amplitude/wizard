/**
 * terminalCapabilities — pure-function detection tests.
 *
 * Each test mutates `process.env` and `process.stdout.isTTY` for its
 * scope, then restores them afterwards. The module is intentionally
 * un-cached so this kind of mutation works without re-importing.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isInteractive,
  supportsRoundedCorners,
  supportsTruecolor,
  supportsUnicode,
} from '../terminalCapabilities.js';

const ENV_KEYS = [
  'COLORTERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'WIZARD_FORCE_ASCII',
  'WT_SESSION',
  'TERM_PROGRAM',
] as const;

describe('terminalCapabilities', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let savedIsTTY: unknown;
  let savedPlatform: NodeJS.Platform;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    savedIsTTY = (process.stdout as unknown as { isTTY: unknown }).isTTY;
    // Force isTTY=true by default so the truecolor check has a chance
    // to run; individual tests can override.
    (process.stdout as unknown as { isTTY: boolean }).isTTY = true;
    savedPlatform = process.platform;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    (process.stdout as unknown as { isTTY: unknown }).isTTY = savedIsTTY;
    Object.defineProperty(process, 'platform', {
      value: savedPlatform,
      writable: false,
      configurable: true,
    });
  });

  describe('supportsTruecolor', () => {
    it('returns true when COLORTERM === "truecolor" and TTY', () => {
      process.env.COLORTERM = 'truecolor';
      expect(supportsTruecolor()).toBe(true);
    });

    it('returns false when COLORTERM is unset', () => {
      expect(supportsTruecolor()).toBe(false);
    });

    it('returns false when COLORTERM is "256color"', () => {
      process.env.COLORTERM = '256color';
      expect(supportsTruecolor()).toBe(false);
    });

    it('returns false when not a TTY (CI / pipe)', () => {
      process.env.COLORTERM = 'truecolor';
      (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
      expect(supportsTruecolor()).toBe(false);
    });
  });

  describe('supportsUnicode', () => {
    it('returns true when LANG contains UTF-8', () => {
      process.env.LANG = 'en_US.UTF-8';
      expect(supportsUnicode()).toBe(true);
    });

    it('returns true when LC_ALL contains utf8 (no dash)', () => {
      process.env.LC_ALL = 'C.utf8';
      expect(supportsUnicode()).toBe(true);
    });

    it('returns true when LC_CTYPE contains UTF-8 even with empty LANG', () => {
      process.env.LANG = '';
      process.env.LC_CTYPE = 'en_GB.UTF-8';
      expect(supportsUnicode()).toBe(true);
    });

    it('returns false when no locale variable indicates UTF-8', () => {
      process.env.LANG = 'C';
      expect(supportsUnicode()).toBe(false);
    });

    it('returns false when WIZARD_FORCE_ASCII=1, even with UTF-8 LANG', () => {
      process.env.LANG = 'en_US.UTF-8';
      process.env.WIZARD_FORCE_ASCII = '1';
      expect(supportsUnicode()).toBe(false);
    });

    it('returns false when every locale variable is unset', () => {
      expect(supportsUnicode()).toBe(false);
    });
  });

  describe('supportsRoundedCorners', () => {
    it('returns true on UTF-8 non-Windows', () => {
      process.env.LANG = 'en_US.UTF-8';
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: false,
        configurable: true,
      });
      expect(supportsRoundedCorners()).toBe(true);
    });

    it('returns false when unicode is unavailable', () => {
      process.env.LANG = 'C';
      expect(supportsRoundedCorners()).toBe(false);
    });

    it('returns false on win32 without WT_SESSION (legacy cmd host)', () => {
      process.env.LANG = 'en_US.UTF-8';
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: false,
        configurable: true,
      });
      expect(supportsRoundedCorners()).toBe(false);
    });

    it('returns true on Windows Terminal (WT_SESSION set)', () => {
      process.env.LANG = 'en_US.UTF-8';
      process.env.WT_SESSION = 'abc-123';
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: false,
        configurable: true,
      });
      expect(supportsRoundedCorners()).toBe(true);
    });

    it('respects WIZARD_FORCE_ASCII even on a capable terminal', () => {
      process.env.LANG = 'en_US.UTF-8';
      process.env.WIZARD_FORCE_ASCII = '1';
      expect(supportsRoundedCorners()).toBe(false);
    });
  });

  describe('isInteractive', () => {
    it('returns true when stdout.isTTY is true', () => {
      (process.stdout as unknown as { isTTY: boolean }).isTTY = true;
      expect(isInteractive()).toBe(true);
    });

    it('returns false when stdout.isTTY is false', () => {
      (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
      expect(isInteractive()).toBe(false);
    });

    it('returns false when stdout.isTTY is undefined', () => {
      (process.stdout as unknown as { isTTY: unknown }).isTTY = undefined;
      expect(isInteractive()).toBe(false);
    });
  });

  describe('purity', () => {
    it('repeated calls are stable for a given env', () => {
      process.env.LANG = 'en_US.UTF-8';
      process.env.COLORTERM = 'truecolor';
      const snapshot = {
        truecolor: supportsTruecolor(),
        unicode: supportsUnicode(),
        rounded: supportsRoundedCorners(),
        interactive: isInteractive(),
      };
      for (let i = 0; i < 5; i++) {
        expect(supportsTruecolor()).toBe(snapshot.truecolor);
        expect(supportsUnicode()).toBe(snapshot.unicode);
        expect(supportsRoundedCorners()).toBe(snapshot.rounded);
        expect(isInteractive()).toBe(snapshot.interactive);
      }
    });

    it('responds to env mutations (no stale cache)', () => {
      process.env.LANG = 'C';
      expect(supportsUnicode()).toBe(false);
      process.env.LANG = 'en_US.UTF-8';
      expect(supportsUnicode()).toBe(true);
    });
  });
});
