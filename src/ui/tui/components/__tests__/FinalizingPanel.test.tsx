/**
 * FinalizingPanel — visible queue of post-agent steps under the agent's
 * task list. Verifies the four status states render distinctly so the
 * user can tell pending/in-progress/completed/skipped apart at a glance,
 * and that skip reasons surface inline.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { FinalizingPanel } from '../FinalizingPanel.js';
import type { PostAgentStep } from '../../../../lib/wizard-session.js';

// Strip ANSI for assertions — color is tested elsewhere; here we want
// stable text.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const frameOf = (node: React.ReactElement): string => {
  const { lastFrame, unmount } = render(node);
  const out = (lastFrame() ?? '').replace(ANSI, '');
  unmount();
  return out;
};

const baseStep = (overrides: Partial<PostAgentStep>): PostAgentStep => ({
  id: 'step-id',
  label: 'A step',
  activeForm: 'Doing a step',
  status: 'pending',
  ...overrides,
});

describe('FinalizingPanel', () => {
  it('renders nothing when the queue is empty', () => {
    const out = frameOf(<FinalizingPanel steps={[]} />);
    expect(out).toBe('');
  });

  it('shows the activeForm while a step is in progress', () => {
    const out = frameOf(
      <FinalizingPanel
        steps={[
          baseStep({
            id: 'commit-events',
            label: 'Saved your event plan',
            activeForm: 'Saving your event plan',
            status: 'in_progress',
            startedAt: Date.now(),
          }),
        ]}
      />,
    );
    expect(out).toContain('Saving your event plan');
    // The completed-state label must NOT also appear during in_progress.
    expect(out).not.toContain('Saved your event plan');
  });

  it('shows the static label for completed and pending steps', () => {
    const out = frameOf(
      <FinalizingPanel
        steps={[
          baseStep({
            id: 'commit-events',
            label: 'Saved your event plan',
            status: 'completed',
          }),
          baseStep({
            id: 'create-dashboard',
            label: 'Create your starter dashboard',
            status: 'pending',
          }),
        ]}
      />,
    );
    expect(out).toContain('Saved your event plan');
    expect(out).toContain('Create your starter dashboard');
  });

  it('surfaces the skip reason inline so the user knows what happened', () => {
    const out = frameOf(
      <FinalizingPanel
        steps={[
          baseStep({
            id: 'commit-events',
            label: 'Save your event plan',
            status: 'skipped',
            reason: "couldn't resolve project",
          }),
        ]}
      />,
    );
    expect(out).toContain('Save your event plan');
    expect(out).toContain("couldn't resolve project");
  });

  it('renders a header so the panel is visually separated from the agent task list', () => {
    const out = frameOf(
      <FinalizingPanel
        steps={[
          baseStep({
            id: 'commit-events',
            status: 'in_progress',
            startedAt: Date.now(),
          }),
        ]}
      />,
    );
    expect(out).toContain('Finalizing in Amplitude');
  });
});
