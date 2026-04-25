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
  const detect = await runDetect(installDir);
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
    installDir,
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

// ── projects list ───────────────────────────────────────────────────

export interface ProjectChoice {
  /** Numeric Amplitude app ID — the canonical selector. */
  appId: string;
  /** Pre-built one-line label for picker rendering. */
  label: string;
  /** Breadcrumb description: "Org > Workspace > Env". */
  description: string;
  orgId: string;
  orgName: string;
  workspaceId: string;
  workspaceName: string;
  envName: string;
  rank: number;
  /** Per-choice resume flags: `['--app-id', appId]`. */
  resumeFlags: string[];
}

export interface ProjectsListResult {
  /** All choices matching the query (pre-pagination). */
  total: number;
  /** Choices included in this response (after query + pagination). */
  returned: number;
  /** Choice page. */
  choices: ProjectChoice[];
  /** Original query string, echoed back for pagination cursor reasoning. */
  query: string | null;
  /**
   * When set, the call was non-fatally limited (e.g. user not logged in).
   * Callers should surface as a `log` event, not an error.
   */
  warning?: string;
}

export interface ProjectsListInput {
  /** Optional case-insensitive substring match across label fields. */
  query?: string;
  /** Page size. Defaults to 25, capped at 200. */
  limit?: number;
  /** Page offset. Defaults to 0. */
  offset?: number;
}

/**
 * List the authenticated user's accessible Amplitude projects/environments,
 * one row per (org, workspace, env) tuple that has an API key. Powers the
 * `projects list --agent --query <q>` command, which the
 * `environment_selection` `needs_input` event references via
 * `pagination.nextCommand` so outer agents can hand a search box to humans
 * without dumping 500-row lists into context.
 *
 * Reads the cached OAuth token + zone from `~/.ampli.json`; returns a
 * warning instead of throwing when the user is logged out so the CLI can
 * still emit a useful NDJSON envelope.
 */
export async function runProjectsList(
  input: ProjectsListInput = {},
): Promise<ProjectsListResult> {
  const limit = Math.max(1, Math.min(input.limit ?? 25, 200));
  const offset = Math.max(0, input.offset ?? 0);
  const query = input.query?.trim().toLowerCase() ?? null;

  const user = getStoredUser();
  if (!user || user.id === 'pending') {
    return {
      total: 0,
      returned: 0,
      choices: [],
      query,
      warning: 'Not logged in. Run `npx @amplitude/wizard login` first.',
    };
  }
  const stored = getStoredToken(user.id, user.zone);
  if (!stored?.idToken) {
    return {
      total: 0,
      returned: 0,
      choices: [],
      query,
      warning:
        'No stored Amplitude id_token. Run `npx @amplitude/wizard login` first.',
    };
  }

  const { fetchAmplitudeUser } = await import('./api.js');
  const userInfo = await fetchAmplitudeUser(stored.idToken, user.zone);

  // Flatten orgs/workspaces/environments to one choice per (env with apiKey).
  const allChoices: ProjectChoice[] = [];
  for (const org of userInfo.orgs) {
    for (const ws of org.workspaces) {
      const envs = (ws.environments ?? [])
        .filter((e) => e.app?.apiKey)
        .sort((a, b) => a.rank - b.rank);
      for (const env of envs) {
        const appId = env.app?.id ?? '';
        if (!appId) continue;
        allChoices.push({
          appId,
          label: `${org.name} / ${ws.name} / ${env.name}`,
          description: `${org.name} > ${ws.name} > ${env.name}`,
          orgId: org.id,
          orgName: org.name,
          workspaceId: ws.id,
          workspaceName: ws.name,
          envName: env.name,
          rank: env.rank,
          resumeFlags: ['--app-id', appId],
        });
      }
    }
  }

  // Filter by query — match across every label field, case-insensitive.
  const matching = query
    ? allChoices.filter((c) => {
        const haystack = [
          c.label,
          c.appId,
          c.orgName,
          c.workspaceName,
          c.envName,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
    : allChoices;

  // Stable sort by rank then label so pagination is deterministic across
  // calls — outer agents that walk pages depend on consistent ordering.
  matching.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));

  const page = matching.slice(offset, offset + limit);
  return {
    total: matching.length,
    returned: page.length,
    choices: page,
    query,
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
