/**
 * RunTimeline — snapshot coverage for the redesigned RunScreen body.
 *
 * The composer is width-responsive: ledger row count, extras visibility,
 * and the hotkey rail spacing all change as the terminal narrows. These
 * snapshots pin the layout at the three approved breakpoints (80 / 60 /
 * 40 cols) plus one ASCII-fallback snapshot at 80 cols.
 *
 * Determinism strategy:
 *   - Mock BrailleSpinner to a static `⠋` so the 200ms internal interval
 *     doesn't churn frames during the render under test.
 *   - Mock useStdoutDimensions per-test to pin cols/rows — Ink's testing
 *     stdout hardcodes columns=100 and there's no public hook to override.
 *   - Pin `now()` so elapsed time renders as a stable `2m 14s`.
 *   - Seed file writes via the public store recorders so the ledger
 *     receives realistic entries (timestamps, status, etc.).
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';

// Static spinner so frame churn doesn't pollute snapshots.
vi.mock('../BrailleSpinner.js', () => ({
  BrailleSpinner: () => React.createElement(Text, null, '⠋'),
}));

// Pin terminal dimensions per-suite.
let mockedCols = 80;
const mockedRows = 30;
vi.mock('../../hooks/useStdoutDimensions.js', () => ({
  useStdoutDimensions: () => [mockedCols, mockedRows] as [number, number],
}));

// Drop the file-change ledger lookup — under test we don't want to read
// any real-disk patch state, and the ledger isn't seeded in unit tests.
vi.mock('../../../../lib/file-change-ledger.js', () => ({
  getFileChangeLedger: () => ({ entries: () => [], get: () => undefined }),
}));
vi.mock('../../../../lib/file-change-diff.js', () => ({
  summarizeLedgerPath: () => null,
}));

import { RunTimeline } from '../RunTimeline.js';
import { WizardStore } from '../../store.js';
import { Flow } from '../../flows.js';
import { TaskStatus } from '../../../../ui/wizard-ui.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (s: string): string => s.replace(ANSI, '');

const FIXED_NOW = 1_700_000_134_000; // 134s after the start ms below
const FIXED_START = 1_700_000_000_000;

function makeStore() {
  const store = new WizardStore(Flow.Wizard);
  // Stamp a deterministic run start so the elapsed timer renders as 2m 14s.
  store.session = {
    ...store.session,
    runStartedAt: FIXED_START,
    selectedOrgName: 'acme',
    selectedProjectName: 'web-app',
    region: 'us',
    installDir: '/proj',
  } as typeof store.session;
  store.setTasks([
    {
      label: 'detect framework',
      activeForm: 'detecting framework',
      status: TaskStatus.Completed,
      done: true,
    },
    {
      label: 'install @amplitude/analytics-browser',
      activeForm: 'installing @amplitude/analytics-browser',
      status: TaskStatus.Completed,
      done: true,
    },
    {
      label: 'wire amplitude into layout',
      activeForm: 'wiring amplitude into layout',
      status: TaskStatus.InProgress,
      done: false,
    },
    {
      label: 'confirm 7 events',
      activeForm: 'confirming 7 events',
      status: TaskStatus.Pending,
      done: false,
    },
    {
      label: 'run verify pass',
      activeForm: 'running verify pass',
      status: TaskStatus.Pending,
      done: false,
    },
  ]);
  store.pushStatus('editing src/app/layout.tsx');
  // Two completed file writes for the ledger.
  store.recordFileChangePlanned({
    path: '/proj/src/app/layout.tsx',
    operation: 'modify',
  });
  store.recordFileChangeApplied({
    path: '/proj/src/app/layout.tsx',
    operation: 'modify',
    bytes: 0,
  });
  store.recordFileChangePlanned({
    path: '/proj/src/lib/amplitude.ts',
    operation: 'create',
  });
  store.recordFileChangeApplied({
    path: '/proj/src/lib/amplitude.ts',
    operation: 'create',
    bytes: 0,
  });
  return store;
}

describe('RunTimeline', () => {
  beforeEach(() => {
    delete process.env.WIZARD_FORCE_ASCII;
  });
  afterEach(() => {
    delete process.env.WIZARD_FORCE_ASCII;
  });

  it('renders the full timeline at 80 cols (UTF-8)', () => {
    mockedCols = 80;
    const store = makeStore();
    const { lastFrame } = render(
      <RunTimeline store={store} now={() => FIXED_NOW} />,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    // Voice line
    expect(frame).toMatch(/editing src\/app\/layout\.tsx/);
    // Todos
    expect(frame).toContain('detect framework');
    expect(frame).toContain('install @amplitude/analytics-browser');
    expect(frame).toContain('wiring amplitude into layout');
    expect(frame).toContain('confirm 7 events');
    expect(frame).toContain('run verify pass');
    // Glyphs
    expect(frame).toContain('✓');
    expect(frame).toContain('❯');
    expect(frame).toContain('○');
    // Ledger present with edit glyph
    expect(frame).toContain('✎');
    expect(frame).toContain('src/app/layout.tsx');
    expect(frame).toContain('src/lib/amplitude.ts');
    // Footer
    expect(frame).toContain('elapsed 2m 14s');
    expect(frame).toContain('$0.00 used');
    // Hotkey rail
    expect(frame).toContain('[d]');
    expect(frame).toContain('diff');
    expect(frame).toContain('[/]');
    expect(frame).toContain('more');
  });

  it('renders the timeline at 60 cols with project context below step rail', () => {
    mockedCols = 60;
    const store = makeStore();
    const { lastFrame } = render(
      <RunTimeline store={store} now={() => FIXED_NOW} />,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    // Project context line surfaces inside the timeline at medium width
    expect(frame).toContain('acme / web-app / us');
    // Voice + todos still present
    expect(frame).toContain('editing src/app/layout.tsx');
    expect(frame).toContain('wiring amplitude into layout');
    // Ledger present
    expect(frame).toContain('✎');
    // Hotkey rail still visible
    expect(frame).toContain('[d]');
    expect(frame).toContain('[tab]');
  });

  it('renders the timeline at 40 cols (narrow): extras hidden, ledger trims', () => {
    mockedCols = 40;
    const store = makeStore();
    // Add an extra so we can verify the extras row drops at narrow width
    store.session = {
      ...store.session,
      additionalFeatureQueue: ['llm'],
    } as typeof store.session;
    const { lastFrame } = render(
      <RunTimeline store={store} now={() => FIXED_NOW} />,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    // Extras row collapses entirely
    expect(frame).not.toMatch(/llm/i);
    // Voice + todos still render
    expect(frame).toContain('editing');
    expect(frame).toContain('detect framework');
    // Hotkey rail uses tighter spacing — labels and keys still visible
    expect(frame).toContain('[d]');
    expect(frame).toContain('[/]');
  });

  it('falls back to ASCII glyphs when WIZARD_FORCE_ASCII=1', () => {
    process.env.WIZARD_FORCE_ASCII = '1';
    mockedCols = 80;
    const store = makeStore();
    const { lastFrame } = render(
      <RunTimeline store={store} now={() => FIXED_NOW} />,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    // No UTF-8 status glyphs
    expect(frame).not.toContain('✓');
    expect(frame).not.toContain('❯');
    expect(frame).not.toContain('○');
    expect(frame).not.toContain('✎');
    // ASCII fallbacks instead
    expect(frame).toContain('*');
    expect(frame).toContain('>');
    expect(frame).toContain('o ');
    expect(frame).toContain('~ ');
    // Voice line still rendered
    expect(frame).toContain('editing src/app/layout.tsx');
  });

  it('renders the paused pill between elapsed and cost when paused=true', () => {
    mockedCols = 80;
    const store = makeStore();
    const { lastFrame } = render(
      <RunTimeline store={store} now={() => FIXED_NOW} paused />,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    // The footer reads "elapsed 2m 14s ◆ paused · $0.00 used"
    expect(frame).toContain('elapsed 2m 14s');
    expect(frame).toContain('◆ paused');
    expect(frame).toContain('$0.00 used');
  });

  it('renders the thinking fallback when no status or file writes exist', () => {
    mockedCols = 80;
    const store = new WizardStore(Flow.Wizard);
    store.session = {
      ...store.session,
      runStartedAt: FIXED_START,
    } as typeof store.session;
    const { lastFrame } = render(
      <RunTimeline store={store} now={() => FIXED_NOW} />,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('thinking');
    expect(frame).toContain('elapsed 2m 14s');
  });
});
