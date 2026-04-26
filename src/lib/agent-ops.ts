/**
 * agent-ops — Pure business logic for agent-mode verbs.
 *
 * These functions power `amplitude-wizard detect | status | auth token | auth status`.
 * They return serializable data so thin CLI wrappers can emit JSON (for agents)
 * or format for humans with the same underlying source of truth.
 *
 * No UI, no process.exit, no console.log — keeps the logic testable and reusable
 * from both the CLI and the future external MCP server.
 */

import path from 'path';
import { detectAllFrameworks } from '../run';
import {
  detectAmplitudeInProject,
  type AmplitudeDetectionResult,
} from './detect-amplitude';
import { readApiKeyWithSource } from '../utils/api-key-store';
import {
  getStoredUser,
  getStoredToken,
  type StoredUser,
} from '../utils/ampli-settings';
import { FRAMEWORK_REGISTRY } from './registry';
import { Integration } from './constants';
import {
  createAndPersistPlan,
  loadPlan,
  type WizardPlan,
  type LoadPlanResult,
  type FileChange,
} from './agent-plans.js';

// ── detect ──────────────────────────────────────────────────────────

export interface DetectResult {
  integration: Integration | null;
  frameworkName: string | null;
  confidence: 'detected' | 'none';
  signals: Array<{
    integration: Integration;
    detected: boolean;
    durationMs: number;
    timedOut: boolean;
    error?: string;
  }>;
}

export async function runDetect(installDir: string): Promise<DetectResult> {
  const results = await detectAllFrameworks(installDir);
  const hit = results.find((r) => r.detected);
  const integration = hit?.integration ?? null;
  const frameworkName = integration
    ? FRAMEWORK_REGISTRY[integration].metadata.name
    : null;
  return {
    integration,
    frameworkName,
    confidence: integration ? 'detected' : 'none',
    signals: results.map(
      ({ integration, detected, durationMs, timedOut, error }) => ({
        integration,
        detected,
        durationMs,
        timedOut,
        ...(error ? { error } : {}),
      }),
    ),
  };
}

// ── status ──────────────────────────────────────────────────────────

export interface StatusResult {
  installDir: string;
  framework: {
    integration: Integration | null;
    name: string | null;
  };
  amplitudeInstalled: AmplitudeDetectionResult;
  apiKey: {
    configured: boolean;
    source: 'keychain' | 'env' | null;
  };
  auth: {
    loggedIn: boolean;
    email: string | null;
    zone: string | null;
  };
}

export async function runStatus(installDir: string): Promise<StatusResult> {
  const [detect, amplitudeInstalled] = await Promise.all([
    runDetect(installDir),
    Promise.resolve(detectAmplitudeInProject(installDir)),
  ]);

  const apiKey = readApiKeyWithSource(installDir);
  const user = getStoredUser();
  const hasToken = user ? Boolean(getStoredToken(user.id, user.zone)) : false;

  return {
    installDir,
    framework: {
      integration: detect.integration,
      name: detect.frameworkName,
    },
    amplitudeInstalled,
    apiKey: {
      configured: Boolean(apiKey),
      source: apiKey?.source ?? null,
    },
    auth: {
      loggedIn: Boolean(user && hasToken && user.id !== 'pending'),
      email: user?.email ?? null,
      zone: user?.zone ?? null,
    },
  };
}

// ── auth token ──────────────────────────────────────────────────────

export interface AuthTokenResult {
  token: string | null;
  expiresAt: string | null;
  zone: string | null;
}

export function getAuthToken(): AuthTokenResult {
  const user = getStoredUser();
  if (!user || user.id === 'pending') {
    return { token: null, expiresAt: null, zone: null };
  }
  const stored = getStoredToken(user.id, user.zone);
  if (!stored) {
    return { token: null, expiresAt: null, zone: user.zone };
  }
  return {
    token: stored.accessToken,
    expiresAt: stored.expiresAt,
    zone: user.zone,
  };
}

// ── auth status ─────────────────────────────────────────────────────

export interface AuthStatusResult {
  loggedIn: boolean;
  user: Pick<StoredUser, 'email' | 'firstName' | 'lastName' | 'zone'> | null;
  tokenExpiresAt: string | null;
}

// ── plan ────────────────────────────────────────────────────────────

export interface PlanResult {
  plan: WizardPlan;
  /** True when a framework was detected; false on Generic fallback. */
  detected: boolean;
}

/**
 * Run the planning phase of the wizard: detect framework, gather any
 * pre-existing event hints (e.g. from `.amplitude-events.json`), persist a
 * `WizardPlan` to disk, and return it for the caller to emit as NDJSON.
 *
 * No agent run, no file writes outside the plans directory. Outer agents
 * inspect the returned plan and decide whether to call `apply`.
 */
export async function runPlan(installDir: string): Promise<PlanResult> {
  // Resolve to an absolute path before anything else — including before
  // persistence. A relative `installDir` (e.g. `.` or `./my-project`)
  // resolves against the *plan-time* cwd and that resolution must be
  // baked into the persisted plan; otherwise `apply` re-resolves against
  // its own (possibly-different) cwd and the run lands in the wrong dir.
  const resolvedInstallDir = path.resolve(installDir);
  const detect = await runDetect(resolvedInstallDir);
  const integration = detect.integration;

  // Map integration → SDK package. The FrameworkConfig.detection block
  // already tracks the canonical npm/pip/etc package name the wizard cares
  // about, so we surface that here. (FrameworkConfig has no per-framework
  // "init file" field today; surfacing concrete file paths is a follow-up
  // once the three-phase Planner/Integrator split lands.)
  const sdk =
    integration && FRAMEWORK_REGISTRY[integration]
      ? FRAMEWORK_REGISTRY[integration].detection.packageName
      : null;

  // File-change hints are intentionally empty until the Planner phase can
  // emit them. Outer agents see `events: []` and `fileChanges: []` and
  // know the plan is detection-only; the real list arrives during `apply`
  // via inner-agent lifecycle events (Gap 2 PR).
  const fileChanges: FileChange[] = [];

  const plan = createAndPersistPlan({
    installDir: resolvedInstallDir,
    framework: integration ?? 'generic',
    frameworkName: detect.frameworkName,
    sdk,
    events: [],
    fileChanges,
  });

  return { plan, detected: integration !== null };
}

/** Resolve a plan by ID with structured error reporting for the CLI layer. */
export async function resolvePlan(planId: string): Promise<LoadPlanResult> {
  return loadPlan(planId);
}

// ── verify ──────────────────────────────────────────────────────────

export interface VerifyResult {
  installDir: string;
  framework: {
    integration: Integration | null;
    name: string | null;
  };
  amplitudeInstalled: AmplitudeDetectionResult;
  apiKeyConfigured: boolean;
  /**
   * Summary of the verification outcome. `pass` when SDK is installed AND
   * an API key is configured; otherwise `fail` with structured reasons.
   */
  outcome: 'pass' | 'fail';
  failures: string[];
}

/**
 * Lightweight verification step. Mirrors the checks the wizard runs at the
 * end of an `apply` to confirm the install landed: SDK package present,
 * API key configured, framework still detected.
 *
 * Real ingestion verification (events flowing into the project) requires
 * an authenticated MCP call and is gated by the existing `pollForDataIngestion`
 * helper in `agent-runner.ts`. This op is the cheap, no-network version
 * outer agents can call between `apply` and ingestion polling.
 */
export async function runVerify(installDir: string): Promise<VerifyResult> {
  const status = await runStatus(installDir);
  const failures: string[] = [];

  if (status.amplitudeInstalled.confidence === 'none') {
    failures.push('amplitude SDK is not installed in the project');
  }
  if (!status.apiKey.configured) {
    failures.push('amplitude API key is not configured');
  }
  if (!status.framework.integration) {
    failures.push('no framework detected (cannot validate setup)');
  }

  return {
    installDir,
    framework: status.framework,
    amplitudeInstalled: status.amplitudeInstalled,
    apiKeyConfigured: status.apiKey.configured,
    outcome: failures.length === 0 ? 'pass' : 'fail',
    failures,
  };
}

export function getAuthStatus(): AuthStatusResult {
  const user = getStoredUser();
  if (!user || user.id === 'pending') {
    return { loggedIn: false, user: null, tokenExpiresAt: null };
  }
  const stored = getStoredToken(user.id, user.zone);
  return {
    loggedIn: Boolean(stored),
    user: {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      zone: user.zone,
    },
    tokenExpiresAt: stored?.expiresAt ?? null,
  };
}
