/**
 * createDashboardStep — post-agent step that creates charts and a dashboard
 * via the wizard proxy (`POST /dashboards`), with bounded latency and visible
 * progress.
 *
 * Dashboard creation previously used an MCP sub-agent loop
 * (`create_chart` + `create_dashboard`). That path is replaced by a single
 * Thunder RPC aligned with the instrumented event plan.
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';

import {
  ApiError,
  createWizardDashboard,
  type CreateWizardDashboardResult,
} from '../lib/api.js';
import {
  parseEventPlanContent,
  readLocalEventPlan,
} from '../lib/event-plan-parser.js';
import { resolveZone } from '../lib/zone-resolution';
import { DEFAULT_AMPLITUDE_ZONE, Integration } from '../lib/constants.js';
import { getUI } from '../ui';
import { analytics } from '../utils/analytics';
import { logToFile } from '../utils/debug';
import { persistDashboard } from '../lib/wizard-tools';
import { getDashboardFile } from '../utils/storage-paths';
import type { WizardSession } from '../lib/wizard-session';

/** Legacy dashboard dotfile — read-only fallback for older runs. */
const LEGACY_DASHBOARD_FILE = '.amplitude-dashboard.json';

/** Client timeout slightly above Thunder's dashboard RPC ceiling. */
const DASHBOARD_TIMEOUT_MS = 36_000;

interface EventsFile {
  events: Array<{ name: string; description: string }>;
}

const DashboardFileSchema = z.object({
  dashboardUrl: z.string().url(),
  dashboardId: z.string().optional(),
  charts: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().optional(),
        type: z.string().optional(),
      }),
    )
    .optional(),
});

type DashboardResult = z.infer<typeof DashboardFileSchema>;

export interface CreateDashboardStepArgs {
  session: WizardSession;
  accessToken: string;
  integration: Integration;
}

export const STEP_ID = 'create-dashboard';

function tryApplyDashboardJourney(status: 'in_progress' | 'completed'): void {
  try {
    getUI().applyJourneyTransition('dashboard', status);
  } catch {
    /* Journey transitions are best-effort outside InkUI */
  }
}

function autocaptureLikelyEnabled(integration: Integration): boolean {
  switch (integration) {
    case Integration.nextjs:
    case Integration.vue:
    case Integration.reactRouter:
    case Integration.javascript_web:
      return true;
    default:
      return false;
  }
}

/**
 * Run the dashboard creation step. Never throws — on failure or timeout,
 * logs a warning and returns. The wizard run still succeeds; users see a
 * "create a dashboard manually" note in the outro.
 */
export async function createDashboardStep(
  args: CreateDashboardStepArgs,
): Promise<void> {
  const { session, accessToken, integration } = args;
  const ui = getUI();
  ui.setPostAgentStep(STEP_ID, { status: 'in_progress' });

  const legacyDashboardPath = path.join(
    session.installDir,
    LEGACY_DASHBOARD_FILE,
  );
  const canonicalDashboardPath = getDashboardFile(session.installDir);

  const events = readEventsForDashboard(session.installDir);
  if (!events) {
    logToFile(
      `[createDashboard] skipping — no valid event plan under .amplitude/ (or legacy dotfile)`,
    );
    analytics.wizardCapture('dashboard skipped', {
      integration,
      reason: 'no events file',
    });
    tryApplyDashboardJourney('completed');
    ui.setPostAgentStep(STEP_ID, {
      status: 'skipped',
      reason: 'no events to chart',
    });
    return;
  }

  const existing =
    readExistingDashboardFile(canonicalDashboardPath) ??
    readExistingDashboardFile(legacyDashboardPath);
  if (existing) {
    logToFile(
      `[createDashboard] reusing dashboard already on disk: ${existing.dashboardUrl}`,
    );
    persistDashboard(session.installDir, existing);
    session.checklistDashboardUrl = existing.dashboardUrl;
    ui.setDashboardUrl(existing.dashboardUrl);
    tryApplyDashboardJourney('completed');
    analytics.wizardCapture('dashboard created', {
      integration,
      'chart count': existing.charts?.length ?? 0,
      'duration ms': 0,
      source: 'cached',
    });
    ui.setPostAgentStep(STEP_ID, { status: 'completed' });
    return;
  }

  const orgId = session.selectedOrgId?.trim();
  const appId = session.selectedAppId?.trim();
  if (!orgId || !appId) {
    logToFile(
      `[createDashboard] skipping — missing orgId or appId (orgId=${Boolean(
        orgId,
      )} appId=${Boolean(appId)})`,
    );
    analytics.wizardCapture('dashboard skipped', {
      integration,
      reason: 'missing org or app',
    });
    tryApplyDashboardJourney('completed');
    ui.setPostAgentStep(STEP_ID, {
      status: 'skipped',
      reason: 'Amplitude project not fully selected',
    });
    return;
  }

  session.dashboardFallbackPhase = 'in_progress';
  tryApplyDashboardJourney('in_progress');
  ui.pushStatus('Creating your analytics dashboard');
  const spinner = ui.spinner();
  spinner.start('Creating charts and dashboard in Amplitude…');

  const startedAt = Date.now();
  let result: DashboardResult | CreateWizardDashboardResult | null = null;
  let unexpectedError: unknown = null;

  const controller = new AbortController();
  const abortTimer = setTimeout(() => {
    logToFile(
      `[createDashboard] aborting — hit ${DASHBOARD_TIMEOUT_MS}ms ceiling`,
    );
    try {
      ui.pushStatus('Dashboard step is taking too long — wrapping up…');
    } catch {
      /* best-effort */
    }
    controller.abort();
  }, DASHBOARD_TIMEOUT_MS);

  try {
    try {
      const zone = resolveZone(session, DEFAULT_AMPLITUDE_ZONE, {
        readDisk: true,
      });
      const productName =
        session.selectedProjectName?.trim() ||
        path.basename(session.installDir);
      const apiResult = await createWizardDashboard(
        accessToken,
        zone,
        {
          orgId,
          appId,
          product: {
            name: productName,
            framework: integration,
          },
          events: events.events.map((e) => ({
            name: e.name,
            ...(e.description ? { description: e.description } : {}),
          })),
          autocaptureEnabled: autocaptureLikelyEnabled(integration),
        },
        { signal: controller.signal },
      );
      result = apiResult;
    } catch (err) {
      unexpectedError = err;
      if (err instanceof ApiError) {
        logToFile(
          `[createDashboard] API error: ${err.code ?? ''} ${err.message}`,
        );
      } else {
        logToFile(
          `[createDashboard] unexpected error: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    const durationMs = Date.now() - startedAt;

    if (!result) {
      let spinnerMessage: string;
      let warnMessage: string;
      let reason: string;
      if (unexpectedError) {
        spinnerMessage = 'Dashboard step failed — skipping';
        warnMessage =
          'Amplitude is configured, but the wizard could not create a starter dashboard via the server. Open app.amplitude.com to create one manually.';
        reason =
          unexpectedError instanceof ApiError
            ? unexpectedError.code ?? 'api error'
            : 'unexpected error';
      } else if (durationMs >= DASHBOARD_TIMEOUT_MS) {
        spinnerMessage = 'Dashboard step timed out — skipping';
        warnMessage = `Amplitude is configured, but the wizard could not create a starter dashboard within ${
          DASHBOARD_TIMEOUT_MS / 1000
        } seconds. Open app.amplitude.com to create one manually.`;
        reason = 'timeout';
      } else {
        spinnerMessage = 'Dashboard step skipped';
        warnMessage =
          'Amplitude is configured, but the wizard could not create a starter dashboard. Open app.amplitude.com to create one manually.';
        reason = 'empty response';
      }
      spinner.stop(spinnerMessage);
      ui.log.warn(warnMessage);
      analytics.wizardCapture('dashboard failed', {
        integration,
        reason,
        'duration ms': durationMs,
      });
      tryApplyDashboardJourney('completed');
      ui.setPostAgentStep(STEP_ID, { status: 'skipped', reason });
      return;
    }

    persistDashboard(
      session.installDir,
      result as unknown as Record<string, unknown>,
    );

    session.checklistDashboardUrl = result.dashboardUrl;
    ui.setDashboardUrl(result.dashboardUrl);
    spinner.stop('Dashboard ready');
    tryApplyDashboardJourney('completed');
    ui.setPostAgentStep(STEP_ID, { status: 'completed' });
    analytics.wizardCapture('dashboard created', {
      integration,
      'chart count': result.charts?.length ?? 0,
      'duration ms': durationMs,
      source: 'wizard-proxy',
    });
  } finally {
    clearTimeout(abortTimer);
    session.dashboardFallbackPhase = 'completed';
  }
}

function readExistingDashboardFile(
  dashboardPath: string,
): DashboardResult | null {
  if (!fs.existsSync(dashboardPath)) return null;
  try {
    const content = fs.readFileSync(dashboardPath, 'utf8');
    const parsed = DashboardFileSchema.parse(JSON.parse(content));
    if (!parsed.dashboardUrl) return null;
    return parsed;
  } catch (err) {
    logToFile(
      `[createDashboard] existing ${dashboardPath} unusable, will recreate: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

export const __test__ = {
  readEventsFromContent,
};

function readEventsFromContent(content: string): EventsFile | null {
  const events = parseEventPlanContent(content);
  if (!events) return null;
  const filtered = events
    .filter((e) => e.name.trim().length > 0)
    .map((e) => ({ ...e, name: e.name.trim() }));
  if (filtered.length === 0) return null;
  return { events: filtered };
}

function readEventsForDashboard(installDir: string): EventsFile | null {
  const raw = readLocalEventPlan(installDir);
  if (raw.length === 0) return null;
  const filtered = raw
    .filter((e) => e.name.trim().length > 0)
    .map((e) => ({ ...e, name: e.name.trim() }));
  if (filtered.length === 0) {
    logToFile(
      `[createDashboard] event plan under ${installDir} had no usable events`,
    );
    return null;
  }
  return { events: filtered };
}
