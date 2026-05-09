/**
 * mode-badge — env-resolution tests.
 */
import { describe, it, expect } from 'vitest';
import { resolveMode } from '../mode-badge.js';

describe('resolveMode', () => {
  it('returns interactive when no flags are set', () => {
    const m = resolveMode({});
    expect(m.key).toBe('interactive');
    expect(m.label).toBe('interactive');
  });

  it('detects nested-agent via CLAUDECODE', () => {
    const m = resolveMode({ CLAUDECODE: '1' });
    expect(m.key).toBe('nested-agent');
  });

  it('detects nested-agent via CLAUDE_CODE_ENTRYPOINT', () => {
    const m = resolveMode({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' });
    expect(m.key).toBe('nested-agent');
  });

  it('detects --agent mode', () => {
    const m = resolveMode({ AMPLITUDE_WIZARD_AGENT_MODE: '1' });
    expect(m.key).toBe('agent');
  });

  it('detects --ci mode (AMPLITUDE_WIZARD_CI)', () => {
    const m = resolveMode({ AMPLITUDE_WIZARD_CI: '1' });
    expect(m.key).toBe('ci');
  });

  it('detects --ci mode (CI=true)', () => {
    const m = resolveMode({ CI: 'true' });
    expect(m.key).toBe('ci');
  });

  it('detects mcp-server mode', () => {
    const m = resolveMode({ AMPLITUDE_WIZARD_MCP_SERVE: '1' });
    expect(m.key).toBe('mcp-server');
  });

  it('priorities: nested-agent beats agent / ci / mcp-server', () => {
    const m = resolveMode({
      CLAUDECODE: '1',
      AMPLITUDE_WIZARD_AGENT_MODE: '1',
      CI: 'true',
      AMPLITUDE_WIZARD_MCP_SERVE: '1',
    });
    expect(m.key).toBe('nested-agent');
  });

  it('priorities: bypassing nested suppresses the badge', () => {
    const m = resolveMode({
      CLAUDECODE: '1',
      AMPLITUDE_WIZARD_ALLOW_NESTED: '1',
      AMPLITUDE_WIZARD_AGENT_MODE: '1',
    });
    // Suppressing nested falls through to the next signal.
    expect(m.key).toBe('agent');
  });
});
