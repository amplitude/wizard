/**
 * Regression: P0 — confirm_event_plan UI never renders.
 *
 * The agent calls `confirm_event_plan` (server-side `await
 * getUI().promptEventPlan(events)`), the TUI store sets a `pendingPrompt`
 * with `kind: 'event-plan'`, and ConsoleView is supposed to flip its
 * content area from `children` (the active screen) to a Y/S/F prompt
 * panel. If pendingPrompt is set but the prompt UI never appears, the
 * agent waits forever and the wizard looks stuck.
 *
 * These tests render the full <App> tree against a store that's already
 * in the Run phase and assert the prompt panel actually shows when
 * `promptEventPlan` is called.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';

// Stub useStdoutDimensions so we control the terminal size — without
// this, ink-testing-library returns rows=undefined and the prompt can
// stretch into infinite vertical space, masking the off-screen-clip bug.
vi.mock('../hooks/useStdoutDimensions.js', () => ({
  useStdoutDimensions: (): [number, number] => [100, 30],
}));

import { render } from 'ink-testing-library';
import { App } from '../App.js';
import { WizardStore } from '../store.js';
import { RunPhase } from '../session-constants.js';

// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\x1b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC = /\x1b\][^\x07]*\x07/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_CSI, '').replace(ANSI_OSC, '');
}

/**
 * Build a store in the Run phase so the router resolves to the Run
 * screen — that's where confirm_event_plan fires in the real flow.
 */
function makeRunPhaseStore(): WizardStore {
  const store = new WizardStore();
  // Authenticated, intro concluded, project resolved, framework picked,
  // data setup done — flow walks past every guard and parks on Run.
  store.session = {
    ...store.session,
    introConcluded: true,
    region: 'us',
    credentials: {
      accessToken: 'tok',
      projectApiKey: 'k',
      host: 'https://api2.amplitude.com/2/httpapi',
      appId: 1,
    },
    selectedOrgId: 'o1',
    selectedOrgName: 'Org',
    selectedProjectId: 'p1',
    selectedProjectName: 'Proj',
    requiresAccountConfirmation: false,
    projectHasData: false,
    activationLevel: 'none',
    runPhase: RunPhase.Running,
    runStartedAt: Date.now(),
  };
  return store;
}

describe('event-plan prompt rendering', () => {
  it('renders the event-plan UI when promptEventPlan is called on the Run screen', () => {
    const store = makeRunPhaseStore();
    const { lastFrame, rerender } = render(<App store={store} />);

    // Sanity: before the prompt, no Y/S/F line should be present.
    const before = stripAnsi(lastFrame() ?? '');
    expect(before).not.toContain('[Y] approve');
    expect(before).not.toContain('Instrumentation Plan');

    // Simulate the agent calling confirm_event_plan -> promptEventPlan.
    // We don't await the returned promise — we just want the UI to flip.
    void store.promptEventPlan([
      { name: 'Drawing Created', description: 'User creates a new drawing' },
      { name: 'Drawing Exported', description: 'User exports drawing to file' },
    ]);

    rerender(<App store={store} />);

    const after = stripAnsi(lastFrame() ?? '');

    // The prompt panel must replace the screen content. These three are
    // the load-bearing strings the user is supposed to see:
    expect(after).toContain('Instrumentation Plan');
    expect(after).toContain('Drawing Created');
    expect(after).toContain('[Y] approve');
  });

  it('keeps the prompt visible while pendingPrompt is set, even with active activity', () => {
    const store = makeRunPhaseStore();
    // Mimic an in-flight mcp-tool activity (the kind PR #594 added). The
    // ActivityLine renders an extra row of chrome but must not push the
    // prompt content out of the visible area.
    store.setCurrentActivity({
      kind: 'mcp-tool',
      message: 'Querying Amplitude (get_events)...',
      startedAt: Date.now(),
      estimatedDurationSec: 30,
    });

    const { lastFrame, rerender } = render(<App store={store} />);

    void store.promptEventPlan([{ name: 'Test Event', description: 'desc' }]);
    rerender(<App store={store} />);

    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Instrumentation Plan');
    expect(frame).toContain('Test Event');
    expect(frame).toContain('[Y] approve');
  });

  it('renders prompt UI even when the user is on the Events tab (events tab tracks store.eventPlan)', () => {
    const store = makeRunPhaseStore();
    // The agent typically calls `setEventPlan` BEFORE `confirm_event_plan` so
    // the user can switch to the "Events" tab to inspect the proposal. The
    // tab state lives in `store.requestedTab`. The prompt UI in ConsoleView
    // wraps RunScreen — so even when the Events tab is active, the prompt
    // must take precedence and replace the entire content area.
    store.setEventPlan([{ name: 'Test Event', description: 'desc' }]);
    store.setRequestedTab('events');

    const { lastFrame, rerender } = render(<App store={store} />);
    void store.promptEventPlan([{ name: 'Test Event', description: 'desc' }]);
    rerender(<App store={store} />);

    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Instrumentation Plan');
    expect(frame).toContain('[Y] approve');
  });

  it('renders [Y] approve hint line even with 15 events (the user-reported repro count)', () => {
    // Real Excalidraw repro: agent proposes 13–15 events, the prompt is
    // pinned at the bottom of the panel as a `<Text>[Y] approve…</Text>`,
    // and `overflow="hidden"` on the wrapping Box clips it off-screen
    // before the user ever sees an action hint. Without a way to act, the
    // run hangs on `await getUI().promptEventPlan(events)` indefinitely
    // even though the prompt was set.
    //
    // Force rows = 30 (typical 80x24-30 terminal) by stubbing
    // `useStdoutDimensions`. ink-testing-library returns columns=100,
    // rows=undefined by default — without a real height constraint the
    // bug is invisible because every event renders into infinite space.
    const store = makeRunPhaseStore();
    const events = Array.from({ length: 15 }, (_, i) => ({
      name: `Event ${i + 1}`,
      description: `A reasonably long description that wraps to roughly two lines on an 80-column terminal so the panel runs out of height before the action hint can render — repro for #621.`,
    }));

    const { lastFrame, rerender } = render(<App store={store} />);
    void store.promptEventPlan(events);
    rerender(<App store={store} />);

    const frame = stripAnsi(lastFrame() ?? '');
    // Header always lands first — this confirms the prompt panel mounted.
    expect(frame).toContain('Instrumentation Plan');
    // The action hint is the load-bearing line. Without it the user has
    // no idea what keys to press, and the agent waits forever.
    expect(frame).toContain('[Y] approve');
    // Cap visibility kicks in past 8 events — verify the "+N more" tail
    // is emitted instead of letting Yoga clip the action hint silently.
    expect(frame).toContain('more');
  });

  it('renders [Y] approve hint and "+N more" tail with the (extreme) 30-event case', () => {
    const store = makeRunPhaseStore();
    const events = Array.from({ length: 30 }, (_, i) => ({
      name: `Long Event Name ${i + 1} With Extra Words`,
      description:
        'A long description that wraps to two or three lines on most terminals so the prompt panel actively runs out of vertical real estate.',
    }));

    const { lastFrame, rerender } = render(<App store={store} />);
    void store.promptEventPlan(events);
    rerender(<App store={store} />);

    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Instrumentation Plan');
    // The bottom row must always be the action hint.
    expect(frame).toContain('[Y] approve');
    expect(frame).toContain('+22 more');
  });
});
