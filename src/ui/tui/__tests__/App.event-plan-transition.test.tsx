/**
 * App — event-plan transition rendering.
 *
 * Regression coverage for the "event-plan prompt doesn't render until the
 * user resizes the terminal" bug, plus the inverse — "after pressing Y,
 * the prompt doesn't go away until another resize".
 *
 * Root cause was a tree-shape change at the App's React root: the
 * conditional returned a different sibling structure when `pendingPrompt`
 * was an event-plan vs. when it wasn't. Ink's log-update reconciler does
 * not reliably clear stale frame content when the root tree shape
 * changes between renders — terminal resize forces a clear-and-repaint
 * which masked the issue.
 *
 * The fix unifies App.tsx around a single stable outer tree: the
 * conditional now sibling-replaces ONE child of the same outer Box, and
 * each branch carries a stable `key` so React unmounts the previous
 * subtree cleanly. That makes the next frame flush deterministic.
 *
 * These tests pin that contract so a future refactor can't silently
 * reintroduce the tree-shape change.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';

import { App } from '../App.js';
import { WizardStore } from '../store.js';
import { Flow } from '../flows.js';

const samplePlan = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Sample Event ${i + 1}`,
    description: `Test description ${i + 1}.`,
  }));

const flushFrames = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('App — event-plan transition', () => {
  it('does not show the event-plan title before promptEventPlan is called', async () => {
    const store = new WizardStore(Flow.Wizard);
    const { lastFrame, unmount } = render(<App store={store} />);
    await flushFrames();
    const frame = lastFrame() ?? '';
    // Initial render — no event plan in flight, the full-screen view's
    // signature title must NOT be on screen.
    expect(frame).not.toContain('Instrumentation Plan');
    unmount();
  });

  it('renders the event-plan title on the next frame after promptEventPlan is called', async () => {
    const store = new WizardStore(Flow.Wizard);
    const { lastFrame, unmount } = render(<App store={store} />);
    await flushFrames();

    // Kick off an event-plan prompt — the store sets pendingPrompt and
    // emits a version bump. The next React frame is what the user sees;
    // before the App.tsx unification this update was invisible until the
    // user resized the terminal.
    void store.promptEventPlan(samplePlan(3));
    await flushFrames();

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Instrumentation Plan (3 events)');
    expect(frame).toContain('[Y] approve [S] skip [F] give feedback');
    unmount();
  });

  it('removes the event-plan title on the next frame after the user resolves it', async () => {
    const store = new WizardStore(Flow.Wizard);
    const { lastFrame, unmount } = render(<App store={store} />);
    await flushFrames();

    void store.promptEventPlan(samplePlan(2));
    await flushFrames();
    expect(lastFrame() ?? '').toContain('Instrumentation Plan (2 events)');

    // Approve — this clears pendingPrompt and emits a version bump.
    // The next frame should NOT show the event-plan title (the inverse
    // of the "doesn't render until resize" bug — same root cause, same
    // fix verifies both directions).
    store.resolveEventPlan({ decision: 'approved' });
    await flushFrames();

    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Instrumentation Plan');
    unmount();
  });

  it('keeps the event-plan screen mounted with a "Revising…" state after the user submits feedback', async () => {
    // Regression coverage for the "screen disappears while the agent
    // processes feedback" bug. Submitting feedback clears
    // `pendingPrompt` (the agent's promise resolves so it can revise),
    // but the screen MUST stay on-screen with a "Revising your plan…"
    // panel — otherwise the user briefly lands on the Run tab view
    // and assumes the wizard skipped their feedback.
    const store = new WizardStore(Flow.Wizard);
    const { lastFrame, unmount } = render(<App store={store} />);
    await flushFrames();

    void store.promptEventPlan(samplePlan(3));
    await flushFrames();
    expect(lastFrame() ?? '').toContain('Instrumentation Plan (3 events)');

    store.resolveEventPlan({
      decision: 'revised',
      feedback: 'would love to see lowercased event names',
    });
    await flushFrames();

    const frame = lastFrame() ?? '';
    // Plan list is gone — the agent owns the revision now.
    expect(frame).not.toContain('Instrumentation Plan (3 events)');
    // …but the screen is still here, with a clear "we're working on
    // it" panel that quotes the feedback back.
    expect(frame).toContain('Revising your plan');
    expect(frame).toContain('would love to see lowercased event names');
    unmount();
  });

  it('flips from "Revising…" back to the normal plan view when the revised plan lands', async () => {
    const store = new WizardStore(Flow.Wizard);
    const { lastFrame, unmount } = render(<App store={store} />);
    await flushFrames();

    void store.promptEventPlan(samplePlan(2));
    await flushFrames();
    store.resolveEventPlan({
      decision: 'revised',
      feedback: 'try Title Case',
    });
    await flushFrames();
    expect(lastFrame() ?? '').toContain('Revising your plan');

    // Agent re-calls confirm_event_plan with the revised events —
    // this is what `promptEventPlan` represents on the store side.
    // pendingEventPlanFeedback must clear in the same tick so the
    // user sees the new plan immediately.
    void store.promptEventPlan(samplePlan(4));
    await flushFrames();

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Instrumentation Plan (4 events)');
    expect(frame).not.toContain('Revising your plan');
    unmount();
  });
});
