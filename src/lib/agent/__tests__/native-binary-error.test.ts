import { describe, it, expect } from 'vitest';

import {
  describeCurrentPlatform,
  formatNativeBinaryMissingMessage,
  isNativeBinaryMissingError,
} from '../native-binary-error.js';

describe('native-binary-error', () => {
  describe('isNativeBinaryMissingError', () => {
    it('matches the production WIZARD-CLI-19 SDK error (path form)', () => {
      // Verbatim shape from Sentry WIZARD-CLI-19.
      const err = new Error(
        'Claude Code native binary not found at /app/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-linux-x64-musl@0.3.219/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude. Please ensure Claude Code is installed via native installer or specify a valid path with options.pathToClaudeCodeExecutable.',
      );
      expect(isNativeBinaryMissingError(err)).toBe(true);
    });

    it('matches the SDK resolution-fallback error (platform form)', () => {
      const err = new Error(
        'Native CLI binary for linux-x64 not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set options.pathToClaudeCodeExecutable.',
      );
      expect(isNativeBinaryMissingError(err)).toBe(true);
    });

    it('accepts a bare string message', () => {
      expect(
        isNativeBinaryMissingError('Claude Code native binary not found at x'),
      ).toBe(true);
    });

    it('does not match unrelated errors', () => {
      expect(isNativeBinaryMissingError(new Error('API Error: 429'))).toBe(
        false,
      );
      expect(
        isNativeBinaryMissingError(new Error('ENOENT: no such file, open')),
      ).toBe(false);
      expect(isNativeBinaryMissingError(undefined)).toBe(false);
      expect(isNativeBinaryMissingError(null)).toBe(false);
    });
  });

  describe('formatNativeBinaryMissingMessage', () => {
    it('produces an actionable message naming the platform and all three fixes', () => {
      const msg = formatNativeBinaryMissingMessage('linux-x64-musl');
      expect(msg).toContain('native binary for your platform (linux-x64-musl)');
      expect(msg).toContain(
        '@anthropic-ai/claude-agent-sdk optional dependency',
      );
      // Cross-libc install is the most common cause — call it out.
      expect(msg).toContain('different OS or libc');
      // All three remediation paths the requester specified.
      expect(msg).toContain('Reinstall dependencies in this environment');
      expect(msg).toContain('pnpm.supportedArchitectures');
      expect(msg).toContain('options.pathToClaudeCodeExecutable');
    });

    it('defaults to the detected current platform', () => {
      const msg = formatNativeBinaryMissingMessage();
      expect(msg).toContain(describeCurrentPlatform());
    });
  });

  describe('describeCurrentPlatform', () => {
    it('reports <os>-<arch> and appends libc on linux', () => {
      const label = describeCurrentPlatform();
      expect(label).toContain(`${process.platform}-${process.arch}`);
      if (process.platform === 'linux') {
        expect(label).toMatch(/-(glibc|musl)$/);
      }
    });
  });
});
