/**
 * RunScreen — agent-self-reported task list.
 *
 * The wizard's canonical 4-step skeleton ("Detect / Install / Plan / Wire")
 * lives in `store.tasks` and renders via ProgressList. The inner agent ALSO
 * declares its own plan via the `set_agent_tasks` wizard-tools MCP tool —
 * a separate list in `store.agentTasks` rendered below the canonical list
 * so users see what the agent is actually doing, not just spinner state.
 *
 * Voice / labeling: the heading is lowercase ("the agent's plan:" or
 * "the agent is planning to:") per the wizard's voice conventions —
 * never SHOUTY TODOS or TASKS captions.
 *
 * Why the SPINNER_INTERVAL mock: same reason as RunScreen.spacing /
 * RunScreen.coaching — the live 200ms spinner re-renders the whole tree
 * dozens of times per test, which blows the timeout under CI load. A
 * dormant spinner is enough for the static layout assertions here.
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

let mockedDims: [number, number] = [120, 40];
vi.mock('../../hooks/useStdoutDimensions.js', () => ({
  useStdoutDimensions: () => mockedDims,
}));

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

function seedStoreWithCanonicalTasks() {
  const store = makeStoreForSnapshot({ runStartedAt: Date.now() });
  store.setTasks([
    {
      label: 'Detect your project setup',
      activeForm: 'Detecting your project setup',
      status: TaskStatus.Completed,
      done: true,
    },
    {
      label: 'Install Amplitude',
      activeForm: 'Installing Amplitude',
      status: TaskStatus.InProgress,
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

describe('RunScreen — agent self-reported task list', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedDims = [120, 40];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when the agent has not seeded a plan yet', () => {
    const store = seedStoreWithCanonicalTasks();
    // store.agentTasks defaults to []
    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    // No heading and no per-row glyphs should appear.
    expect(frame).not.toMatch(/the agent's plan:/);
    expect(frame).not.toMatch(/the agent is planning to:/);
  });

  it('shows the "planning to" heading and task titles after set_agent_tasks fires with all-pending rows', () => {
    const store = seedStoreWithCanonicalTasks();
    store.setAgentTasks([
      {
        id: 'install',
        title: 'pnpm add @amplitude/unified',
        status: 'pending',
      },
      {
        id: 'init',
        title: 'Initialize SDK in src/main.tsx',
        status: 'pending',
      },
      { id: 'wire', title: 'Wire signup track call', status: 'pending' },
    ]);

    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    // Heading uses the pre-start voice (everything still pending).
    expect(frame).toMatch(/the agent is planning to:/);
    // Voice rules: never SHOUTY.
    expect(frame).not.toMatch(/\bTODOS\b/);
    expect(frame).not.toMatch(/\bTASKS\b/);
    // Each task title renders verbatim.
    expect(frame).toContain('pnpm add @amplitude/unified');
    expect(frame).toContain('Initialize SDK in src/main.tsx');
    expect(frame).toContain('Wire signup track call');
  });

  it('switches to "the agent\'s plan" heading and reflects in_progress / done as the agent transitions rows', () => {
    const store = seedStoreWithCanonicalTasks();
    store.setAgentTasks([
      { id: 'install', title: 'pnpm add @amplitude/unified', status: 'done' },
      {
        id: 'init',
        title: 'Initialize SDK in src/main.tsx',
        status: 'in_progress',
      },
      { id: 'wire', title: 'Wire signup track call', status: 'pending' },
    ]);

    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    // Settled-plan heading.
    expect(frame).toMatch(/the agent's plan:/);
    // All three rows still visible after the transition.
    expect(frame).toContain('pnpm add @amplitude/unified');
    expect(frame).toContain('Initialize SDK in src/main.tsx');
    expect(frame).toContain('Wire signup track call');
    // Done rows render with ✓.
    expect(frame).toMatch(/✓.*pnpm add @amplitude\/unified/);
  });

  it('reflects each transition when updateAgentTask patches a single row', () => {
    const store = seedStoreWithCanonicalTasks();
    store.setAgentTasks([
      { id: 'a', title: 'task a', status: 'pending' },
      { id: 'b', title: 'task b', status: 'pending' },
    ]);

    // State 1: nothing started yet.
    let r = render(<RunScreen store={store} />);
    let frame = stripAnsi(r.lastFrame() ?? '');
    r.unmount();
    expect(frame).toMatch(/the agent is planning to:/);

    // State 2: task a now in progress.
    store.updateAgentTask('a', { status: 'in_progress' });
    r = render(<RunScreen store={store} />);
    frame = stripAnsi(r.lastFrame() ?? '');
    r.unmount();
    expect(frame).toMatch(/the agent's plan:/);

    // State 3: task a done, task b in progress.
    store.updateAgentTask('a', { status: 'done' });
    store.updateAgentTask('b', { status: 'in_progress' });
    r = render(<RunScreen store={store} />);
    frame = stripAnsi(r.lastFrame() ?? '');
    r.unmount();
    expect(frame).toMatch(/the agent's plan:/);
    expect(frame).toMatch(/✓.*task a/);
  });

  it('coexists with the canonical wizard task list — both render together', () => {
    const store = seedStoreWithCanonicalTasks();
    store.setAgentTasks([
      { id: 'a', title: 'agent task one', status: 'in_progress' },
    ]);

    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    // The canonical 4-step list is still present (renders either the
    // label "Install Amplitude" or the in-progress activeForm
    // "Installing Amplitude" depending on row status).
    expect(frame).toMatch(/Install(ing)? Amplitude/);
    expect(frame).toContain('Wire up event tracking');
    // The agent list is also present.
    expect(frame).toContain('agent task one');
    expect(frame).toMatch(/the agent's plan:/);
  });
});
