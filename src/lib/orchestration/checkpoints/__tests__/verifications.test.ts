/**
 * Verification schema, status transitions, and store-level CRUD tests.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OrchestrationStore, _resetOrchestrationStoreCache } from '../../store';
import {
  VerificationKind,
  VerificationStatus,
  VerificationSchema,
  IllegalVerificationTransitionError,
  canTransitionVerification,
  asVerificationId,
} from '../verifications';

let cacheRoot: string;
let installDir: string;

beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'orch-verif-'));
  installDir = mkdtempSync(join(tmpdir(), 'orch-verif-install-'));
  process.env.AMPLITUDE_WIZARD_CACHE_DIR = cacheRoot;
  _resetOrchestrationStoreCache();
});

afterEach(() => {
  rmSync(cacheRoot, { recursive: true, force: true });
  rmSync(installDir, { recursive: true, force: true });
  delete process.env.AMPLITUDE_WIZARD_CACHE_DIR;
  _resetOrchestrationStoreCache();
});

describe('VerificationSchema — round-trip', () => {
  it('parses a valid record and rejects bad ids', () => {
    const valid = {
      id: 'verif_xyz789',
      kind: VerificationKind.EventsArrivingInAmplitude,
      whatToVerify: 'Confirm events arrive',
      commandToRun: ['open', 'https://app.amplitude.com'],
      expectedBehavior: 'Live event stream shows events',
      status: VerificationStatus.Pending,
      blockingTaskId: null,
      blockingPRNumber: null,
      blockingSessionId: 'session_abc',
      unblockerHint: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      resumeCommand: ['wizard', 'verification', 'mark', '<id>'],
    };
    expect(VerificationSchema.parse(valid)).toBeDefined();
    expect(() =>
      VerificationSchema.parse({ ...valid, id: 'task_x' }),
    ).toThrow();
  });
});

describe('Verification status transitions', () => {
  it('legal arcs', () => {
    expect(
      canTransitionVerification(
        VerificationStatus.Pending,
        VerificationStatus.Passed,
      ),
    ).toBe(true);
    expect(
      canTransitionVerification(
        VerificationStatus.Pending,
        VerificationStatus.Failed,
      ),
    ).toBe(true);
    expect(
      canTransitionVerification(
        VerificationStatus.Pending,
        VerificationStatus.Skipped,
      ),
    ).toBe(true);
    expect(
      canTransitionVerification(
        VerificationStatus.Failed,
        VerificationStatus.Passed,
      ),
    ).toBe(true);
    expect(
      canTransitionVerification(
        VerificationStatus.Skipped,
        VerificationStatus.Passed,
      ),
    ).toBe(true);
  });

  it('illegal arcs', () => {
    // No transition out of superseded.
    expect(
      canTransitionVerification(
        VerificationStatus.Superseded,
        VerificationStatus.Passed,
      ),
    ).toBe(false);
    // No identity transition.
    expect(
      canTransitionVerification(
        VerificationStatus.Pending,
        VerificationStatus.Pending,
      ),
    ).toBe(false);
    // Passed cannot regress to failed (must supersede first).
    expect(
      canTransitionVerification(
        VerificationStatus.Passed,
        VerificationStatus.Failed,
      ),
    ).toBe(false);
  });
});

describe('OrchestrationStore — verification CRUD', () => {
  it('addVerification + listVerifications + getVerification round-trip', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const v = store.addVerification({
      kind: VerificationKind.DashboardCorrectness,
      whatToVerify: 'Review the dashboard',
      expectedBehavior: 'All charts render',
      blockingSessionId: session.id,
      resumeCommand: ['wizard'],
    });
    expect(v.id).toMatch(/^verif_/);
    expect(store.getVerification(asVerificationId(v.id))?.id).toBe(v.id);
    expect(store.listVerifications()).toHaveLength(1);
  });

  it('markVerificationStatus enforces the transition validator', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const v = store.addVerification({
      kind: VerificationKind.OauthBrowserLogin,
      whatToVerify: 'Confirm sign-in',
      expectedBehavior: 'Tokens stored',
      blockingSessionId: session.id,
      resumeCommand: ['wizard', 'login'],
    });
    const passed = store.markVerificationStatus(
      asVerificationId(v.id),
      VerificationStatus.Passed,
    );
    expect(passed.status).toBe(VerificationStatus.Passed);
    expect(passed.completedAt).not.toBeNull();

    // passed -> failed is illegal (must supersede first).
    expect(() =>
      store.markVerificationStatus(
        asVerificationId(v.id),
        VerificationStatus.Failed,
      ),
    ).toThrow(IllegalVerificationTransitionError);
  });

  it('listVerifications filters by sessionId / status / kind', () => {
    const store = new OrchestrationStore(installDir);
    const s1 = store.createSession({ goal: 'first' });
    const s2 = store.createSession({ goal: 'second' });
    store.addVerification({
      kind: VerificationKind.EventPlanReview,
      whatToVerify: 'review plan',
      expectedBehavior: 'plan correct',
      blockingSessionId: s1.id,
      resumeCommand: [],
    });
    const v2 = store.addVerification({
      kind: VerificationKind.ManualPrTest,
      whatToVerify: 'open PR',
      expectedBehavior: 'CI green',
      blockingSessionId: s2.id,
      resumeCommand: [],
    });
    store.markVerificationStatus(
      asVerificationId(v2.id),
      VerificationStatus.Passed,
    );
    expect(store.listVerifications({ sessionId: s1.id })).toHaveLength(1);
    expect(
      store.listVerifications({ status: VerificationStatus.Passed }),
    ).toHaveLength(1);
    expect(
      store.listVerifications({ kind: VerificationKind.ManualPrTest }),
    ).toHaveLength(1);
  });
});
