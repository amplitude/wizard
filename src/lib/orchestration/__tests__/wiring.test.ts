/**
 * Wiring tests — beachhead-widening (PR 4).
 *
 * These tests exercise the centralized `record*Choice` /
 * `record*Verification` / `answer*` helpers against an isolated
 * orchestration store. The actual TUI/CLI callsites that use these
 * helpers are tested elsewhere (where we can inject the relevant
 * screen / command harness); here we verify the helpers themselves
 * produce the right shape.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getOrchestrationStore, _resetOrchestrationStoreCache } from '../store';
import {
  recordAppConfirmationChoice,
  recordMcpInstallChoice,
  recordSlackSetupChoice,
  recordDashboardSetupChoice,
  recordEventPlanRevisionChoice,
  recordRegionSelectionChoice,
  recordProjectCreationChoice,
  recordAuthRetryChoice,
  recordDataIngestionVerification,
  recordDashboardCorrectnessVerification,
  recordOauthBrowserLoginVerification,
  recordExcalidrawFlowVerification,
  recordManualPrTestVerification,
  answerChoice,
  answerChoiceByPromptId,
} from '../wiring';
import { ChoiceStatus } from '../checkpoints/choices';
import { VerificationStatus } from '../checkpoints/verifications';

let installDir: string;
let originalCacheDir: string | undefined;

beforeEach(() => {
  installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-'));
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

function seed(): void {
  const store = getOrchestrationStore(installDir);
  store.createSession({ goal: 'test session' });
}

describe('wiring helpers — Choices', () => {
  it('returns null when no active session has been created', () => {
    const id = recordMcpInstallChoice({
      installDir,
      client: 'Cursor',
      detectedCount: 1,
    });
    expect(id).toBeNull();
  });

  it('records app_confirmation Choice with deterministic promptId', () => {
    seed();
    const id = recordAppConfirmationChoice({
      installDir,
      orgName: 'Acme',
      projectName: 'Web',
      envName: 'Production',
      appId: 12345,
    });
    expect(id).not.toBeNull();
    const c = getOrchestrationStore(installDir).getChoice(id!);
    expect(c).toBeDefined();
    expect(c!.kind).toBe('other');
    expect(c!.promptId).toBe('app_confirmation:12345');
    expect(c!.requiresHuman).toBe(true);
    expect(c!.options.map((o) => o.id)).toEqual(['continue', 'switch']);
  });

  it('records mcp_install Choice per-client and dedups by promptId', () => {
    seed();
    const id1 = recordMcpInstallChoice({
      installDir,
      client: 'Claude Code',
      detectedCount: 2,
    });
    const id2 = recordMcpInstallChoice({
      installDir,
      client: 'Claude Code',
      detectedCount: 2,
    });
    expect(id1).toBe(id2); // de-duped to existing pending
    const all = getOrchestrationStore(installDir).listChoices({
      kind: 'mcp_install',
    });
    expect(all).toHaveLength(1);
  });

  it('mcp_install records distinct entries for distinct clients', () => {
    seed();
    recordMcpInstallChoice({ installDir, client: 'Cursor', detectedCount: 2 });
    recordMcpInstallChoice({
      installDir,
      client: 'Codex',
      detectedCount: 2,
    });
    const all = getOrchestrationStore(installDir).listChoices({
      kind: 'mcp_install',
    });
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.promptId).sort()).toEqual([
      'mcp_install:codex',
      'mcp_install:cursor',
    ]);
  });

  it('records slack_setup Choice keyed on region', () => {
    seed();
    const id = recordSlackSetupChoice({ installDir, region: 'eu' });
    const c = getOrchestrationStore(installDir).getChoice(id!);
    expect(c!.promptId).toBe('slack_setup:eu');
    expect(c!.kind).toBe('slack_setup');
  });

  it('records dashboard_setup Choice with auto/manual variants', () => {
    seed();
    const auto = recordDashboardSetupChoice({ installDir, trigger: 'auto' });
    const manual = recordDashboardSetupChoice({
      installDir,
      trigger: 'manual',
    });
    expect(auto).not.toBe(manual);
    const all = getOrchestrationStore(installDir).listChoices({
      kind: 'dashboard_setup',
    });
    expect(all).toHaveLength(2);
  });

  it('records event_plan_revision Choice keyed on rejected plan hash', () => {
    seed();
    const id = recordEventPlanRevisionChoice({
      installDir,
      rejectedPlanHash: 'abc123',
      feedback: 'Too few events',
    });
    const c = getOrchestrationStore(installDir).getChoice(id!);
    expect(c!.kind).toBe('event_plan_revision');
    expect(c!.whyAsking).toContain('Too few events');
  });

  it('records region_selection Choice via environment_selection kind', () => {
    seed();
    const id = recordRegionSelectionChoice({
      installDir,
      candidates: [
        { id: 'us', label: 'US' },
        { id: 'eu', label: 'EU' },
      ],
      source: 'screen',
    });
    const c = getOrchestrationStore(installDir).getChoice(id!);
    expect(c!.kind).toBe('environment_selection');
    expect(c!.promptId).toBe('region_selection:screen');
    expect(c!.options.map((o) => o.id)).toEqual(['us', 'eu']);
  });

  it('records project_creation Choice with source-keyed promptId', () => {
    seed();
    const id = recordProjectCreationChoice({
      installDir,
      suggestedName: 'My Project',
      source: 'slash',
    });
    const c = getOrchestrationStore(installDir).getChoice(id!);
    expect(c!.message).toContain('My Project');
    expect(c!.promptId).toBe('project_creation:slash');
  });

  it('records auth_retry Choice with reason-keyed promptId', () => {
    seed();
    const id = recordAuthRetryChoice({ installDir, reason: 'logout' });
    const c = getOrchestrationStore(installDir).getChoice(id!);
    expect(c!.kind).toBe('auth_retry');
    expect(c!.promptId).toBe('auth_retry:logout');
    expect(c!.recommendedOptionId).toBe('cancel');
  });
});

describe('wiring helpers — Verifications', () => {
  it('records events_arriving_in_amplitude verification', () => {
    seed();
    const id = recordDataIngestionVerification({
      installDir,
      approvedEventCount: 3,
    });
    expect(id).not.toBeNull();
    const v = getOrchestrationStore(installDir)
      .listVerifications()
      .find((x) => x.id === id);
    expect(v!.kind).toBe('events_arriving_in_amplitude');
    expect(v!.whatToVerify).toContain('3 approved event');
  });

  it('records dashboard_correctness verification with commandToRun', () => {
    seed();
    const id = recordDashboardCorrectnessVerification({
      installDir,
      dashboardUrl: 'https://app.amplitude.com/abc',
    });
    const v = getOrchestrationStore(installDir)
      .listVerifications()
      .find((x) => x.id === id);
    expect(v!.kind).toBe('dashboard_correctness');
    expect(v!.commandToRun).toEqual(['open', 'https://app.amplitude.com/abc']);
  });

  it('records oauth_browser_login verification', () => {
    seed();
    const id = recordOauthBrowserLoginVerification({
      installDir,
      loginUrl: 'https://auth.amplitude.com/?…',
    });
    const v = getOrchestrationStore(installDir)
      .listVerifications()
      .find((x) => x.id === id);
    expect(v!.kind).toBe('oauth_browser_login');
  });

  it('records excalidraw_flow verification', () => {
    seed();
    const id = recordExcalidrawFlowVerification({
      installDir,
      whatToVerify: 'Open the demo and confirm signup tracks',
    });
    const v = getOrchestrationStore(installDir)
      .listVerifications()
      .find((x) => x.id === id);
    expect(v!.kind).toBe('excalidraw_flow');
  });

  it('records manual_pr_test verification with PR number', () => {
    seed();
    const id = recordManualPrTestVerification({ installDir, prNumber: 42 });
    const v = getOrchestrationStore(installDir)
      .listVerifications()
      .find((x) => x.id === id);
    expect(v!.kind).toBe('manual_pr_test');
    expect(v!.blockingPRNumber).toBe(42);
  });
});

describe('answerChoice / answerChoiceByPromptId', () => {
  it('answers a Choice by id', () => {
    seed();
    const id = recordAuthRetryChoice({ installDir, reason: 'login' });
    const answered = answerChoice(installDir, id!, 'confirm', 'human');
    expect(answered!.status).toBe(ChoiceStatus.Answered);
    expect(answered!.answeredOptionId).toBe('confirm');
    expect(answered!.answeredBy).toBe('human');
  });

  it('answers a Choice by promptId', () => {
    seed();
    recordSlackSetupChoice({ installDir, region: 'us' });
    const answered = answerChoiceByPromptId(
      installDir,
      'slack_setup:us',
      'skip',
      'human',
    );
    expect(answered!.status).toBe(ChoiceStatus.Answered);
    expect(answered!.answeredOptionId).toBe('skip');
  });

  it('returns null when no pending Choice matches the promptId', () => {
    seed();
    const result = answerChoiceByPromptId(installDir, 'unknown:x', 'a');
    expect(result).toBeNull();
  });
});

describe('anti-nag invariant', () => {
  it('re-recording an mcp_install Choice with the same promptId returns the existing pending one', () => {
    seed();
    const first = recordMcpInstallChoice({
      installDir,
      client: 'Cursor',
      detectedCount: 1,
    });
    // Simulate re-entering the same flow (e.g. McpScreen re-mount).
    const second = recordMcpInstallChoice({
      installDir,
      client: 'Cursor',
      detectedCount: 1,
    });
    expect(second).toBe(first);
    // Answer it as `skip`.
    answerChoiceByPromptId(installDir, 'mcp_install:cursor', 'skip', 'human');
    // After it's answered, a new record IS allowed (it's no longer pending).
    const third = recordMcpInstallChoice({
      installDir,
      client: 'Cursor',
      detectedCount: 1,
    });
    expect(third).not.toBe(first);
    const all = getOrchestrationStore(installDir).listChoices({
      kind: 'mcp_install',
    });
    // Only one pending at any moment.
    const pending = all.filter((c) => c.status === ChoiceStatus.Pending);
    expect(pending).toHaveLength(1);
  });
});

describe('verification mark-passed wiring contract', () => {
  it('a recorded events_arriving_in_amplitude verification can be marked passed', () => {
    seed();
    const vid = recordDataIngestionVerification({
      installDir,
      approvedEventCount: 1,
    });
    const store = getOrchestrationStore(installDir);
    const v = store.listVerifications().find((x) => x.id === vid)!;
    store.markVerificationStatus(
      v.id as `verif_${string}`,
      VerificationStatus.Passed,
    );
    const after = store.listVerifications().find((x) => x.id === vid);
    expect(after!.status).toBe(VerificationStatus.Passed);
  });
});

describe('events_arriving_in_amplitude dedup on re-confirmation', () => {
  it('supersedes the prior pending verification when re-recorded for the same session', () => {
    seed();
    // Initial 13-event plan.
    const firstId = recordDataIngestionVerification({
      installDir,
      approvedEventCount: 13,
    });
    // User revised to a 10-event plan and `confirm_event_plan` fired
    // again. Only the latest should remain pending.
    const secondId = recordDataIngestionVerification({
      installDir,
      approvedEventCount: 10,
    });
    expect(firstId).not.toBeNull();
    expect(secondId).not.toBeNull();
    expect(secondId).not.toBe(firstId);

    const store = getOrchestrationStore(installDir);
    const all = store.listVerifications({
      kind: 'events_arriving_in_amplitude',
    });
    expect(all).toHaveLength(2);

    const first = all.find((v) => v.id === firstId)!;
    const second = all.find((v) => v.id === secondId)!;
    expect(first.status).toBe(VerificationStatus.Superseded);
    expect(second.status).toBe(VerificationStatus.Pending);
    expect(second.whatToVerify).toContain('10 approved event');

    const pending = store.listVerifications({
      kind: 'events_arriving_in_amplitude',
      status: VerificationStatus.Pending,
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(secondId);
  });

  it('findPendingVerification returns the active row and ignores superseded ones', () => {
    seed();
    const store = getOrchestrationStore(installDir);
    const session = store.currentSession()!;

    recordDataIngestionVerification({ installDir, approvedEventCount: 5 });
    recordDataIngestionVerification({ installDir, approvedEventCount: 7 });

    const found = store.findPendingVerification(
      'events_arriving_in_amplitude',
      session.id,
    );
    expect(found).toBeDefined();
    expect(found!.status).toBe(VerificationStatus.Pending);
    expect(found!.whatToVerify).toContain('7 approved event');
  });

  it('returns undefined from findPendingVerification when no match exists', () => {
    seed();
    const store = getOrchestrationStore(installDir);
    const session = store.currentSession()!;
    expect(
      store.findPendingVerification('events_arriving_in_amplitude', session.id),
    ).toBeUndefined();
  });
});
