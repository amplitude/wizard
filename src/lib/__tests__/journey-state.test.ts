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

    // Cold-start visibility: the agent ramps up by reading skill /
    // project files BEFORE it ever calls detect_package_manager. The
    // first such Read / Grep / Glob flips Detect to in_progress so the
    // user sees "1 done · 3 to go" instead of "0 done · 4 to go" while
    // the agent is loading skills (1-3s window, sometimes longer on
    // cold network).
    it('flags first Read of a project file as detect in_progress', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Read',
          toolInput: { file_path: '/p/package.json' },
        }),
      ).toEqual({ stepId: 'detect', status: 'in_progress' });
    });

    it('flags first Grep as detect in_progress', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Grep',
          toolInput: { pattern: 'import' },
        }),
      ).toEqual({ stepId: 'detect', status: 'in_progress' });
    });

    it('flags first Glob as detect in_progress', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Glob',
          toolInput: { pattern: '**/*.ts' },
        }),
      ).toEqual({ stepId: 'detect', status: 'in_progress' });
    });

    it('does not re-flag detect when a second Read fires while still in_progress', () => {
      // Idempotent — the trigger fires only on the first qualifying
      // call; subsequent calls are no-ops so we don't churn the UI.
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Read',
          toolInput: { file_path: '/p/src/foo.ts' },
          prevDerived: { detect: 'in_progress' },
        }),
      ).toBeNull();
    });

    it('never demotes a completed detect step back to in_progress', () => {
      // Monotonic guard mirrors the store: a stale Read after detect
      // has been verified completed must NOT regress the step.
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Read',
          toolInput: { file_path: '/p/src/foo.ts' },
          prevDerived: { detect: 'completed' },
        }),
      ).toBeNull();
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'mcp__wizard-tools__detect_package_manager',
          toolInput: {},
          prevDerived: { detect: 'completed' },
        }),
      ).toBeNull();
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

    // Cold-start visibility: any package install during the wizard
    // run is "the agent is past detection, into dependency setup."
    // The previous heuristic required the literal `@amplitude/`
    // package, which lost feedback when the agent ran a generic
    // `pnpm install` to hydrate dependencies first.
    it('flags any package install verb as in_progress', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Bash',
          toolInput: { command: 'pnpm install' },
        }),
      ).toEqual({ stepId: 'install', status: 'in_progress' });
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Bash',
          toolInput: { command: 'npm i' },
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

    it('ignores Bash on PostToolUse (in_progress signal only)', () => {
      expect(
        classifyToolEvent({
          phase: 'post',
          toolName: 'Bash',
          toolInput: { command: 'pnpm add @amplitude/unified' },
        }),
      ).toBeNull();
    });

    it('does not re-flag install when a second install Bash fires while still in_progress', () => {
      // Idempotent — only the first install command transitions the
      // step; later installs (e.g. peer deps, devDependencies) are
      // no-ops so the UI doesn't churn.
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Bash',
          toolInput: { command: 'pnpm add @amplitude/unified' },
          prevDerived: { install: 'in_progress' },
        }),
      ).toBeNull();
    });

    it('never demotes a completed install step back to in_progress', () => {
      // The store cascades install→completed when plan / wire advance.
      // A stale install Bash replayed afterwards must not regress it.
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Bash',
          toolInput: { command: 'pnpm add @amplitude/unified' },
          prevDerived: { install: 'completed' },
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

    it('does not re-flag plan when a feedback re-loop fires confirm_event_plan again', () => {
      // The agent calls confirm_event_plan multiple times if the user
      // returns feedback. The first Pre flips plan to in_progress; the
      // second is a no-op so the UI stays put.
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'mcp__wizard-tools__confirm_event_plan',
          toolInput: {},
          prevDerived: { plan: 'in_progress' },
        }),
      ).toBeNull();
    });

    it('never demotes a completed plan step back to in_progress', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'mcp__wizard-tools__confirm_event_plan',
          toolInput: {},
          prevDerived: { plan: 'completed' },
        }),
      ).toBeNull();
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

    it('ignores Edits to amplitude-setup-report.md (wizard-managed)', () => {
      // The post-run setup report is written by the wizard itself,
      // not by the agent's instrumentation work. Editing it must NOT
      // flip wire to in_progress.
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Write',
          toolInput: { file_path: '/p/amplitude-setup-report.md' },
          prevDerived: { plan: 'completed' },
        }),
      ).toBeNull();
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Edit',
          toolInput: { file_path: '/p/amplitude-setup-report.previous.md' },
          prevDerived: { plan: 'completed' },
        }),
      ).toBeNull();
    });

    it('ignores Edits inside the .amplitude project metadata directory', () => {
      // .amplitude/events.json, .amplitude/dashboard.json, etc. are
      // wizard bookkeeping and don't represent user-facing wiring.
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Write',
          toolInput: { file_path: '/p/.amplitude/events.json' },
          prevDerived: { plan: 'completed' },
        }),
      ).toBeNull();
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Write',
          toolInput: { file_path: '/p/.amplitude/dashboard.json' },
          prevDerived: { plan: 'completed' },
        }),
      ).toBeNull();
    });

    it('does not re-flag wire when a second Edit fires while still in_progress', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Edit',
          toolInput: { file_path: '/p/src/bar.ts' },
          prevDerived: { plan: 'completed', wire: 'in_progress' },
        }),
      ).toBeNull();
    });

    it('never demotes a completed wire step back to in_progress', () => {
      // The agent-runner post-loop flips wire to completed once the
      // stream ends and events.json is on disk. A stale Edit replayed
      // afterwards must not regress the step.
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Edit',
          toolInput: { file_path: '/p/src/bar.ts' },
          prevDerived: { plan: 'completed', wire: 'completed' },
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
      // Once detect is already in_progress (or completed) the
      // ramp-up Read / Grep signal is suppressed — these tools then
      // become genuinely unrelated to the journey.
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Read',
          toolInput: { file_path: '/p/package.json' },
          prevDerived: { detect: 'completed' },
        }),
      ).toBeNull();
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Grep',
          toolInput: { pattern: 'foo' },
          prevDerived: { detect: 'completed' },
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
