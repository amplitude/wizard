import { describe, it, expect } from 'vitest';
import { resolveMode } from '../mode-config.js';

describe('resolveMode', () => {
  describe('mode selection', () => {
    it('returns interactive mode when TTY and no auto-approve flags', () => {
      const result = resolveMode({ isTTY: true });
      expect(result.mode).toBe('interactive');
    });

    it('returns agent mode when --agent is set', () => {
      const result = resolveMode({ agent: true, isTTY: true });
      expect(result.mode).toBe('agent');
    });

    it('returns ci mode when --ci is set', () => {
      const result = resolveMode({ ci: true, isTTY: true });
      expect(result.mode).toBe('ci');
    });

    it('returns ci mode when --yes is set', () => {
      const result = resolveMode({ yes: true, isTTY: true });
      expect(result.mode).toBe('ci');
    });

    it('falls back to ci when not TTY and not agent', () => {
      const result = resolveMode({ isTTY: false });
      expect(result.mode).toBe('ci');
    });
  });

  describe('autoApprove', () => {
    it('is true in agent mode', () => {
      expect(resolveMode({ agent: true, isTTY: true }).autoApprove).toBe(true);
    });

    it('is true in ci mode', () => {
      expect(resolveMode({ ci: true, isTTY: true }).autoApprove).toBe(true);
    });

    it('is false in interactive mode', () => {
      expect(resolveMode({ isTTY: true }).autoApprove).toBe(false);
    });
  });

  describe('jsonOutput — the --json / --human / --agent decoupling', () => {
    it('is true in agent mode', () => {
      expect(resolveMode({ agent: true, isTTY: true }).jsonOutput).toBe(true);
    });

    it('is true with --json even when TTY and not agent', () => {
      expect(resolveMode({ json: true, isTTY: true }).jsonOutput).toBe(true);
    });

    it('does NOT enable autoApprove when only --json is set (decoupled from --agent)', () => {
      const result = resolveMode({ json: true, isTTY: true });
      expect(result.jsonOutput).toBe(true);
      expect(result.autoApprove).toBe(false);
      expect(result.mode).toBe('interactive');
    });

    it('is true when piped (non-TTY) with no explicit flags', () => {
      expect(resolveMode({ isTTY: false }).jsonOutput).toBe(true);
    });

    it('is false with --human even when piped', () => {
      expect(resolveMode({ human: true, isTTY: false }).jsonOutput).toBe(false);
    });

    it('is false with --human even with --agent', () => {
      expect(
        resolveMode({ human: true, agent: true, isTTY: false }).jsonOutput,
      ).toBe(false);
    });

    it('is false with --human even with --json', () => {
      expect(
        resolveMode({ human: true, json: true, isTTY: true }).jsonOutput,
      ).toBe(false);
    });

    it('is false by default in interactive TTY', () => {
      expect(resolveMode({ isTTY: true }).jsonOutput).toBe(false);
    });
  });

  describe('quiet', () => {
    it('is true when not TTY', () => {
      expect(resolveMode({ isTTY: false }).quiet).toBe(true);
    });

    it('is false when TTY', () => {
      expect(resolveMode({ isTTY: true }).quiet).toBe(false);
    });
  });
});
