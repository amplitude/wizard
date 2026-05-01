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

    it('does not flag Edit once dashboard has started', () => {
      // Once the agent moves to dashboard creation, further file edits
      // are no longer "wire up event tracking" work.
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'Edit',
          toolInput: { file_path: '/p/src/foo.ts' },
          prevDerived: { plan: 'completed', dashboard: 'in_progress' },
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

    it('flags write-tool Post as wire completed after wire was in_progress', () => {
      expect(
        classifyToolEvent({
          phase: 'post',
          toolName: 'Edit',
          toolInput: { file_path: '/p/src/foo.ts' },
          prevDerived: { plan: 'completed', wire: 'in_progress' },
        }),
      ).toEqual({ stepId: 'wire', status: 'completed' });
    });
  });

  describe('dashboard', () => {
    it('flags record_dashboard Pre as dashboard in_progress', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'mcp__wizard-tools__record_dashboard',
          toolInput: { dashboardUrl: 'https://app.amplitude.com/...' },
        }),
      ).toEqual({ stepId: 'dashboard', status: 'in_progress' });
    });

    it('flags record_dashboard Post as dashboard completed', () => {
      expect(
        classifyToolEvent({
          phase: 'post',
          toolName: 'mcp__wizard-tools__record_dashboard',
          toolInput: { dashboardUrl: 'https://app.amplitude.com/...' },
          toolResult: { ok: true },
        }),
      ).toEqual({ stepId: 'dashboard', status: 'completed' });
    });

    it('does not flag Amplitude MCP chart/dashboard writes for journey status', () => {
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'mcp__amplitude__create_chart',
          toolInput: { title: 'Funnel' },
        }),
      ).toBeNull();
      expect(
        classifyToolEvent({
          phase: 'pre',
          toolName: 'mcp__amplitude__create_dashboard',
          toolInput: {},
        }),
      ).toBeNull();
    });

    it('ignores read-only Amplitude MCP probes', () => {
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
