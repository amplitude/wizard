import { describe, it, expect } from 'vitest';

import {
  DISALLOWED_BUILTIN_TOOLS,
  buildDisallowedBuiltinTools,
} from '../agent-interface';

describe('buildDisallowedBuiltinTools', () => {
  it('returns the canonical list of unused built-ins by default', () => {
    const result = buildDisallowedBuiltinTools({});
    expect(result).toEqual([...DISALLOWED_BUILTIN_TOOLS]);
  });

  it('includes the tools the wizard never invokes', () => {
    const result = buildDisallowedBuiltinTools({});
    // Spot-check each category from DISALLOWED_BUILTIN_TOOLS to guard
    // against accidental deletion when someone refactors the constant.
    for (const expected of [
      'Task',
      'TaskOutput',
      'TaskStop',
      'CronCreate',
      'CronDelete',
      'CronList',
      'EnterWorktree',
      'ExitWorktree',
      'ScheduleWakeup',
      'EnterPlanMode',
      'ExitPlanMode',
      'AskUserQuestion',
      'NotebookEdit',
      'ReadMcpResourceTool',
    ]) {
      expect(result).toContain(expected);
    }
  });

  it('does NOT include tools the wizard actually uses', () => {
    const result = buildDisallowedBuiltinTools({});
    // Sanity check — these are wired into `allowedTools` in
    // `initializeAgent` and must never be disallowed.
    for (const used of [
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'Bash',
      'ListMcpResourcesTool',
      'Skill',
    ]) {
      expect(result).not.toContain(used);
    }
  });

  it('returns an empty list when AMPLITUDE_WIZARD_BUILTIN_TOOL_FILTER=full', () => {
    const result = buildDisallowedBuiltinTools({
      AMPLITUDE_WIZARD_BUILTIN_TOOL_FILTER: 'full',
    });
    expect(result).toEqual([]);
  });

  it('still applies the filter when env var is unset or empty', () => {
    expect(buildDisallowedBuiltinTools({})).toHaveLength(
      DISALLOWED_BUILTIN_TOOLS.length,
    );
    expect(
      buildDisallowedBuiltinTools({
        AMPLITUDE_WIZARD_BUILTIN_TOOL_FILTER: '',
      }),
    ).toHaveLength(DISALLOWED_BUILTIN_TOOLS.length);
  });

  it('ignores other values of AMPLITUDE_WIZARD_BUILTIN_TOOL_FILTER', () => {
    // Only the literal string `'full'` opts out — guard against typos
    // like `'true'` / `'1'` accidentally disabling the cap.
    for (const value of ['true', '1', 'partial', 'off', 'FULL']) {
      const result = buildDisallowedBuiltinTools({
        AMPLITUDE_WIZARD_BUILTIN_TOOL_FILTER: value,
      });
      expect(result).toHaveLength(DISALLOWED_BUILTIN_TOOLS.length);
    }
  });

  it('returns a fresh array each call (no shared mutable state)', () => {
    const a = buildDisallowedBuiltinTools({});
    const b = buildDisallowedBuiltinTools({});
    expect(a).not.toBe(b);
    a.push('Sentinel');
    expect(buildDisallowedBuiltinTools({})).not.toContain('Sentinel');
  });
});
