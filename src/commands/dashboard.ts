/**
 * `amplitude-wizard dashboard` — deferred chart/dashboard materialization.
 *
 * Reads the `dashboard-plan.json` artifact written by the main wizard run
 * (PR 2 / #583), waits for events to start landing in Amplitude, and then
 * spawns a small Claude agent loaded with the
 * `amplitude-chart-dashboard-plan` skill + Amplitude MCP server to materialize
 * the plan in the user's project (charts + dashboard).
 *
 * This command is the consumer side of the "defer dashboard creation"
 * refactor (DEFER_DASHBOARD_PLAN.md, PR 3). The main run does NOT yet write
 * the dashboard-plan.json automatically — that happens in PR 4. PR 3 only
 * makes the command available; it works on its own when invoked.
 *
 * Behavior:
 *   1. Resolve install dir (default: cwd).
 *   2. Read `<installDir>/.amplitude/dashboard-plan.json`. Missing → exit
 *      `INPUT_REQUIRED` with a "run the wizard first" hint.
 *   3. Resolve credentials (CI env-var path → stored OAuth → fall through).
 *   4. Poll Amplitude MCP `get_events` for ingestion. Default budget 5 min,
 *      configurable via `--ingestion-timeout-ms`. On timeout, exit clean
 *      (`SUCCESS`) with a "re-run in ~10 min" hint — this is the expected
 *      race condition, not a failure.
 *   5. Once events are flowing, hand the plan to a small Claude agent
 *      (skill + Amplitude MCP) and let it materialize charts + dashboard.
 *   6. On agent success: write `<installDir>/.amplitude/dashboard.json`
 *      (via `persistDashboard`) and print the URL.
 *   7. On agent failure: print the reason, exit `AGENT_FAILED`.
 *
 * Exit codes (from `src/lib/exit-codes.ts`):
 *   - SUCCESS (0)        — dashboard built OR ingestion timed out (re-run later)
 *   - INPUT_REQUIRED (12) — no plan present; user must run the wizard first
 *   - AUTH_REQUIRED (3)   — no credentials available
 *   - AGENT_FAILED (10)   — agent run failed materially
 */

import type { CommandModule } from 'yargs';
import { ExitCode, getUI } from './helpers';

/** 5 minutes — ingestion poll budget; the doc spec says ~5 min, configurable. */
const DEFAULT_INGESTION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Hard ceiling for the agent's chart/dashboard materialization run. Tighter
 * than the in-loop agent because this is a single, tightly-scoped task with
 * a fixed plan input — no event discovery, no instrumentation. 90s leaves
 * room for ~6 MCP write calls (one per chart + one create_dashboard) plus
 * a verify pass.
 */
const AGENT_MATERIALIZE_TIMEOUT_MS = 90_000;

export interface DashboardCommandDeps {
  readDashboardPlan: typeof import('../lib/dashboard-plan').readDashboardPlan;
  resolveCredentials: typeof import('../lib/credential-resolution').resolveCredentials;
  buildSession: typeof import('../lib/wizard-session').buildSession;
  fetchHasAnyEventsMcp: typeof import('../lib/api').fetchHasAnyEventsMcp;
  callAmplitudeMcp: typeof import('../lib/mcp-with-fallback').callAmplitudeMcp;
  persistDashboard: typeof import('../lib/wizard-tools').persistDashboard;
  getMcpUrlFromZone: typeof import('../utils/urls').getMcpUrlFromZone;
  decodeJwtZone: typeof import('../utils/jwt-exp').decodeJwtZone;
}

export interface DashboardCommandArgs {
  installDir: string;
  ingestionTimeoutMs: number;
  agentTimeoutMs?: number;
}

export interface DashboardCommandResult {
  exitCode: ExitCode;
  message: string;
  dashboardUrl?: string;
}

interface DashboardAgentResult {
  dashboardUrl: string;
  dashboardId?: string;
  charts?: Array<{ id?: string; title?: string; type?: string }>;
}

/**
 * Build the agent prompt. The agent reads the supplied plan and uses the
 * `amplitude-chart-dashboard-plan` skill (loaded by filesystem path inside
 * the agent run) plus Amplitude MCP write tools to materialize charts + a
 * dashboard. The marker convention matches `src/steps/create-dashboard.ts`
 * so the parser can stay consistent.
 */
export function buildDashboardAgentPrompt(
  plan: import('../lib/dashboard-plan').DashboardPlan,
): string {
  const planJson = JSON.stringify(plan, null, 2);
  return `You are creating an Amplitude dashboard from a pre-approved plan.

Load the \`amplitude-chart-dashboard-plan\` skill at \`.claude/skills/amplitude-chart-dashboard-plan/SKILL.md\` and follow its workflow. The skill describes how to call \`query_dataset\`, \`save_chart_edits\`, \`create_chart\`, \`create_dashboard\`, and verify the result via the Amplitude MCP server.

Input plan (JSON):
${planJson}

Use \`orgId=${plan.orgId}\` and \`projectId=${plan.projectId}\` for every MCP call that requires them.

When finished, output EXACTLY one line, JSON only, on its own line, like this:
<<<WIZARD_DASHBOARD_RESULT>>>{"dashboardUrl":"https://...","dashboardId":"...","charts":[{"id":"...","title":"...","type":"funnel"}]}<<<END>>>

Do not output anything after the result line. If a chart fails to create partway, still emit the result line with whatever charts succeeded and the dashboard URL if the dashboard was created. Never invent URLs — if no dashboard was created, omit the result line entirely.`;
}

/**
 * Parse the agent's text output for the dashboard result. Mirrors
 * `src/steps/create-dashboard.ts:parseAgentOutput` so behavior stays
 * consistent. Exported for unit testing.
 */
export function parseDashboardAgentOutput(
  text: string,
): DashboardAgentResult | null {
  const match = text.match(/<<<WIZARD_DASHBOARD_RESULT>>>([\s\S]*?)<<<END>>>/);
  const candidate = match ? match[1].trim() : null;
  if (candidate) {
    return safeParseDashboardJson(candidate);
  }
  // Fallback: agent forgot the markers. Find the first balanced JSON object
  // that contains `"dashboardUrl"`.
  const fallback = extractJsonContaining(text, '"dashboardUrl"');
  if (!fallback) return null;
  return safeParseDashboardJson(fallback);
}

function safeParseDashboardJson(json: string): DashboardAgentResult | null {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const dashboardUrl = parsed.dashboardUrl;
    if (typeof dashboardUrl !== 'string' || dashboardUrl.length === 0) {
      return null;
    }
    // Light URL-shape validation — same contract as the in-loop
    // `record_dashboard` tool's Zod schema. We don't `new URL()` parse here
    // to avoid a hard dependency on globalThis.URL in older Node targets;
    // the dashboard URL must be HTTP(S) and that's enough for our use.
    if (!/^https?:\/\//.test(dashboardUrl)) return null;
    const result: DashboardAgentResult = { dashboardUrl };
    if (typeof parsed.dashboardId === 'string') {
      result.dashboardId = parsed.dashboardId;
    }
    if (Array.isArray(parsed.charts)) {
      result.charts = parsed.charts.filter(
        (c): c is { id?: string; title?: string; type?: string } =>
          typeof c === 'object' && c !== null,
      );
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Scan `text` for a balanced `{...}` substring that contains `needle`.
 * Mirrors the helper in `src/steps/create-dashboard.ts` so brace-aware
 * parsing stays consistent across the deferred path and the legacy step.
 * Exported for unit testing.
 */
export function extractJsonContaining(
  text: string,
  needle: string,
): string | null {
  for (
    let start = text.indexOf('{');
    start !== -1;
    start = text.indexOf('{', start + 1)
  ) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          if (candidate.includes(needle)) return candidate;
          break;
        }
      }
    }
  }
  return null;
}

/**
 * Poll Amplitude MCP for event ingestion. Returns true once any event has
 * been received in the project, false on timeout.
 *
 * Mirrors `pollForDataIngestion` in `agent-runner.ts` but stripped to the
 * essentials a synchronous CLI command needs (no UI status pushes, no wizard
 * abort signal — `dashboard` is short-lived and we let SIGINT tear it down
 * naturally).
 */
export async function pollDashboardIngestion(args: {
  accessToken: string;
  appId: string;
  timeoutMs: number;
  fetchHasAnyEventsMcp: typeof import('../lib/api').fetchHasAnyEventsMcp;
  /** Override the polling delay schedule — tests pass `0` to spin fast. */
  pollIntervalMs?: number;
  /** Per-poll fetch timeout — tests pass `0` to skip the timer. */
  perPollTimeoutMs?: number;
  /** Optional logger so tests can assert on poll progress. */
  onPoll?: (info: { attempt: number; hasEvents: boolean }) => void;
}): Promise<{ ok: true; eventNames: string[] } | { ok: false }> {
  const {
    accessToken,
    appId,
    timeoutMs,
    fetchHasAnyEventsMcp,
    pollIntervalMs = 5_000,
    perPollTimeoutMs = 25_000,
    onPoll,
  } = args;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    const pollController = new AbortController();
    const pollTimer = perPollTimeoutMs
      ? setTimeout(() => pollController.abort(), perPollTimeoutMs)
      : null;
    let hasEvents = false;
    let eventNames: string[] = [];
    try {
      const result = await fetchHasAnyEventsMcp(
        accessToken,
        appId,
        pollController.signal,
      );
      hasEvents = result.hasEvents;
      eventNames = result.activeEventNames;
    } catch {
      // Swallow — fall through to the inter-poll wait.
    } finally {
      if (pollTimer) clearTimeout(pollTimer);
    }
    onPoll?.({ attempt, hasEvents });
    if (hasEvents) {
      return { ok: true, eventNames };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    if (pollIntervalMs > 0) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(pollIntervalMs, remaining)),
      );
    }
  }
  return { ok: false };
}

/**
 * Core handler — dependency-injected for testability. Each external moving
 * part (plan reader, credential resolver, MCP poller, agent loop, dashboard
 * persister) is supplied by the caller, so unit tests don't need to reach
 * into the network or the LLM gateway.
 *
 * The yargs `handler` below wires real implementations and process.exit;
 * tests call `runDashboardCommand` directly.
 */
export async function runDashboardCommand(
  args: DashboardCommandArgs,
  deps: DashboardCommandDeps,
): Promise<DashboardCommandResult> {
  const { installDir, ingestionTimeoutMs, agentTimeoutMs } = args;

  // 1. Read the plan. Missing/corrupt → exit cleanly with INPUT_REQUIRED.
  const plan = deps.readDashboardPlan(installDir);
  if (!plan) {
    return {
      exitCode: ExitCode.INPUT_REQUIRED,
      message:
        'No dashboard plan found. Run the wizard first to instrument events; ' +
        'the dashboard plan is written at end of plan phase.',
    };
  }

  // 2. Resolve credentials. Build a minimal session shell — buildSession
  //    handles installDir resolution, region detection, and the storage
  //    bootstrap; resolveCredentials populates `session.credentials` from
  //    stored OAuth (or the CI env-var path).
  const session = deps.buildSession({ installDir });
  await deps.resolveCredentials(session, { requireOrgId: false });
  if (!session.credentials) {
    return {
      exitCode: ExitCode.AUTH_REQUIRED,
      message:
        'No Amplitude credentials available. Run `npx @amplitude/wizard login` first, ' +
        'or set WIZARD_OAUTH_TOKEN + WIZARD_EXPIRES_AT for CI.',
    };
  }

  const accessToken = session.credentials.accessToken;
  // The plan's projectId is the numeric Amplitude app id (the key
  // `fetchHasAnyEventsMcp` and the chart/dashboard MCP tools expect).
  const appId = plan.projectId;

  // 3. Poll for ingestion. Timeout is treated as a clean exit, not a failure
  //    — events haven't reached Amplitude yet is the expected race.
  const ingestion = await pollDashboardIngestion({
    accessToken,
    appId,
    timeoutMs: ingestionTimeoutMs,
    fetchHasAnyEventsMcp: deps.fetchHasAnyEventsMcp,
  });
  if (!ingestion.ok) {
    return {
      exitCode: ExitCode.SUCCESS,
      message:
        "Events haven't reached Amplitude yet. " +
        'Re-run `npx @amplitude/wizard dashboard` in ~10 minutes.',
    };
  }

  // 4. Spawn the Claude agent (via the existing `callAmplitudeMcp` fallback
  //    path, which boots a small SDK subprocess with only Amplitude MCP
  //    configured) and parse the result.
  const accountZone = deps.decodeJwtZone(accessToken) ?? 'us';
  const mcpUrl = deps.getMcpUrlFromZone(accountZone);
  const prompt = buildDashboardAgentPrompt(plan);

  const agentBudgetMs = agentTimeoutMs ?? AGENT_MATERIALIZE_TIMEOUT_MS;
  const result = await deps.callAmplitudeMcp<DashboardAgentResult>({
    accessToken,
    mcpUrl,
    label: 'dashboardCommand',
    agentTimeoutMs: agentBudgetMs,
    agentPrompt: prompt,
    parseAgent: parseDashboardAgentOutput,
  });

  if (!result || !result.dashboardUrl) {
    return {
      exitCode: ExitCode.AGENT_FAILED,
      message:
        'Dashboard creation failed — the agent did not return a dashboard URL. ' +
        'Check the wizard log for details, or open app.amplitude.com to create one manually.',
    };
  }

  // 5. Persist `<installDir>/.amplitude/dashboard.json`. Best-effort; even
  //    if persist fails we still surface the URL because the agent already
  //    created the dashboard server-side.
  const persistPayload: Record<string, unknown> = {
    dashboardUrl: result.dashboardUrl,
  };
  if (result.dashboardId) persistPayload.dashboardId = result.dashboardId;
  if (result.charts) persistPayload.charts = result.charts;
  deps.persistDashboard(installDir, persistPayload);

  return {
    exitCode: ExitCode.SUCCESS,
    message: `Dashboard ready: ${result.dashboardUrl}`,
    dashboardUrl: result.dashboardUrl,
  };
}

export const dashboardCommand: CommandModule = {
  command: 'dashboard',
  describe:
    'Build the Amplitude dashboard described by .amplitude/dashboard-plan.json (deferred chart/dashboard creation)',
  builder: (yargs) =>
    yargs.options({
      'install-dir': {
        describe:
          'project directory containing the dashboard-plan.json artifact',
        type: 'string',
      },
      'ingestion-timeout-ms': {
        describe:
          'how long to wait for events to start landing in Amplitude before exiting clean (default: 5 min)',
        type: 'number',
        default: DEFAULT_INGESTION_TIMEOUT_MS,
      },
    }),
  handler: (argv) => {
    void (async () => {
      // Wire real implementations. Imports are dynamic so the command
      // module stays cheap to load (CLI startup parses argv before
      // dispatching, and we don't want to pay for the agent SDK + MCP
      // client unless `dashboard` is actually invoked).
      const [
        { readDashboardPlan },
        { resolveCredentials },
        { buildSession },
        { fetchHasAnyEventsMcp },
        { callAmplitudeMcp },
        { persistDashboard },
        { getMcpUrlFromZone },
        { decodeJwtZone },
        { resolveInstallDir },
      ] = await Promise.all([
        import('../lib/dashboard-plan.js'),
        import('../lib/credential-resolution.js'),
        import('../lib/wizard-session.js'),
        import('../lib/api.js'),
        import('../lib/mcp-with-fallback.js'),
        import('../lib/wizard-tools.js'),
        import('../utils/urls.js'),
        import('../utils/jwt-exp.js'),
        import('../utils/install-dir.js'),
      ]);

      // Expand `~` and resolve relatives at the trust boundary so
      // `readDashboardPlan` / `persistDashboard` see an absolute path.
      // `buildSession` does this internally via Zod, but the raw
      // `installDir` we pass through `runDashboardCommand` must be
      // pre-resolved.
      const installDir = resolveInstallDir(
        argv['install-dir'] as string | undefined,
      );
      const ingestionTimeoutMs =
        (argv['ingestion-timeout-ms'] as number | undefined) ??
        DEFAULT_INGESTION_TIMEOUT_MS;

      const ui = getUI();
      try {
        const result = await runDashboardCommand(
          { installDir, ingestionTimeoutMs },
          {
            readDashboardPlan,
            resolveCredentials,
            buildSession,
            fetchHasAnyEventsMcp,
            callAmplitudeMcp,
            persistDashboard,
            getMcpUrlFromZone,
            decodeJwtZone,
          },
        );

        if (result.exitCode === ExitCode.SUCCESS && result.dashboardUrl) {
          ui.log.success(result.message);
        } else if (result.exitCode === ExitCode.SUCCESS) {
          // Ingestion timeout — clean exit but informational, not success-y.
          ui.log.info(result.message);
        } else {
          ui.log.error(result.message);
        }
        process.exit(result.exitCode);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ui.log.error(`dashboard failed: ${msg}`);
        process.exit(ExitCode.GENERAL_ERROR);
      }
    })();
  },
};
