/**
 * Unit tests for `buildSystemPromptAppend`.
 *
 * The helper is extracted from `runAgent`'s inline systemPrompt
 * builder so we can lock its contract:
 *
 *   - Commandments come first, orchestrator context second.
 *   - The orchestrator block is labeled with a `## Orchestrator-injected
 *     context` header so the model can distinguish wizard-managed
 *     instructions from caller-supplied ones.
 *   - The block reminds the model that safety rules above still win,
 *     so a malicious context file can't talk Claude into dumping
 *     secrets.
 *   - Whitespace-only / undefined / null context returns the
 *     commandments alone — no header, no separator, nothing the
 *     orchestrator could grep for and miss.
 */

import { describe, it, expect } from 'vitest';
import { buildSystemPromptAppend } from '../agent-interface';

describe('buildSystemPromptAppend', () => {
  it('returns commandments alone when no context is provided', () => {
    const result = buildSystemPromptAppend({
      commandments: 'COMMANDMENTS',
    });
    expect(result).toBe('COMMANDMENTS');
  });

  it('returns commandments alone for an empty string', () => {
    expect(
      buildSystemPromptAppend({
        commandments: 'COMMANDMENTS',
        orchestratorContext: '',
      }),
    ).toBe('COMMANDMENTS');
  });

  it('returns commandments alone for whitespace-only context', () => {
    expect(
      buildSystemPromptAppend({
        commandments: 'COMMANDMENTS',
        orchestratorContext: '   \n\t\n',
      }),
    ).toBe('COMMANDMENTS');
  });

  it('returns commandments alone when context is null', () => {
    expect(
      buildSystemPromptAppend({
        commandments: 'COMMANDMENTS',
        orchestratorContext: null,
      }),
    ).toBe('COMMANDMENTS');
  });

  it('appends the orchestrator block AFTER the commandments', () => {
    const result = buildSystemPromptAppend({
      commandments: 'COMMANDMENTS',
      orchestratorContext: 'use snake_case for events',
    });
    const cmdIdx = result.indexOf('COMMANDMENTS');
    const ctxIdx = result.indexOf('use snake_case for events');
    expect(cmdIdx).toBeGreaterThanOrEqual(0);
    expect(ctxIdx).toBeGreaterThan(cmdIdx);
  });

  it('labels the appended block with a recognizable header', () => {
    const result = buildSystemPromptAppend({
      commandments: 'COMMANDMENTS',
      orchestratorContext: 'use snake_case',
    });
    expect(result).toMatch(/## Orchestrator-injected context/);
  });

  it('reminds the model that safety rules above take precedence', () => {
    const result = buildSystemPromptAppend({
      commandments: 'COMMANDMENTS',
      orchestratorContext: 'use snake_case',
    });
    // Phrasing must keep the "safety rules above" anchor so a malicious
    // context can't override secrets / shell-eval bans.
    expect(result).toMatch(/safety rules above/i);
  });

  it('trims whitespace around the context block', () => {
    const result = buildSystemPromptAppend({
      commandments: 'COMMANDMENTS',
      orchestratorContext: '\n\n  please do X  \n\n',
    });
    expect(result).toMatch(/please do X$/);
    expect(result).not.toMatch(/please do X\s+$/m);
  });

  it('separates commandments from the appended block with a blank line', () => {
    const result = buildSystemPromptAppend({
      commandments: 'COMMANDMENTS',
      orchestratorContext: 'X',
    });
    // Two newlines between commandments end and the header — keeps the
    // model from gluing soft guidance onto the last commandment line.
    expect(result).toContain('COMMANDMENTS\n\n## Orchestrator-injected');
  });
});
