import { describe, it, expect } from 'vitest';
import { classifyToolEvent } from '../journey-state';

describe('classifyToolEvent', () => {
  describe('detect', () => {
    it('flags detect_package_manager Pre as in_progress', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'mcp__wizard-tools__detect_package_manager',
          toolInput: {},
        }),
      ).toEqual({ stepId: 'detect', status: 'in_progress' });
    });

    it('flags detect_package_manager Post as completed', () => {
      expect(
        classifyToolEvent({
          phase: 'post',
          toolName: 'mcp__wizard-tools__detect_package_manager',
          toolInput: {},
          toolResult: { manager: 'pnpm' },
        }),
      ).toEqual({ stepId: 'detect', status: 'completed' });
    });

    it('tolerates the legacy amplitude-wizard server prefix', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'mcp__amplitude-wizard__detect_package_manager',
          toolInput: {},
        }),
      ).toEqual({ stepId: 'detect', status: 'in_progress' });
    });
  });

  describe('install', () => {
    it.each([
      ['pnpm add', 'pnpm add @amplitude/unified'],
      ['npm install', 'npm install @amplitude/analytics-browser'],
      ['yarn add', 'yarn add @amplitude/analytics-node'],
      ['bun add', 'bun add @amplitude/analytics-react-native'],
      ['pip install', 'pip install amplitude-analytics'],
      ['poetry add', 'poetry add amplitude'],
    ])('flags %s of an Amplitude package as in_progress', (_label, command) => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Bash',
          toolInput: { command },
        }),
      ).toEqual({ stepId: 'install', status: 'in_progress' });
    });

    it('ignores Bash commands that mention amplitude in passing', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Bash',
          toolInput: { command: 'echo "configuring amplitude"' },
        }),
      ).toBeNull();
    });

    it('ignores non-Amplitude installs', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Bash',
          toolInput: { command: 'pnpm add react' },
        }),
      ).toBeNull();
    });

    it('ignores Bash on PostToolUse (in_progress signal only)', () => {
      expect(
        classifyToolEvent({
          phase: 'post',
          toolName: 'Bash',
          toolInput: { command: 'pnpm add @amplitude/unified' },
        }),
      ).toBeNull();
    });
  });

  describe('plan', () => {
    it('flags confirm_event_plan Pre as in_progress', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'mcp__wizard-tools__confirm_event_plan',
          toolInput: {},
        }),
      ).toEqual({ stepId: 'plan', status: 'in_progress' });
    });

    it('flags confirm_event_plan Post as completed regardless of approval', () => {
      // The plan step finishes when the agent's confirmation call returns —
      // the user's verdict on the plan itself is orthogonal to whether the
      // step is "done".
      expect(
        classifyToolEvent({
          phase: 'post',
          toolName: 'mcp__wizard-tools__confirm_event_plan',
          toolInput: {},
          toolResult: { decision: 'rejected' },
        }),
      ).toEqual({ stepId: 'plan', status: 'completed' });
    });
  });

  describe('wire', () => {
    it('flags first Edit after plan completes as wire in_progress', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Edit',
          toolInput: { file_path: '/p/src/foo.ts' },
          prevDerived: { plan: 'completed' },
        }),
      ).toEqual({ stepId: 'wire', status: 'in_progress' });
    });

    it('does not flag Edit before plan has completed', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Edit',
          toolInput: { file_path: '/p/src/foo.ts' },
          prevDerived: { plan: 'in_progress' },
        }),
      ).toBeNull();
    });

    it('handles MultiEdit / Write / NotebookEdit identically to Edit', () => {
      for (const toolName of ['Write', 'MultiEdit', 'NotebookEdit']) {
        expect(
          classifyToolEvent({
            phase: 'pre',
            toolName,
            toolInput: { file_path: '/p/src/foo.ts' },
            prevDerived: { plan: 'completed' },
          }),
        ).toEqual({ stepId: 'wire', status: 'in_progress' });
      }
    });

    it('does not complete wire on write-tool Post — wiring spans many files', () => {
      expect(
        classifyToolEvent({
          phase: 'post',
          toolName: 'Edit',
          toolInput: { file_path: '/p/src/foo.ts' },
          prevDerived: { plan: 'completed', wire: 'in_progress' },
        }),
      ).toBeNull();
    });
  });

  // ── DEFER_DASHBOARD_PLAN PR 4 regression guard ──────────────────────────
  // The dashboard step (formerly step 5) is gone — chart and dashboard work
  // moved to the deferred `amplitude-wizard dashboard` command. The
  // classifier must NOT emit a 'dashboard' transition for any tool call.
  // None of the chart-building Amplitude MCP tools nor the legacy
  // `record_dashboard` wizard-tools call should advance the journey.
  describe('dashboard step is no longer recognized (deferred to wizard dashboard command)', () => {
    it.each([
      'create_chart',
      'create_dashboard',
      'update_chart',
      'update_dashboard',
      'add_chart_to_dashboard',
      'attach_chart_to_dashboard',
      'query_dataset',
      'save_chart_edits',
      'get_chart_definition_params',
      'verify_chart_definition',
    ])(
      'returns null for Amplitude MCP %s (was dashboard in_progress pre-PR4)',
      (bare) => {
        expect(
          classifyToolEvent({
            phase: 'pre',
            toolName: `mcp__amplitude__${bare}`,
            toolInput: {},
            prevDerived: { plan: 'completed', wire: 'in_progress' },
          }),
        ).toBeNull();
      },
    );

    it('returns null for record_dashboard Pre / Post (was dashboard transitions pre-PR4)', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'mcp__wizard-tools__record_dashboard',
          toolInput: { dashboardUrl: 'https://app.amplitude.com/...' },
        }),
      ).toBeNull();
      expect(
        classifyToolEvent({
          phase: 'post',
          toolName: 'mcp__wizard-tools__record_dashboard',
          toolInput: { dashboardUrl: 'https://app.amplitude.com/...' },
          toolResult: { ok: true },
        }),
      ).toBeNull();
    });

    it('keeps wire in_progress across an unexpected Amplitude MCP probe (no dashboard guard)', () => {
      // Pre-PR4 this Edit would have been suppressed because dashboard
      // was already in_progress. Now wire is the terminal step, so an
      // edit after plan should still flip wire to in_progress regardless
      // of any stray Amplitude MCP probe.
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Edit',
          toolInput: { file_path: '/p/src/foo.ts' },
          prevDerived: { plan: 'completed' },
        }),
      ).toEqual({ stepId: 'wire', status: 'in_progress' });
    });

    it('ignores read-only Amplitude MCP probes', () => {
      // list_*, search_*, get_* are agent browsing — never load-bearing.
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'mcp__amplitude__list_charts',
          toolInput: {},
        }),
      ).toBeNull();
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'mcp__amplitude__search_events',
          toolInput: {},
        }),
      ).toBeNull();
    });
  });

  describe('irrelevant tools', () => {
    it('returns null for unrelated tool calls', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Read',
          toolInput: { file_path: '/p/package.json' },
        }),
      ).toBeNull();
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Grep',
          toolInput: { pattern: 'foo' },
        }),
      ).toBeNull();
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'mcp__wizard-tools__check_env_keys',
          toolInput: {},
        }),
      ).toBeNull();
    });

    it('returns null for malformed input shapes', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Bash',
          toolInput: null,
        }),
      ).toBeNull();
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: '',
          toolInput: {},
        }),
      ).toBeNull();
    });
  });
});
