/**
 * Resilience regression — token-expired-during-long-task.
 *
 * Brief requires: when the agent runner catches an auth error mid-stream,
 *   1. create a `Choice` record kind=`keep_or_revert_files`,
 *   2. create a `Verification` record kind=`manual_pr_test`,
 *   3. `wizard status --json` reports `waitingForUser: true` with the
 *      right choiceKind (i.e. there's a pending choice referenced by the
 *      LSP).
 *
 * The helper this test exercises lives inline in `agent-runner.ts`, but
 * the side-effects all go through `OrchestrationStore` — and the LSP +
 * status envelope are computed off the store. We seed the store the same
 * way `agent-runner` does on AUTH_ERROR, then assert the externally
 * visible shape.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getOrchestrationStore, _resetOrchestrationStoreCache } from '../store';
import { ChoiceStatus } from '../checkpoints/choices';
import { VerificationStatus } from '../checkpoints/verifications';
import { buildStatusEnvelope } from '../envelopes';

let installDir: string;
let originalCacheDir: string | undefined;

beforeEach(() => {
  installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-resilience-'));
  originalCacheDir = process.env.AMPLITUDE_WIZARD_CACHE_DIR;
  process.env.AMPLITUDE_WIZARD_CACHE_DIR = path.join(installDir, '.cache');
  _resetOrchestrationStoreCache();
});
afterEach(() => {
  if (originalCacheDir === undefined) {
    delete process.env.AMPLITUDE_WIZARD_CACHE_DIR;
  } else {
    process.env.AMPLITUDE_WIZARD_CACHE_DIR = originalCacheDir;
  }
  fs.rmSync(installDir, { recursive: true, force: true });
});

/**
 * Minimal reproduction of the auth-error mirror logic in
 * `agent-runner.ts`. If you change the agent-runner side, change this
 * too — they MUST stay in sync.
 */
function simulateAuthErrorMirror(installDir: string): void {
  const orch = getOrchestrationStore(installDir);
  const orchSession = orch.currentSession();
  if (!orchSession) throw new Error('test must seed an active session first');

  const promptId = `keep_or_revert_files:${orchSession.id}`;
  if (!orch.findPendingChoice(promptId)) {
    orch.addChoice({
      kind: 'keep_or_revert_files',
      promptId,
      message:
        'Authentication expired during the run. Keep the changes the wizard wrote, or revert?',
      options: [
        {
          id: 'keep',
          label: 'Keep changes (default)',
        },
        {
          id: 'revert',
          label: 'Revert every file the wizard touched',
        },
      ],
      recommendedOptionId: 'keep',
      safeDefaultOptionId: 'keep',
      requiresHuman: true,
      automationAllowed: false,
      consequenceIfSkipped: 'Default = keep.',
      reversible: true,
      whyAsking: 'Auth expired mid-stream.',
      resumeCommand: ['npx', '@amplitude/wizard'],
      linkedSessionId: orchSession.id,
    });
  }
  // Mirror the production guard: skip if a pending manual_pr_test
  // verification already exists for this session so duplicate AUTH_ERROR
  // fires don't produce duplicate ribbon rows.
  const existingPrTest = orch.listVerifications({
    sessionId: orchSession.id,
    kind: 'manual_pr_test',
    status: 'pending',
  });
  if (existingPrTest.length === 0) {
    orch.addVerification({
      kind: 'manual_pr_test',
      whatToVerify:
        'Confirm the instrumentation the wizard wrote behaves as expected.',
      expectedBehavior:
        'Events show up in Amplitude after a fresh deploy / dev-server restart.',
      blockingSessionId: orchSession.id,
      resumeCommand: ['npx', '@amplitude/wizard'],
    });
  }
}

describe('auth-error resilience mirror', () => {
  it('records a keep_or_revert_files Choice (requiresHuman + recommended=keep)', () => {
    const orch = getOrchestrationStore(installDir);
    orch.createSession({ goal: 'Set up Amplitude' });
    simulateAuthErrorMirror(installDir);

    const choices = orch.listChoices({ status: ChoiceStatus.Pending });
    expect(choices).toHaveLength(1);
    const c = choices[0];
    expect(c.kind).toBe('keep_or_revert_files');
    expect(c.requiresHuman).toBe(true);
    expect(c.recommendedOptionId).toBe('keep');
    expect(c.safeDefaultOptionId).toBe('keep');
    expect(c.options.map((o) => o.id)).toEqual(['keep', 'revert']);
  });

  it('records a manual_pr_test Verification', () => {
    const orch = getOrchestrationStore(installDir);
    orch.createSession({ goal: 'Set up Amplitude' });
    simulateAuthErrorMirror(installDir);

    const verifications = orch.listVerifications({
      status: VerificationStatus.Pending,
    });
    expect(verifications).toHaveLength(1);
    expect(verifications[0].kind).toBe('manual_pr_test');
  });

  it('is idempotent across duplicate AUTH_ERROR fires (no double-Choice)', () => {
    const orch = getOrchestrationStore(installDir);
    orch.createSession({ goal: 'Set up Amplitude' });
    simulateAuthErrorMirror(installDir);
    simulateAuthErrorMirror(installDir);

    const choices = orch.listChoices({ status: ChoiceStatus.Pending });
    expect(choices).toHaveLength(1);
  });

  it('is idempotent across duplicate AUTH_ERROR fires (no double-Verification)', () => {
    const orch = getOrchestrationStore(installDir);
    orch.createSession({ goal: 'Set up Amplitude' });
    simulateAuthErrorMirror(installDir);
    simulateAuthErrorMirror(installDir);

    const verifications = orch.listVerifications({
      status: VerificationStatus.Pending,
      kind: 'manual_pr_test',
    });
    expect(verifications).toHaveLength(1);
  });

  it('wizard status envelope reports the pending choice in lastStoppingPoint', () => {
    const orch = getOrchestrationStore(installDir);
    orch.createSession({ goal: 'Set up Amplitude' });
    simulateAuthErrorMirror(installDir);

    const envelope = buildStatusEnvelope({ installDir });
    const lsp = envelope.lastStoppingPoint;
    expect(lsp.pendingChoices.length).toBeGreaterThan(0);
    // The LSP routes nextAction to await_user_choice when a pending
    // choice is present without an explicit waiting task.
    expect(lsp.nextAction.kind).toBe('await_user_choice');
  });

  it('wizard status envelope reports the pending verification', () => {
    const orch = getOrchestrationStore(installDir);
    orch.createSession({ goal: 'Set up Amplitude' });
    simulateAuthErrorMirror(installDir);

    const envelope = buildStatusEnvelope({ installDir });
    const lsp = envelope.lastStoppingPoint;
    expect(lsp.pendingManualVerifications.length).toBeGreaterThan(0);
  });
});
