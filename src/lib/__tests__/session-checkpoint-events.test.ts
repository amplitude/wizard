/**
 * Regression tests for the checkpoint NDJSON emission added in PR F.
 *
 * The wizard's checkpoint helpers (saveCheckpoint, loadCheckpoint,
 * clearCheckpoint) drive a 3-event public contract:
 *
 *   - `checkpoint_saved`   on every successful write
 *   - `checkpoint_loaded`  on every successful restore
 *   - `checkpoint_cleared` on every successful unlink
 *
 * Orchestrators rely on the full triple to know whether `--resume`
 * is meaningful for a rerun, so each emission is locked behind a
 * regression test pinning the discriminator + payload shape.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
} from '../session-checkpoint';
import {
  CACHE_ROOT_OVERRIDE_ENV,
  getCheckpointFile,
} from '../../utils/storage-paths';
import { setUI, getUI } from '../../ui';
import type { WizardSession } from '../wizard-session';

function makeSession(installDir: string): WizardSession {
  // Minimal stub — only the fields saveCheckpoint actually reads.
  return {
    installDir,
    debug: false,
    verbose: false,
    forceInstall: false,
    ci: false,
    agent: false,
    signup: false,
    signupEmail: null,
    signupFullName: null,
    localMcp: false,
    menu: false,
    benchmark: false,
    mode: 'standard',
    orchestratorContext: null,
    agentSessionId: 'test-session',
    setupConfirmed: false,
    integration: null,
    frameworkContext: {},
    frameworkContextAnswerOrder: [],
    typescript: false,
    detectedFrameworkLabel: null,
    detectionComplete: false,
    detectionResults: null,
    projectHasData: null,
    activationLevel: null,
    activationOptionsComplete: false,
    snippetConfigured: false,
    region: 'us',
    regionForced: false,
    runPhase: 'idle',
    runStartedAt: null,
    discoveredFeatures: [],
    llmOptIn: false,
    sessionReplayOptIn: false,
    engagementOptIn: false,
    loggingOut: false,
    mcpComplete: false,
    mcpOutcome: null,
    mcpInstalledClients: [],
    slackComplete: false,
    slackOutcome: null,
    pendingOrgs: null,
    pendingAuthIdToken: null,
    pendingAuthAccessToken: null,
    scopeFilterMismatch: null,
    selectedOrgId: 'org-1',
    selectedOrgName: 'Acme',
    selectedProjectId: 'proj-1',
    selectedProjectName: 'Demo',
    selectedEnvName: 'Production',
    selectedAppId: '12345',
    loginUrl: null,
    credentials: null,
    apiKeyNotice: null,
    serviceStatus: null,
    retryState: null,
    outroData: null,
    introConcluded: false,
    requiresAccountConfirmation: false,
    additionalFeatureQueue: [],
    additionalFeatureCurrent: null,
    additionalFeatureCompleted: [],
    optInFeaturesComplete: false,
    frameworkConfig: null,
    amplitudePreDetected: false,
    amplitudePreDetectedChoicePending: false,
    dataIngestionConfirmed: false,
    checklistDashboardUrl: null,
    userEmail: null,
    _restoredFromCheckpoint: false,
    tosAccepted: null,
    emailCaptureComplete: false,
    createProject: { pending: false, source: null, suggestedName: null },
    eventPlan: null,
    eventIngestionDetected: null,
  } as unknown as WizardSession;
}

describe('checkpoint NDJSON emissions', () => {
  let cacheDir: string;
  let installDir: string;
  let prevCacheRoot: string | undefined;
  let savedSpy: ReturnType<typeof vi.fn>;
  let loadedSpy: ReturnType<typeof vi.fn>;
  let clearedSpy: ReturnType<typeof vi.fn>;
  let prevUI: ReturnType<typeof getUI>;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckpt-events-'));
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckpt-events-pj-'));
    prevCacheRoot = process.env[CACHE_ROOT_OVERRIDE_ENV];
    process.env[CACHE_ROOT_OVERRIDE_ENV] = cacheDir;

    savedSpy = vi.fn();
    loadedSpy = vi.fn();
    clearedSpy = vi.fn();
    prevUI = getUI();
    // Stub UI: only the three checkpoint emitters need to record.
    setUI({
      ...prevUI,
      emitCheckpointSaved: savedSpy,
      emitCheckpointLoaded: loadedSpy,
      emitCheckpointCleared: clearedSpy,
    } as unknown as typeof prevUI);
  });

  afterEach(() => {
    setUI(prevUI);
    if (prevCacheRoot === undefined) {
      delete process.env[CACHE_ROOT_OVERRIDE_ENV];
    } else {
      process.env[CACHE_ROOT_OVERRIDE_ENV] = prevCacheRoot;
    }
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  it('saveCheckpoint emits checkpoint_saved with the supplied phase', () => {
    saveCheckpoint(makeSession(installDir), 'screen_run');
    expect(savedSpy).toHaveBeenCalledTimes(1);
    const arg = savedSpy.mock.calls[0][0] as {
      path: string;
      bytes: number;
      phase: string;
    };
    expect(arg.phase).toBe('screen_run');
    expect(arg.bytes).toBeGreaterThan(0);
    expect(arg.path).toBe(getCheckpointFile(installDir));
  });

  it('saveCheckpoint defaults the phase to "unknown" when no label supplied', () => {
    saveCheckpoint(makeSession(installDir));
    const arg = savedSpy.mock.calls[0][0] as { phase: string };
    expect(arg.phase).toBe('unknown');
  });

  it('saveCheckpoint never throws when the UI emit blows up', () => {
    setUI({
      ...prevUI,
      emitCheckpointSaved: () => {
        throw new Error('boom');
      },
    } as unknown as typeof prevUI);
    expect(() =>
      saveCheckpoint(makeSession(installDir), 'pre_compact'),
    ).not.toThrow();
    // The actual file should still have been written — telemetry MUST
    // never block the recovery snapshot.
    expect(fs.existsSync(getCheckpointFile(installDir))).toBe(true);
  });

  it('loadCheckpoint emits checkpoint_loaded with the file age', async () => {
    saveCheckpoint(makeSession(installDir), 'pre_compact');
    savedSpy.mockClear();

    const restored = await loadCheckpoint(installDir);
    expect(restored).not.toBeNull();
    expect(loadedSpy).toHaveBeenCalledTimes(1);
    const arg = loadedSpy.mock.calls[0][0] as {
      path: string;
      ageSeconds: number;
    };
    expect(arg.path).toBe(getCheckpointFile(installDir));
    // Just-saved checkpoint should be < 5s old in CI even on a slow box.
    expect(arg.ageSeconds).toBeLessThan(5);
  });

  it('loadCheckpoint stays silent when no checkpoint exists', async () => {
    const restored = await loadCheckpoint(installDir);
    expect(restored).toBeNull();
    expect(loadedSpy).not.toHaveBeenCalled();
  });

  it('clearCheckpoint emits checkpoint_cleared with reason discriminator', () => {
    saveCheckpoint(makeSession(installDir), 'pre_compact');
    expect(fs.existsSync(getCheckpointFile(installDir))).toBe(true);

    clearCheckpoint(installDir, 'logout');
    expect(clearedSpy).toHaveBeenCalledTimes(1);
    const arg = clearedSpy.mock.calls[0][0] as {
      path: string;
      reason: string;
    };
    expect(arg.reason).toBe('logout');
    expect(arg.path).toBe(getCheckpointFile(installDir));
  });

  it('clearCheckpoint defaults to reason="success"', () => {
    saveCheckpoint(makeSession(installDir), 'pre_compact');
    clearCheckpoint(installDir);
    const arg = clearedSpy.mock.calls[0][0] as { reason: string };
    expect(arg.reason).toBe('success');
  });

  it('clearCheckpoint stays silent when no checkpoint exists', () => {
    clearCheckpoint(installDir, 'manual');
    expect(clearedSpy).not.toHaveBeenCalled();
  });
});
