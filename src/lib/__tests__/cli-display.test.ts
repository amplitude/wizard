import { describe, it, expect } from 'vitest';
import {
  formatCliCommand,
  formatResumeCommand,
  normalizeCliCommand,
  shellQuote,
} from '../cli-display';

describe('cli-display', () => {
  describe('normalizeCliCommand', () => {
    it('prepends `npx @amplitude/wizard` when the command starts with bare `wizard`', () => {
      expect(
        normalizeCliCommand(['wizard', 'verification', 'mark', 'abc']),
      ).toEqual(['npx', '@amplitude/wizard', 'verification', 'mark', 'abc']);
    });

    it('replaces a leading `amplitude-wizard` token with `npx @amplitude/wizard`', () => {
      expect(normalizeCliCommand(['amplitude-wizard', 'login'])).toEqual([
        'npx',
        '@amplitude/wizard',
        'login',
      ]);
    });

    it('leaves an already-prefixed command untouched', () => {
      expect(
        normalizeCliCommand(['npx', '@amplitude/wizard', 'status']),
      ).toEqual(['npx', '@amplitude/wizard', 'status']);
    });

    it('treats an unrecognized leading token as an argument, not a binary', () => {
      // No bin to strip — prepend the full prefix in front of the args.
      expect(normalizeCliCommand(['feedback'])).toEqual([
        'npx',
        '@amplitude/wizard',
        'feedback',
      ]);
    });

    it('handles an empty array by emitting just the prefix', () => {
      expect(normalizeCliCommand([])).toEqual(['npx', '@amplitude/wizard']);
    });
  });

  describe('formatResumeCommand / formatCliCommand', () => {
    it('formats a bare `wizard` command with the npx prefix', () => {
      expect(
        formatResumeCommand(['wizard', 'verification', 'mark', 'abc']),
      ).toBe('npx @amplitude/wizard verification mark abc');
    });

    it('does not double-prefix when `npx @amplitude/wizard` is already present', () => {
      expect(formatResumeCommand(['npx', '@amplitude/wizard', 'status'])).toBe(
        'npx @amplitude/wizard status',
      );
    });

    it('shell-quotes parts containing spaces', () => {
      expect(formatResumeCommand(['wizard', 'mark', 'arg with space'])).toBe(
        'npx @amplitude/wizard mark "arg with space"',
      );
    });

    it('shell-quotes parts containing shell metacharacters', () => {
      expect(formatResumeCommand(['wizard', 'feedback', 'hi $USER'])).toBe(
        'npx @amplitude/wizard feedback "hi $USER"',
      );
    });

    it('formatCliCommand is the same helper as formatResumeCommand', () => {
      expect(formatCliCommand).toBe(formatResumeCommand);
    });

    it('renders the canonical login resume hint', () => {
      // Mirrors the auth_required envelope in src/commands/helpers.ts
      expect(formatResumeCommand(['amplitude-wizard', 'login'])).toBe(
        'npx @amplitude/wizard login',
      );
    });
  });

  describe('shellQuote', () => {
    it('passes plain alphanumerics through unquoted', () => {
      expect(shellQuote('hello')).toBe('hello');
      expect(shellQuote('abc123')).toBe('abc123');
      expect(shellQuote('--plan-id')).toBe('--plan-id');
      expect(shellQuote('a/b/c')).toBe('a/b/c');
    });

    it('double-quotes strings with whitespace', () => {
      expect(shellQuote('hello world')).toBe('"hello world"');
    });

    it('escapes embedded double quotes and backslashes', () => {
      expect(shellQuote('he said "hi"')).toBe('"he said \\"hi\\""');
      expect(shellQuote('back\\slash')).toBe('"back\\\\slash"');
    });

    it('renders an empty string as a pair of double quotes', () => {
      expect(shellQuote('')).toBe('""');
    });
  });
});
