/**
 * RunScreen — Progress tab vertical-spacing invariants.
 *
 * Pins the layout fix from the "collapse dead vertical space + visual
 * polish" PR. A 142×41 screenshot of a live run on a real project
 * showed ~10 rows of pure whitespace between the last visible content
 * row ("✓ Region   US") and the bottom chrome (status pill / tab bar)
 * during cold-start, when the Progress tab is short.
 *
 * Root cause: TabContainer's content area used `flexGrow={1}`
 * unconditionally, so even when the active tab's content was short the
 * outer Box still occupied the full viewport. Yoga then placed the
 * chrome at the bottom of that container, leaving the gap.
 *
 * Fix: TabDefinition gained an opt-in `fillHeight` flag. The Progress
 * tab opts out (`fillHeight: false`) so its content area takes its
 * natural height and the bottom chrome rises to meet the last content
 * row. Logs / Snake keep the default (true) — they need the full
 * viewport for their scroll buffers.
 *
 * This test renders the Progress tab in its cold-start state (no tasks
 * completed yet, a few discovery facts already published) and asserts
 * the dead-band invariant: between the last content row and the bottom
 * pill / tab bar there must NEVER be a run of pure-whitespace rows
 * longer than 3.
 *
 * If a future change re-introduces a spurious `flexGrow={1}`, breaks
 * the FinalizingPanel/ConditionalTips collapse, or otherwise lets a
 * gap reopen, this assertion will catch it before it ships.
 *
 * Why the SPINNER_INTERVAL mock: same reason as RunScreen.coaching —
 * the live 200ms spinner re-renders the whole tree dozens of times per
 * test, which can blow the timeout under CI load. The single static
 * frame is enough for a layout assertion.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../styles.js', async (importActual) => {
  const actual = await importActual<typeof import('../../styles.js')>();
  return {
    ...actual,
    SPINNER_INTERVAL: 60 * 60 * 1000,
  };
});

import { render } from 'ink-testing-library';
import { RunScreen } from '../RunScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import { TaskStatus } from '../../../wizard-ui.js';

// eslint-disable-next-line no-control-regex
const ANSI_CSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC_REGEX = /\x1b\][^\x07]*\x07/g;
const stripAnsi = (s: string): string =>
  s.replace(ANSI_CSI_REGEX, '').replace(ANSI_OSC_REGEX, '');

/**
 * Compute the longest run of consecutive whitespace-only rows that sits
 * BETWEEN the last non-whitespace row of the content area and the tab
 * bar at the bottom of the chrome. Whitespace rows that follow the tab
 * bar (i.e. the trailing rest of the viewport) are intentionally
 * ignored — those are below the chrome, not between content and
 * chrome, so they're not the bug.
 */
function maxDeadRunBetweenContentAndChrome(frame: string): number {
  const lines = frame.split('\n');

  // Locate the bottom tab bar row (the one containing the tab labels).
  // The Progress tab is always rendered, so this anchor is reliable.
  const tabBarRow = lines.findIndex((l) => /Progress/.test(l) && /Logs/.test(l));
  if (tabBarRow === -1) return 0;

  // Find the last non-whitespace row strictly above the tab bar. That's
  // the end of the visible content (content + status pill, if any).
  let lastContentRow = -1;
  for (let i = tabBarRow - 1; i >= 0; i--) {
    if (lines[i].trim().length > 0) {
      lastContentRow = i;
      break;
    }
  }
  if (lastContentRow === -1) return 0;

  // Count consecutive whitespace rows between the last content row and
  // the tab bar.
  let runLength = 0;
  let maxRun = 0;
  for (let i = lastContentRow + 1; i < tabBarRow; i++) {
    if (lines[i].trim().length === 0) {
      runLength += 1;
      if (runLength > maxRun) maxRun = runLength;
    } else {
      runLength = 0;
    }
  }
  return maxRun;
}

function seedColdStartProgressStore() {
  const store = makeStoreForSnapshot({
    runStartedAt: Date.now() - 55_000, // 55s elapsed — matches the screenshot
    discoveryFacts: [
      {
        id: 'fact-framework',
        label: 'Framework',
        value: 'JavaScript (Web)',
        discoveredAt: Date.now() - 50_000,
      },
      {
        id: 'fact-typescript',
        label: 'TypeScript',
        value: 'yes',
        discoveredAt: Date.now() - 49_000,
      },
      {
        id: 'fact-pkg',
        label: 'Package manager',
        value: 'Yarn V1',
        discoveredAt: Date.now() - 48_000,
      },
      {
        id: 'fact-project',
        label: 'Project',
        value: 'Amplitude',
        discoveredAt: Date.now() - 47_000,
      },
      {
        id: 'fact-region',
        label: 'Region',
        value: 'US',
        discoveredAt: Date.now() - 46_000,
      },
    ],
  });
  store.setTasks([
    {
      label: 'Detect your project setup',
      activeForm: 'Detecting your project setup',
      status: TaskStatus.InProgress,
      done: false,
    },
    {
      label: 'Install Amplitude',
      activeForm: 'Installing Amplitude',
      status: TaskStatus.Pending,
      done: false,
    },
    {
      label: 'Plan and approve events to track',
      activeForm: 'Planning events',
      status: TaskStatus.Pending,
      done: false,
    },
    {
      label: 'Wire up event tracking',
      activeForm: 'Wiring up event tracking',
      status: TaskStatus.Pending,
      done: false,
    },
  ]);
  return store;
}

describe('RunScreen — Progress tab dead-vertical-space invariant', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not leave a run of >3 whitespace rows between content and bottom chrome during cold-start', () => {
    // Real-user screenshot was 142×41 on the Progress tab during the
    // first ~55s of a run. We render against ink-testing-library's
    // default 80×24, which still reproduces the bug shape: the
    // content area `flexGrow={1}` was width-independent, so the gap
    // appeared at any viewport size where the tab content was
    // shorter than the available height.
    const store = seedColdStartProgressStore();
    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    const dead = maxDeadRunBetweenContentAndChrome(frame);
    expect(dead).toBeLessThanOrEqual(3);
  });

  it('drops the redundant "Progress: X/Y completed" footer (header already shows the count)', () => {
    // The header above the task list shows "X done · Y to go · Ns
    // (cold start: ...)". Repeating "Progress: X/Y completed" at the
    // bottom of the task list is the same information without the
    // elapsed timer or cold-start hint — drop it. Pinned here so the
    // ProgressList default never silently re-introduces it on the
    // RunScreen.
    const store = seedColdStartProgressStore();
    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    expect(frame).not.toMatch(/Progress:\s+\d+\/\d+\s+completed/);
    // The top "X done · Y to go" header MUST still be present.
    expect(frame).toMatch(/0 done .* 4 to go/);
  });

  it('renders pending tasks with the open-bullet glyph (matches journey stepper visual language)', () => {
    // Pending tasks used to render with a blank gutter, which made the
    // visual language inconsistent with the journey stepper's ○/●/✓
    // palette at the top of the screen. Pin the new glyph so we don't
    // regress to the old "blank gutter" rendering.
    const store = seedColdStartProgressStore();
    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    // At least one pending task row should start with the open-bullet
    // glyph in the icon gutter.
    expect(frame).toMatch(/○\s+Install Amplitude/);
  });
});
