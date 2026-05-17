/**
 * ActiveTaskSubsteps — verify the rolling tool-call narration renders
 * correctly under the active task in RunScreen.
 *
 * Coverage:
 *   - up to 3 substep rows render
 *   - buffer evicts old rows (cap renders only the trailing N)
 *   - the trailing in-progress row shows ▸ + accent; older rows ✓ + dim
 *   - empty buffer renders nothing
 *   - narrow terminal (< 60 cols) hides the panel
 *   - WizardStore.recordToolActivity FIFO eviction at MAX_TOOL_ACTIVITIES
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import {
  ActiveTaskSubsteps,
  DEFAULT_MAX_SUBSTEPS,
} from '../ActiveTaskSubsteps.js';
import { WizardStore } from '../../store.js';
import type { ToolActivity } from '../../store.js';
import { stripAnsi } from '../../__tests__/helpers/strip-ansi.js';
import { frameOf } from '../../__tests__/helpers/render-frame.js';

function activity(label: string, status: ToolActivity['status']): ToolActivity {
  return { label, startedAt: Date.now(), status };
}

describe('ActiveTaskSubsteps — rendering', () => {
  it('renders up to 3 substep rows with the trailing one as in-progress', () => {
    const activities: ToolActivity[] = [
      activity('Reading package.json', 'completed'),
      activity('Resolved @amplitude/analytics-browser', 'completed'),
      activity('Running pnpm add @amplitude/analytics-browser', 'in_progress'),
    ];
    const frame = frameOf(
      <ActiveTaskSubsteps activities={activities} width={120} />,
    );

    expect(frame).toContain('Reading package.json');
    expect(frame).toContain('Resolved @amplitude/analytics-browser');
    expect(frame).toContain('Running pnpm add @amplitude/analytics-browser');
  });

  it('evicts oldest rows when buffer exceeds maxVisible (FIFO)', () => {
    const activities: ToolActivity[] = [
      activity('Reading file 1', 'completed'),
      activity('Reading file 2', 'completed'),
      activity('Reading file 3', 'completed'),
      activity('Reading file 4', 'completed'),
      activity('Reading file 5', 'in_progress'),
    ];
    const frame = frameOf(
      <ActiveTaskSubsteps activities={activities} width={120} />,
    );

    // Default cap is 3 — only the trailing 3 should render.
    expect(frame).not.toContain('Reading file 1');
    expect(frame).not.toContain('Reading file 2');
    expect(frame).toContain('Reading file 3');
    expect(frame).toContain('Reading file 4');
    expect(frame).toContain('Reading file 5');
  });

  it('respects custom maxVisible cap', () => {
    const activities: ToolActivity[] = [
      activity('Step 1', 'completed'),
      activity('Step 2', 'completed'),
      activity('Step 3', 'in_progress'),
    ];
    const frame = frameOf(
      <ActiveTaskSubsteps activities={activities} width={120} maxVisible={2} />,
    );

    expect(frame).not.toContain('Step 1');
    expect(frame).toContain('Step 2');
    expect(frame).toContain('Step 3');
  });

  it('returns null for empty activity buffer (no churn before tools fire)', () => {
    const frame = frameOf(<ActiveTaskSubsteps activities={[]} width={120} />);
    expect(frame.trim()).toBe('');
  });

  it('hides panel on narrow terminals (< 60 cols) to save space', () => {
    const activities: ToolActivity[] = [
      activity('Reading package.json', 'in_progress'),
    ];
    const frame = frameOf(
      <ActiveTaskSubsteps activities={activities} width={40} />,
    );
    expect(frame).not.toContain('Reading package.json');
  });

  it('uses ▸ glyph for the active (trailing) row and ✓ for prior rows', () => {
    const activities: ToolActivity[] = [
      activity('Reading package.json', 'completed'),
      activity('Running pnpm add', 'in_progress'),
    ];
    const frame = frameOf(
      <ActiveTaskSubsteps activities={activities} width={120} />,
    );
    // ▸ should appear next to the active row, ✓ next to the older one.
    expect(frame).toContain('▸');
    expect(frame).toContain('✓');
    // The older row's ✓ should appear before the ▸ on the active row in
    // top-to-bottom order.
    expect(frame.indexOf('✓')).toBeLessThan(frame.indexOf('▸'));
  });

  it('exposes DEFAULT_MAX_SUBSTEPS at 3 (pinned UX)', () => {
    expect(DEFAULT_MAX_SUBSTEPS).toBe(3);
  });

  it('renders substep rows tight (no blank line between rows)', () => {
    // Regression: Ink/Yoga gives a row 2 lines of vertical space when a
    // child has flexGrow={1} + truncated text, which produced a blank row
    // between every substep. We pin each row at height={1}; this test
    // guards against the spacing regression returning.
    const activities: ToolActivity[] = [
      activity('Reading App.tsx', 'completed'),
      activity('Reading index.tsx', 'completed'),
      activity('Editing index.tsx', 'in_progress'),
    ];
    const { lastFrame, unmount } = render(
      <ActiveTaskSubsteps activities={activities} width={120} />,
    );
    const stripped = stripAnsi(lastFrame() ?? '');
    const lines = stripped.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Reading App.tsx');
    expect(lines[1]).toContain('Reading index.tsx');
    expect(lines[2]).toContain('Editing index.tsx');
    // No blank rows between substeps.
    const between = stripped.split('\n').slice(0, 5);
    expect(between[0]).toContain('Reading App.tsx');
    expect(between[1]).toContain('Reading index.tsx');
    expect(between[2]).toContain('Editing index.tsx');
    unmount();
  });
});

describe('WizardStore.recordToolActivity — buffer behavior', () => {
  it('appends activities and marks prior in-progress as completed', () => {
    const store = new WizardStore();
    store.recordToolActivity('Reading package.json');
    store.recordToolActivity('Running pnpm add @amplitude/analytics-browser');

    const buf = store.toolActivities;
    expect(buf).toHaveLength(2);
    expect(buf[0].status).toBe('completed');
    expect(buf[0].label).toBe('Reading package.json');
    expect(buf[1].status).toBe('in_progress');
    expect(buf[1].label).toBe(
      'Running pnpm add @amplitude/analytics-browser',
    );
  });

  it('evicts oldest entries when buffer exceeds MAX_TOOL_ACTIVITIES', () => {
    const store = new WizardStore();
    for (let i = 0; i < WizardStore.MAX_TOOL_ACTIVITIES + 3; i++) {
      store.recordToolActivity(`Activity ${i}`);
    }
    expect(store.toolActivities).toHaveLength(WizardStore.MAX_TOOL_ACTIVITIES);
    // Oldest entries dropped — first remaining entry should be index 3
    // (we appended MAX_TOOL_ACTIVITIES + 3, kept the trailing N).
    expect(store.toolActivities[0].label).toBe('Activity 3');
  });
});
