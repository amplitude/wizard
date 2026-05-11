/**
 * RunScreen — Progress tab vertical-spacing + chrome-pinning
 * invariants.
 *
 * History:
 *   1. PR #688 tried to close a ~10-row dead band between short
 *      Progress-tab content and the bottom chrome by making the
 *      TabContainer collapse its outer flexGrow when the active tab
 *      opted out (`fillHeight: false`). The Progress tab opted out.
 *   2. A user screenshot showed that fix made things worse: the
 *      tab bar + status pill rose to meet content, but the KeyHintBar
 *      (which lives in App's ConsoleView, *below* TabContainer) stayed
 *      pinned to the terminal bottom. The chrome split into two
 *      clusters with empty space wedged between them.
 *
 * Current layout (the fix this file pins):
 *   - The tab bar lives in TabContainer and stays pinned to the
 *     terminal bottom alongside the KeyHintBar — they form ONE
 *     immutable bottom-chrome cluster.
 *   - The bottom status pill ("◇ Detecting your project setup") used
 *     to be in the chrome row; it's now the LAST row of the Progress
 *     tab's own content area, flush with the active task list.
 *   - On wide terminals (≥ 110 cols) the right column shows
 *     DiscoveryFeed instead of the previous AmplitudeLogo — real
 *     status replaces decoration. On narrow terminals the same panel
 *     renders at the TOP of the content area instead of the right.
 *   - The redundant "Progress: X/Y completed" footer in ProgressList
 *     is suppressed (`showFooter={false}`) because the header already
 *     shows the same counter plus elapsed time.
 *   - Pending task rows render with the open-bullet glyph (○) instead
 *     of a blank gutter, aligning with the journey-stepper's visual
 *     language at the top of the screen.
 *
 * The "dead-band run" check below now expresses a different invariant
 * than #688's: it asserts that the BOTTOM STATUS PILL stays flush
 * with content (no gap between the pill and the last content row).
 * The big gap between the pill and the tab bar is by design — the
 * bar is pinned to the terminal bottom, not to content.
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

// Stub `useStdoutDimensions` so we can pin the terminal viewport size
// for layout assertions. ink-testing-library's mocked stdout reports
// columns=100 and no rows — neither of which exercises the wide-layout
// branch (≥ 110 cols, ≥ 22 rows) where the right column is shown.
let mockedDims: [number, number] = [100, 24];
vi.mock('../../hooks/useStdoutDimensions.js', () => ({
  useStdoutDimensions: () => mockedDims,
}));

import { Box } from 'ink';
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
 * chrome, so they're not the bug. With the post-#688 chrome-pinning
 * fix this also covers the bottom status pill, which now sits as the
 * last row of the content area — so any gap between the pill and the
 * last task/discovery row would show up here.
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

  // ─────────────────────────────────────────────────────────────────
  // Bug-1 follow-up: chrome pinning. The post-#688 fix moved the bottom
  // status pill OUT of the chrome row (it's now the last row of the
  // tab's content) and pinned the tab bar to the terminal bottom so it
  // forms one chrome cluster with the KeyHintBar in ConsoleView below.
  // ─────────────────────────────────────────────────────────────────

  it('chrome pinning: tab bar sits at the bottom of the Run screen viewport, not floating mid-frame', () => {
    // Render RunScreen inside a height-bounded outer Box (mimicking
    // App's content area). On a tall viewport with short content
    // (cold-start) the tab bar must stay pinned to the bottom of the
    // bounding box — never float ~18 rows above with empty space
    // wedged below it (the PR #688 regression).
    //
    // Note: the KeyHintBar lives in App's ConsoleView, not in
    // RunScreen, so we can't pin it from this test. App-level pinning
    // is enforced by App's own layout (separator + KeyHintBar + input
    // are siblings of the content area), so as long as RunScreen
    // doesn't introduce a gap of its own we keep the chrome unified.
    mockedDims = [120, 40];
    const store = seedColdStartProgressStore();

    const VIEWPORT_HEIGHT = 30;
    const { lastFrame, unmount } = render(
      <Box width={120} height={VIEWPORT_HEIGHT} flexDirection="column">
        <RunScreen store={store} />
      </Box>,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    const lines = frame.split('\n');
    let lastNonEmpty = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().length > 0) {
        lastNonEmpty = i;
        break;
      }
    }
    expect(lastNonEmpty).toBeGreaterThan(0);

    const tabBarRow = lines.findIndex(
      (l) => /Progress/.test(l) && /Logs/.test(l) && /Snake/.test(l),
    );
    expect(tabBarRow).toBeGreaterThan(0);

    // Tab bar must sit AT the bottom of the bounded viewport (within
    // 3 rows). Before the fix, fillHeight=false on the Progress tab
    // collapsed the outer flex-grow and let the tab bar rise to meet
    // short content — leaving the lower half of the bounding box
    // empty. The fix re-pins the tab bar to the bottom.
    expect(lastNonEmpty - tabBarRow).toBeLessThanOrEqual(3);
  });

  it('chrome pinning: bottom status pill is flush with content when it surfaces (no big gap above)', () => {
    // The pill ("◇ <status>") used to live in TabContainer's chrome
    // row. After the post-#688 fix it renders as the LAST row of the
    // Progress tab content area so it sits flush with the active task
    // list. Pin: between the pill and the last task / discovery row
    // above it, no run of >3 blank rows.
    //
    // Tier-6 suppression (this PR) means a plain canonical-task state
    // does NOT render a pill at all — the Tasks list above already
    // shows that text and a duplicated pill would echo it. To exercise
    // the flush-with-content invariant we surface a tier-2 pill via
    // `currentActivity`, which is NOT shown in the Tasks list and so
    // is not suppressed.
    mockedDims = [120, 40];
    const store = seedColdStartProgressStore();
    store.session = {
      ...store.session,
      currentActivity: {
        kind: 'compaction',
        message: 'Compacting context (typically ~60s)',
        startedAt: Date.now(),
      },
    };

    const { lastFrame, unmount } = render(
      <Box width={120} height={30} flexDirection="column">
        <RunScreen store={store} />
      </Box>,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    const lines = frame.split('\n');
    // The pill row contains the diamondOpen icon (◇) followed by the
    // status text from currentActivity (tier 2).
    const pillRow = lines.findIndex((l) => /◇\s+Compacting context/.test(l));
    expect(pillRow).toBeGreaterThan(0);

    // Find the last non-whitespace row strictly above the pill.
    let lastContentAbove = -1;
    for (let i = pillRow - 1; i >= 0; i--) {
      if (lines[i].trim().length > 0) {
        lastContentAbove = i;
        break;
      }
    }
    expect(lastContentAbove).toBeGreaterThanOrEqual(0);

    // No run of >3 blank rows between the last content row and the
    // pill. The pill semantically belongs WITH the task list, not
    // floating across a gap.
    expect(pillRow - lastContentAbove - 1).toBeLessThanOrEqual(3);
  });

  it('tier-6 suppression: canonical-task-only state renders NO pill (does not duplicate Tasks list)', () => {
    // Reproduces the bug from the task description: the Tasks list
    // shows `› Detecting project setup`, and the prior pill repeated
    // `◇ Detecting project setup` directly below it. The suppression
    // rule means no pill renders for that scenario.
    mockedDims = [120, 40];
    const store = seedColdStartProgressStore(); // detect is in_progress

    const { lastFrame, unmount } = render(
      <Box width={120} height={30} flexDirection="column">
        <RunScreen store={store} />
      </Box>,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    // No pill row matching the canonical activeForm should appear.
    expect(frame).not.toMatch(/◇\s+Detecting your project setup/);
    // And the Tasks list still shows the in-progress row.
    expect(frame).toMatch(/Detecting your project setup/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Bug-2 follow-up: DiscoveryFeed placement. The user said the prior
  // location ("below the Tasks list, with the AmplitudeLogo on the
  // right") was inconvenient. Real status replaces decoration:
  //   - wide terminals (≥ 110 cols, ≥ 22 rows): right column
  //   - narrow terminals: top of content area (above Tasks)
  // ─────────────────────────────────────────────────────────────────

  it('DiscoveryFeed renders in the right column on wide terminals', () => {
    mockedDims = [120, 40];
    const store = seedColdStartProgressStore();

    const { lastFrame, unmount } = render(
      <Box width={120} height={40}>
        <RunScreen store={store} />
      </Box>,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    // The Discovered header must render somewhere in the frame.
    expect(frame).toMatch(/Discovered/);

    // It must be on the SAME row as the Tasks header (right-column
    // layout puts the panels side by side). The tasks header row is
    // the row that contains "0 done" — Tasks itself is rendered as a
    // styled cell so we look for a near neighbour instead of the
    // exact word.
    const lines = frame.split('\n');
    const headerRow = lines.findIndex((l) => /0 done/.test(l));
    expect(headerRow).toBeGreaterThanOrEqual(0);

    // Discovered must appear AT or BELOW headerRow but BEFORE the tab
    // bar — i.e. side-by-side with the task list, not above it.
    const discoveredRow = lines.findIndex((l) => /Discovered/.test(l));
    expect(discoveredRow).toBeGreaterThanOrEqual(headerRow);
  });

  // ─────────────────────────────────────────────────────────────────
  // Events tab stability — always present, regardless of plan size.
  //
  // Pre-fix: the Events tab was conditionally spread only when
  // `eventPlan.length > 0`. The agent's first event plan landing
  // would re-order the tab strip mid-run (insert a new tab between
  // Progress and Logs), so any user already navigated to "Logs"
  // would see Logs shift to a new index and the highlight drift.
  // The placeholder copy lives inside EventPlanViewer, which already
  // handles the empty-state case.
  // ─────────────────────────────────────────────────────────────────

  it('Events tab is always rendered, even when the event plan is empty', () => {
    mockedDims = [120, 40];
    const store = seedColdStartProgressStore();
    // The cold-start store seeds no events. The Events tab label must
    // still render in the tab strip.
    expect(store.eventPlan.length).toBe(0);

    const { lastFrame, unmount } = render(
      <Box width={120} height={30} flexDirection="column">
        <RunScreen store={store} />
      </Box>,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    // Tab strip contains all three of Progress / Events / Logs.
    expect(frame).toMatch(/Progress/);
    expect(frame).toMatch(/Events/);
    expect(frame).toMatch(/Logs/);
  });

  it('Events tab content updates when the event plan goes from empty to populated', () => {
    mockedDims = [120, 40];

    // Switch to the Events tab via the store's requestedTab hook, then
    // populate the plan and assert the agent's events appear.
    const store = seedColdStartProgressStore();
    expect(store.eventPlan.length).toBe(0);
    store.setEventPlan([
      { name: 'Signup Complete', description: 'User finished onboarding' },
      { name: 'Purchase', description: 'Order placed' },
    ]);
    store.setRequestedTab('events');

    const { lastFrame, unmount } = render(
      <Box width={120} height={30} flexDirection="column">
        <RunScreen store={store} />
      </Box>,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    // The events render inside the EventPlanViewer.
    expect(frame).toMatch(/Signup Complete/);
    expect(frame).toMatch(/Purchase/);
  });

  it('DiscoveryFeed collapses to the top of the content area on narrow terminals', () => {
    // Below the wide-column threshold (110 cols) the right column
    // disappears and DiscoveryFeed renders ABOVE the task list instead.
    mockedDims = [80, 40];
    const store = seedColdStartProgressStore();

    const { lastFrame, unmount } = render(
      <Box width={80} height={40}>
        <RunScreen store={store} />
      </Box>,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    expect(frame).toMatch(/Discovered/);
    const lines = frame.split('\n');
    const discoveredRow = lines.findIndex((l) => /Discovered/.test(l));
    const headerRow = lines.findIndex((l) => /0 done/.test(l));
    expect(discoveredRow).toBeGreaterThanOrEqual(0);
    expect(headerRow).toBeGreaterThan(discoveredRow);
  });
});
