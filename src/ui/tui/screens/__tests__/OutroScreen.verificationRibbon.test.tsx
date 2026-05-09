/**
 * Regression — OutroScreen never shows "success" UI while the
 * orchestration store has a pending manual verification.
 *
 * Before PR 3, a successful agent run that left a verification pending
 * (e.g. a manual PR test) showed the green "Amplitude is live!" outro
 * with no hint that the user still owed something. The
 * ManualVerificationRibbon component renders inline in the outro and
 * surfaces every pending verification with its resume command.
 */
import React from 'react';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { OutroScreen } from '../OutroScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';
import { OutroKind } from '../../session-constants.js';
import {
  getOrchestrationStore,
  _resetOrchestrationStoreCache,
} from '../../../../lib/orchestration/store.js';
import {
  VerificationKind,
  VerificationStatus,
} from '../../../../lib/orchestration/checkpoints/verifications.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outro-verif-'));
  process.env.AMPLITUDE_WIZARD_CACHE_DIR = path.join(tmpDir, '.cache');
  _resetOrchestrationStoreCache();
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('OutroScreen — pending manual verification ribbon', () => {
  it('renders a "Manual verification pending" banner when the store has a pending verification', () => {
    const orch = getOrchestrationStore(tmpDir);
    const session = orch.createSession({ goal: 'Test' });
    orch.addVerification({
      kind: VerificationKind.ManualPrTest,
      whatToVerify: 'Open the PR and verify the wizard charts populate',
      expectedBehavior: 'Charts render with first-day data',
      blockingSessionId: session.id,
      resumeCommand: ['npx', '@amplitude/wizard'],
    });

    // Mount the success outro on top of the seeded store.
    const store = makeStoreForSnapshot({
      installDir: tmpDir,
      outroData: {
        kind: OutroKind.Success,
        changes: ['Added Amplitude SDK to your app'],
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);

    expect(frame).toContain('Manual verification pending');
    expect(frame).toContain(
      'Open the PR and verify the wizard charts populate',
    );
  });

  it('renders nothing extra when the store has no pending verifications', () => {
    const store = makeStoreForSnapshot({
      installDir: tmpDir,
      outroData: {
        kind: OutroKind.Success,
        changes: ['Added Amplitude SDK to your app'],
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);

    expect(frame).not.toContain('Manual verification pending');
  });

  it('renders only the pending verification when a superseded one exists for the same kind', () => {
    // Regression for the events_arriving_in_amplitude dedup bug — a user
    // revising the event plan re-fires `confirm_event_plan`, which used
    // to leave both verifications pending and surface two ribbon rows.
    // After the fix the prior is superseded and only the latest renders.
    const orch = getOrchestrationStore(tmpDir);
    const session = orch.createSession({ goal: 'Test' });
    const stale = orch.addVerification({
      kind: VerificationKind.EventsArrivingInAmplitude,
      whatToVerify: 'Confirm Amplitude is receiving the 13 approved event(s).',
      expectedBehavior: 'Events arrive in the Live Event Stream.',
      blockingSessionId: session.id,
      resumeCommand: ['x'],
    });
    orch.markVerificationStatus(
      stale.id as `verif_${string}`,
      VerificationStatus.Superseded,
    );
    orch.addVerification({
      kind: VerificationKind.EventsArrivingInAmplitude,
      whatToVerify: 'Confirm Amplitude is receiving the 10 approved event(s).',
      expectedBehavior: 'Events arrive in the Live Event Stream.',
      blockingSessionId: session.id,
      resumeCommand: ['x'],
    });

    const store = makeStoreForSnapshot({
      installDir: tmpDir,
      outroData: { kind: OutroKind.Success, changes: [] },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);

    expect(frame).toContain('Manual verification pending');
    expect(frame).toContain('10 approved event');
    // The superseded 13-event row must not appear.
    expect(frame).not.toContain('13 approved event');
  });

  it('truncates with "+N more" when there are many pending verifications', () => {
    const orch = getOrchestrationStore(tmpDir);
    const session = orch.createSession({ goal: 'Test' });
    for (let i = 0; i < 5; i++) {
      orch.addVerification({
        kind: VerificationKind.ManualPrTest,
        whatToVerify: `Test artifact #${i}`,
        expectedBehavior: 'Pass',
        blockingSessionId: session.id,
        resumeCommand: ['x'],
      });
    }
    const store = makeStoreForSnapshot({
      installDir: tmpDir,
      outroData: { kind: OutroKind.Success, changes: [] },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Manual verification pending');
    expect(frame).toContain('more');
  });
});
