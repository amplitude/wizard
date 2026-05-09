/**
 * StatusOverlayScreen — glyph + lifecycle vocabulary tests.
 *
 * Pins the v2 PR 5 redesign: every primary surface shares the
 * lifecycle glyph palette, the mode badge surfaces in plain operator
 * mode, and the summary line resolves correctly per session state.
 */
import React from 'react';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { StatusOverlayScreen } from '../StatusOverlayScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';
import {
  getOrchestrationStore,
  _resetOrchestrationStoreCache,
} from '../../../../lib/orchestration/store.js';
import { ChoiceKind } from '../../../../lib/orchestration/checkpoints/choices.js';
import { TaskLifecycle } from '../../../../lib/orchestration/lifecycle.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-overlay-glyph-'));
  process.env.AMPLITUDE_WIZARD_CACHE_DIR = path.join(tmpDir, '.cache');
  delete process.env.CLAUDECODE;
  delete process.env.CLAUDE_CODE_ENTRYPOINT;
  delete process.env.AMPLITUDE_WIZARD_AGENT_MODE;
  delete process.env.AMPLITUDE_WIZARD_CI;
  delete process.env.AMPLITUDE_WIZARD_MCP_SERVE;
  delete process.env.AMPLITUDE_WIZARD_ALLOW_NESTED;
  delete process.env.CI;
  _resetOrchestrationStoreCache();
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('StatusOverlayScreen — glyph palette', () => {
  it('renders the running glyph when a task is running', () => {
    const orch = getOrchestrationStore(tmpDir);
    const session = orch.createSession({ goal: 'glyph test' });
    const task = orch.createTask({
      label: 'Detect framework',
      sessionId: session.id,
    });
    orch.transitionTask(task.id, TaskLifecycle.Running);

    const store = makeStoreForSnapshot({ installDir: tmpDir });
    const { frame } = renderSnapshot(
      <StatusOverlayScreen store={store} />,
      store,
    );
    expect(frame).toContain('›'); // running glyph
    expect(frame).toContain('Running');
    expect(frame).toContain('Detect framework');
  });

  it('renders the waiting glyph when a task is waiting on a user', () => {
    const orch = getOrchestrationStore(tmpDir);
    const session = orch.createSession({ goal: 'glyph test' });
    const task = orch.createTask({
      label: 'Approve event plan',
      sessionId: session.id,
    });
    orch.transitionTask(task.id, TaskLifecycle.Running);
    orch.transitionTask(task.id, TaskLifecycle.WaitingForUser);

    const store = makeStoreForSnapshot({ installDir: tmpDir });
    const { frame } = renderSnapshot(
      <StatusOverlayScreen store={store} />,
      store,
    );
    expect(frame).toContain('…'); // waiting glyph
    expect(frame).toContain('Waiting');
  });

  it('renders the blocked glyph when a task is blocked', () => {
    const orch = getOrchestrationStore(tmpDir);
    const session = orch.createSession({ goal: 'glyph test' });
    const task = orch.createTask({
      label: 'Auth check',
      sessionId: session.id,
    });
    orch.transitionTask(task.id, TaskLifecycle.Running);
    orch.transitionTask(task.id, TaskLifecycle.Blocked);

    const store = makeStoreForSnapshot({ installDir: tmpDir });
    const { frame } = renderSnapshot(
      <StatusOverlayScreen store={store} />,
      store,
    );
    expect(frame).toContain('⏸'); // blocked glyph
    expect(frame).toContain('Blocked');
  });
});

describe('StatusOverlayScreen — summary headline', () => {
  it('summary points to pending choices when a choice is pending', () => {
    const orch = getOrchestrationStore(tmpDir);
    const session = orch.createSession({ goal: 'summary test' });
    orch.addChoice({
      kind: ChoiceKind.EventPlanApproval,
      promptId: 'event_plan_approval:1',
      message: 'Approve the event plan?',
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'skip', label: 'Skip' },
      ],
      recommendedOptionId: 'approve',
      safeDefaultOptionId: 'skip',
      requiresHuman: true,
      automationAllowed: false,
      consequenceIfSkipped: 'No events.',
      reversible: true,
      whyAsking: 'Plan needs human review.',
      resumeCommand: ['npx', '@amplitude/wizard'],
      linkedSessionId: session.id,
    });

    const store = makeStoreForSnapshot({ installDir: tmpDir });
    const { frame } = renderSnapshot(
      <StatusOverlayScreen store={store} />,
      store,
    );
    expect(frame).toMatch(/Waiting on 1 choice/);
  });

  it('summary points to no active session when none exists', () => {
    const store = makeStoreForSnapshot({ installDir: tmpDir });
    const { frame } = renderSnapshot(
      <StatusOverlayScreen store={store} />,
      store,
    );
    expect(frame).toContain('No active session');
  });
});

describe('StatusOverlayScreen — mode badge', () => {
  it('shows the agent badge when AMPLITUDE_WIZARD_AGENT_MODE=1', () => {
    process.env.AMPLITUDE_WIZARD_AGENT_MODE = '1';
    const store = makeStoreForSnapshot({ installDir: tmpDir });
    const { frame } = renderSnapshot(
      <StatusOverlayScreen store={store} />,
      store,
    );
    expect(frame).toContain('agent');
  });

  it('shows the nested badge when CLAUDECODE=1', () => {
    process.env.CLAUDECODE = '1';
    const store = makeStoreForSnapshot({ installDir: tmpDir });
    const { frame } = renderSnapshot(
      <StatusOverlayScreen store={store} />,
      store,
    );
    expect(frame).toContain('nested');
  });
});
