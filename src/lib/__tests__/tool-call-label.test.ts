/**
 * Unit tests for the tool-call-label transformer — pin the verb-form
 * mapping that powers the Tasks-list substep narration so a future
 * refactor doesn't accidentally regress "Reading foo.tsx" back to
 * "Read foo.tsx".
 */

import { describe, it, expect } from 'vitest';
import { formatToolCallLabel } from '../tool-call-label.js';

describe('formatToolCallLabel — verb-form transforms', () => {
  it('Read → "Reading <path>"', () => {
    expect(formatToolCallLabel({ toolName: 'Read', summary: 'foo.tsx' })).toBe(
      'Reading foo.tsx',
    );
  });

  it('Edit → "Editing <path>"', () => {
    expect(
      formatToolCallLabel({ toolName: 'Edit', summary: 'src/app/page.tsx' }),
    ).toBe('Editing src/app/page.tsx');
  });

  it('MultiEdit → "Editing <path>" (same as Edit)', () => {
    expect(
      formatToolCallLabel({ toolName: 'MultiEdit', summary: 'app.ts' }),
    ).toBe('Editing app.ts');
  });

  it('Write → "Writing <path>"', () => {
    expect(
      formatToolCallLabel({ toolName: 'Write', summary: 'src/events.ts' }),
    ).toBe('Writing src/events.ts');
  });

  it('Bash → "Running <command>" with truncation past 50 chars', () => {
    const long =
      'pnpm add @amplitude/analytics-browser @amplitude/analytics-react';
    const out = formatToolCallLabel({ toolName: 'Bash', summary: long });
    expect(out).toMatch(/^Running pnpm add /);
    // The Bash branch truncates the command head to 50 chars (with an
    // ellipsis); the outer label cap is 80 — this falls below.
    expect(out!.length).toBeLessThanOrEqual(80);
  });

  it('Grep → "Searching for <pattern>"', () => {
    expect(formatToolCallLabel({ toolName: 'Grep', summary: 'track\\(' })).toBe(
      'Searching for track\\(',
    );
  });

  it('Glob → "Finding <pattern>"', () => {
    expect(formatToolCallLabel({ toolName: 'Glob', summary: '**/*.ts' })).toBe(
      'Finding **/*.ts',
    );
  });
});

describe('formatToolCallLabel — MCP tool routing', () => {
  it('Amplitude MCP tool → "Calling Amplitude <bare>"', () => {
    expect(
      formatToolCallLabel({
        toolName: 'mcp__amplitude__create_chart',
        summary: '{"name":"Daily Active Users"}',
      }),
    ).toBe('Calling Amplitude create_chart');
  });

  it('wizard-tools MCP is suppressed (plumbing, not progress)', () => {
    expect(
      formatToolCallLabel({
        toolName: 'mcp__wizard-tools__check_env_keys',
        summary: '',
      }),
    ).toBeNull();
  });

  it('Other MCP servers fall through to "Calling <bare>"', () => {
    expect(
      formatToolCallLabel({
        toolName: 'mcp__custom__do_thing',
        summary: '{}',
      }),
    ).toBe('Calling do_thing');
  });
});

describe('formatToolCallLabel — skipped / fallback paths', () => {
  it('TodoWrite is suppressed — already drives the task list itself', () => {
    expect(
      formatToolCallLabel({ toolName: 'TodoWrite', summary: '5 todo(s)' }),
    ).toBeNull();
  });

  it('Task (sub-agent dispatch) is suppressed', () => {
    expect(
      formatToolCallLabel({ toolName: 'Task', summary: 'Investigate auth' }),
    ).toBeNull();
  });

  it('Unknown tool with no summary returns null', () => {
    expect(formatToolCallLabel({ toolName: 'MysteryTool' })).toBeNull();
  });

  it('Unknown tool with summary renders generically', () => {
    expect(
      formatToolCallLabel({
        toolName: 'MysteryTool',
        summary: 'doing something',
      }),
    ).toBe('MysteryTool: doing something');
  });

  it('Read with no summary falls back to generic label', () => {
    expect(formatToolCallLabel({ toolName: 'Read' })).toBe('Reading file');
  });

  it('Bash with no summary falls back to generic label', () => {
    expect(formatToolCallLabel({ toolName: 'Bash' })).toBe('Running command');
  });
});

describe('formatToolCallLabel — path relativization', () => {
  it('relativizes absolute paths under installDir for short labels', () => {
    expect(
      formatToolCallLabel({
        toolName: 'Read',
        summary: '/Users/me/project/src/index.ts',
        installDir: '/Users/me/project',
      }),
    ).toBe('Reading src/index.ts');
  });

  it('falls back to basename when path is outside installDir and very long', () => {
    // Path is absolute, > 40 chars, and not under installDir → basename.
    const out = formatToolCallLabel({
      toolName: 'Read',
      summary: '/some/other/very/long/absolute/path/to/foo.ts',
      installDir: '/Users/me/project',
    });
    expect(out).toBe('Reading foo.ts');
  });
});
