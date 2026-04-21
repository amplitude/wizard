/**
 * createDashboardStep — POSTs to Thunder's `/wizard/v1/dashboards` endpoint
 * after the agent finishes instrumentation, then stores the returned URL +
 * warnings on the session so OutroScreen can render them.
 *
 * Replaces the previous in-agent MCP loop that called `create_chart` /
 * `create_dashboard` and wrote `.amplitude-dashboard.json`.
 *
 * Design notes:
 * - Idempotency key is a UUIDv4 persisted on the session checkpoint. Retries
 *   and crash-restarts reuse the same key; rotation happens only via an
 *   explicit user-triggered re-run (e.g. the `/dashboard` slash command —
 *   follow-up PR).
 * - Terminal failures keep the agent run successful: the outro still renders
 *   and we log the error code but do not surface a crashing UX.
 * - 401 responses are handled here (not in the API helper) because only the
 *   caller knows how to fetch a fresh token via stored refresh credentials.
 */

import { randomUUID } from 'crypto';

import { traceStep } from '../telemetry';
import { analytics, captureWizardError } from '../utils/analytics';
import { getUI } from '../ui';
import { logToFile } from '../utils/debug';
import {
  ApiError,
  createWizardDashboard,
  type CreateWizardDashboardRequest,
  type CreateWizardDashboardResult,
  type WizardDashboardErrorCode,
} from '../lib/api';
import type { AmplitudeZone } from '../lib/constants';
import type { WizardSession } from '../lib/wizard-session';
import { saveCheckpoint } from '../lib/session-checkpoint';

export interface CreateDashboardStepResult {
  dashboardUrl: string | null;
  skipped: boolean;
}

export async function createDashboardStep(args: {
  session: WizardSession;
  events: Array<{ name: string; description?: string }>;
  accessToken: string;
  zone: AmplitudeZone;
}): Promise<CreateDashboardStepResult> {
  const { session, events, accessToken, zone } = args;

  return traceStep('create-dashboard', async () => {
    // ── Short-circuits ─────────────────────────────────────────────────
    if (events.length === 0) {
      logToFile('[create-dashboard] no events — skipping');
      return { dashboardUrl: null, skipped: true };
    }
    if (!session.credentials?.appId) {
      logToFile('[create-dashboard] no appId — skipping');
      return { dashboardUrl: null, skipped: true };
    }
    if (!session.selectedOrgId) {
      logToFile('[create-dashboard] no orgId — skipping');
      return { dashboardUrl: null, skipped: true };
    }

    // ── Idempotency key: reuse or generate, persist before network ─────
    if (!session.dashboardIdempotencyKey) {
      session.dashboardIdempotencyKey = randomUUID();
      try {
        saveCheckpoint(session);
      } catch (err) {
        // Non-fatal — the key is still in-memory and retries within this run
        // will reuse it. Crash recovery without checkpoint just rolls a new key.
        logToFile(
          `[create-dashboard] checkpoint write failed (continuing): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const body: CreateWizardDashboardRequest = {
      orgId: session.selectedOrgId,
      appId: String(session.credentials.appId),
      product: {
        name:
          session.selectedEnvName ??
          session.selectedWorkspaceName ??
          'Wizard App',
        framework: session.integration ?? 'generic',
      },
      events: events.map((e) => ({
        name: e.name,
        description: e.description,
      })),
      autocaptureEnabled: session.autocaptureEnabled === true,
    };

    // ── First attempt, with 401 silent-refresh retry ───────────────────
    try {
      const result = await createWizardDashboard(
        accessToken,
        zone,
        body,
        session.dashboardIdempotencyKey,
      );
      return applySuccess(session, body, result);
    } catch (err) {
      if (!(err instanceof ApiError)) {
        recordFailure(err);
        return { dashboardUrl: null, skipped: true };
      }

      // 401 → attempt silent refresh + single retry with fresh token.
      if (err.code === 'UNAUTHENTICATED' || err.statusCode === 401) {
        const refreshed = await tryRefreshOnce();
        if (refreshed) {
          try {
            const result = await createWizardDashboard(
              refreshed,
              zone,
              body,
              session.dashboardIdempotencyKey,
            );
            return applySuccess(session, body, result);
          } catch (retryErr) {
            recordFailure(retryErr);
            return { dashboardUrl: null, skipped: true };
          }
        }
        recordFailure(err);
        return { dashboardUrl: null, skipped: true };
      }

      // IDEMPOTENCY_CONFLICT: if the server returned the same dashboardId we
      // already stored, treat as a success. Otherwise surface.
      if (err.code === 'IDEMPOTENCY_CONFLICT' && session.dashboardId) {
        logToFile(
          `[create-dashboard] IDEMPOTENCY_CONFLICT — treating as success (cached id: ${session.dashboardId})`,
        );
        if (session.dashboardUrl) {
          getUI().setDashboardUrl(session.dashboardUrl);
        }
        return { dashboardUrl: session.dashboardUrl, skipped: false };
      }

      recordFailure(err);
      return { dashboardUrl: null, skipped: true };
    }
  });
}

function applySuccess(
  session: WizardSession,
  request: CreateWizardDashboardRequest,
  result: CreateWizardDashboardResult,
): CreateDashboardStepResult {
  session.dashboardId = result.dashboard.id;
  session.dashboardUrl = result.dashboard.url;
  session.dashboardWarnings = result.warnings;
  try {
    saveCheckpoint(session);
  } catch (err) {
    logToFile(
      `[create-dashboard] post-success checkpoint failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  getUI().setDashboardUrl(result.dashboard.url);

  const chartCount = result.charts.filter((c) => !c.skipped).length;
  analytics.wizardCapture('dashboard created', {
    'dashboard id': result.dashboard.id,
    'chart count': chartCount,
    'warning codes': result.warnings.map((w) => w.code),
    framework: request.product.framework,
    autocapture: request.autocaptureEnabled,
  });

  return { dashboardUrl: result.dashboard.url, skipped: false };
}

function recordFailure(err: unknown): void {
  const apiError = err instanceof ApiError ? err : null;
  const code: WizardDashboardErrorCode | 'UNKNOWN' =
    (apiError?.code as WizardDashboardErrorCode | undefined) ?? 'UNKNOWN';
  const httpStatus = apiError?.statusCode ?? null;
  const message = err instanceof Error ? err.message : String(err);

  captureWizardError('Dashboard Creation', message, 'create-dashboard-step', {
    'error code': code,
    'http status': httpStatus,
  });
  analytics.wizardCapture('dashboard create failed', {
    'error code': code,
    'http status': httpStatus,
  });
  logToFile(
    `[create-dashboard] failed (${code}${
      httpStatus !== null ? `, HTTP ${httpStatus}` : ''
    }): ${message}`,
  );
}

/**
 * Attempt a silent OAuth token refresh using stored credentials. Returns the
 * new access token on success, null on any failure (stored token missing,
 * refresh RPC failed, etc.). Mirrors the silent-refresh block in
 * `agent-runner.ts` but is scoped to this step.
 */
async function tryRefreshOnce(): Promise<string | null> {
  try {
    const { getStoredToken, getStoredUser, storeToken } = await import(
      '../utils/ampli-settings.js'
    );
    const { refreshAccessToken } = await import('../utils/oauth.js');
    const user = getStoredUser();
    const stored = getStoredToken(user?.id, user?.zone);
    if (!stored?.refreshToken || !user) return null;
    const refreshed = await refreshAccessToken(stored.refreshToken, user.zone);
    storeToken(user, {
      accessToken: refreshed.accessToken,
      idToken: refreshed.idToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
    });
    return refreshed.accessToken;
  } catch (err) {
    logToFile(
      `[create-dashboard] silent token refresh failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}
