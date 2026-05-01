/**
 * createDashboardStep — post-agent step that creates charts and a dashboard
 * via the Amplitude MCP with a bounded timeout and visible progress.
 *
 * Previously this work happened inside the main Claude agent run, driven by
 * the amplitude-chart-dashboard-plan skill. That path had no step-level
 * timeout; a slow MCP call could hang the whole wizard indefinitely. This
 * step moves the work out of the main loop so the agent can report success
 * as soon as instrumentation is done, and dashboard creation runs with its
 * own budget and graceful degradation.
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';

import { callAmplitudeMcp } from '../lib/mcp-with-fallback';
import {
  parseEventPlanContent,
  readLocalEventPlan,
} from '../lib/event-plan-parser.js';
import { getMcpUrlFromZone } from '../utils/urls';
import { resolveZone } from '../lib/zone-resolution';
import { DEFAULT_AMPLITUDE_ZONE } from '../lib/constants';
import { getUI } from '../ui';
import { analytics } from '../utils/analytics';
import { logToFile } from '../utils/debug';
import { persistDashboard } from '../lib/wizard-tools';
import { getDashboardFile } from '../utils/storage-paths';
import type { WizardSession } from '../lib/wizard-session';
import type { Integration } from '../lib/constants';

/** Legacy dashboard dotfile — read-only fallback for older runs. */
const LEGACY_DASHBOARD_FILE = '.amplitude-dashboard.json';
// Tightened from 90s → 30s. With the in-loop `record_dashboard` tool, the
// agent is the primary path for dashboard creation; this step is now a
// genuine fallback for the rare case where the agent failed to create or
// record the dashboard. A 30s ceiling is enough for a single MCP retry but
// short enough that the user-visible "Creating charts and dashboard..."
// spinner doesn't sit for 90s on every cold MCP gateway. The bigger win
// is that this step now usually short-circuits via the reuse path below
// in <100ms — the timeout matters only when the fallback genuinely runs.
const DASHBOARD_TIMEOUT_MS = 30_000;

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

// Stable id used by agent-runner's seedPostAgentSteps + setPostAgentStep
// calls. Inlined here to avoid a cycle between this step and agent-runner.
// agent-runner exports the same string from POST_AGENT_STEP_CREATE_DASHBOARD;
// keep them in sync — a small unit test asserts the equality.
export const STEP_ID = 'create-dashboard';

/**
 * Run the dashboard creation step. Never throws — on failure or timeout,
 * logs a warning and returns. The wizard run still succeeds; users see a
 * "create a dashboard manually" note in the outro.
 *
 * Owns its post-agent step lifecycle: marks `create-dashboard` step
 * `in_progress` on entry and `completed` / `skipped` on exit so the
 * FinalizingPanel reflects real outcomes including the three distinct
 * failure modes (unexpected throw, hard timeout, MCP returned null).
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

  // 1. Read the instrumentation manifest (canonical `.amplitude/events.json`,
  //    then legacy `.amplitude-events.json` when present).
  const events = readEventsForDashboard(session.installDir);
  if (!events) {
    logToFile(
      `[createDashboard] skipping — no valid event plan under .amplitude/ (or legacy dotfile)`,
    );
    analytics.wizardCapture('dashboard skipped', {
      integration,
      reason: 'no events file',
    });
    ui.setPostAgentStep(STEP_ID, {
      status: 'skipped',
      reason: 'no events to chart',
    });
    return;
  }

  // 1b. If the in-loop agent already created the dashboard (agent calls
  //     Amplitude MCP `create_dashboard` then wizard-tools `record_dashboard`,
  //     which writes `<installDir>/.amplitude/dashboard.json`), short-circuit.
  //
  //     Read order: canonical FIRST, then legacy `.amplitude-dashboard.json`
  //     for older runs only.
  const existing =
    readExistingDashboardFile(canonicalDashboardPath) ??
    readExistingDashboardFile(legacyDashboardPath);
  if (existing) {
    logToFile(
      `[createDashboard] reusing dashboard already created by agent: ${existing.dashboardUrl}`,
    );
    persistDashboard(session.installDir, existing);
    session.checklistDashboardUrl = existing.dashboardUrl;
    ui.setDashboardUrl(existing.dashboardUrl);
    analytics.wizardCapture('dashboard created', {
      integration,
      'chart count': existing.charts?.length ?? 0,
      'duration ms': 0,
      source: 'agent',
    });
    ui.setPostAgentStep(STEP_ID, { status: 'completed' });
    return;
  }

  // 2. Fallback path: the in-loop agent didn't record a dashboard, so we
  //    have to create one ourselves via a sub-agent + Amplitude MCP. This
  //    is the slow path (a cold sub-agent + chained MCP calls routinely
  //    pushes 30s) and the user sees the spinner. Mark the session so
  //    RunScreen can render a 6th synthetic task — without this, the
  //    "5/5 tasks complete" header lies for the duration of the spinner.
  //    Cleared in finally below regardless of outcome.
  session.dashboardFallbackPhase = 'in_progress';
  ui.pushStatus('Creating your analytics dashboard');
  const spinner = ui.spinner();
  spinner.start('Creating charts and dashboard in Amplitude…');

  // Wrap the entire fallback run so we ALWAYS clear `dashboardFallbackPhase`
  // and stop the spinner — even if `runCreateDashboard` throws unexpectedly
  // (e.g. SDK module load failure outside the agent's own try/catch). The
  // function's contract is "never throws"; this enforces that even when a
  // callee violates it. RunScreen's 6th synthetic task disappears the moment
  // this finally runs, so a stuck phase would leave a stale "Creating your
  // analytics dashboard" task pinned forever.
  const startedAt = Date.now();
  let result: DashboardResult | null = null;
  let unexpectedError: unknown = null;
  try {
    try {
      result = await runCreateDashboard({
        accessToken,
        events,
        session,
      });
    } catch (err) {
      unexpectedError = err;
      logToFile(
        `[createDashboard] unexpected error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const durationMs = Date.now() - startedAt;

    if (!result) {
      // Distinguish three failure modes for accurate user-visible messaging:
      // - unexpected throw (e.g. SDK module load)
      // - hard timeout (we hit the timeout ceiling)
      // - MCP/agent returned null quickly (parse error, empty output, session
      //   handshake refused, etc.)
      let spinnerMessage: string;
      let warnMessage: string;
      let reason: string;
      if (unexpectedError) {
        spinnerMessage = 'Dashboard step failed — skipping';
        warnMessage =
          'Amplitude is configured, but the wizard hit an unexpected error creating a starter dashboard. Open app.amplitude.com to create one manually.';
        reason = 'unexpected error';
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
        reason = 'mcp error or unparseable response';
      }
      spinner.stop(spinnerMessage);
      ui.log.warn(warnMessage);
      analytics.wizardCapture('dashboard failed', {
        integration,
        reason,
        'duration ms': durationMs,
      });
      ui.setPostAgentStep(STEP_ID, { status: 'skipped', reason });
      return;
    }

    // Persist canonical `<installDir>/.amplitude/dashboard.json` so
    // OutroScreen, `/diagnostics`, and repeat runs see the URL. Best-effort.
    persistDashboard(session.installDir, result);

    session.checklistDashboardUrl = result.dashboardUrl;
    ui.setDashboardUrl(result.dashboardUrl);
    spinner.stop('Dashboard ready');
    ui.setPostAgentStep(STEP_ID, { status: 'completed' });
    analytics.wizardCapture('dashboard created', {
      integration,
      'chart count': result.charts?.length ?? 0,
      'duration ms': durationMs,
      source: 'post-agent',
    });
  } finally {
    // ALWAYS clear the phase so RunScreen drops the 6th synthetic task,
    // regardless of how this branch exited (success, soft-skip, throw).
    session.dashboardFallbackPhase = 'completed';
  }
}

/**
 * Try to load an already-written dashboard JSON (canonical or legacy path).
 * Returns the
 * parsed result if present and valid, null otherwise (missing file,
 * unreadable, malformed JSON, fails schema validation, or empty
 * dashboardUrl). Failures fall through to the agent fallback path.
 */
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
      `[createDashboard] existing ${dashboardPath} unusable, will run agent: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

// ── Helpers (exported for testing) ─────────────────────────────────────────

export const __test__ = {
  readEventsFromContent,
  parseAgentOutput,
  extractJsonContaining,
};

/**
 * Parse `.amplitude-events.json` content into the shape this step needs.
 * Delegates to `parseEventPlanContent`, the canonical parser used by the
 * TUI's Event Plan viewer and the CLI plan reader, so this step stays in
 * lock-step with the rest of the codebase on field-name tolerance
 * (`name` / `event` / `eventName` / `event_name`, etc.) and shape
 * unwrapping (`{ events: [...] }` vs bare array).
 *
 * Returns `null` if the content is unparseable, missing required keys, or
 * yields zero entries with non-empty names.
 */
function readEventsFromContent(content: string): EventsFile | null {
  const events = parseEventPlanContent(content);
  if (!events) return null;
  // Trim names AND drop whitespace-only entries. Other readers in the
  // codebase use `.trim().length > 0` (e.g. agent-interface.ts); a plain
  // `length > 0` here would let names like `" "` leak into the dashboard
  // prompt and produce charts whose title is a single space.
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

async function runCreateDashboard(args: {
  accessToken: string;
  events: EventsFile;
  session: WizardSession;
}): Promise<DashboardResult | null> {
  // TODO(follow-up PR): wire a `direct` MCP path that calls
  // `create_chart` per chart-definition and then `create_dashboard`
  // sequentially. Today this step has only an `agentPrompt` path —
  // every dashboard creation runs a full Claude inference for what
  // could be ~6 deterministic MCP tool calls. Naming the LLM path
  // "fallback" obscures that it's the only path. Verify which write
  // tools the Amplitude MCP server actually exposes (cf.
  // src/lib/planned-events.ts:100, where `create_events` returns the
  // literal "MCP error" sentinel today) before wiring the direct path.
  const { accessToken, events, session } = args;
  const ui = getUI();
  // MCP host follows the bearer's account zone, not the env data zone.
  // EU MCP 401s any US-issued bearer (and vice versa) — so a US-account
  // user picking an EU env still needs to talk to US MCP. The env's
  // data still lands in EU because the appId carries that routing
  // server-side.
  const { decodeJwtZone } = await import('../utils/jwt-exp.js');
  const envZone = resolveZone(session, DEFAULT_AMPLITUDE_ZONE, {
    readDisk: true,
  });
  const accountZone = decodeJwtZone(accessToken) ?? envZone;
  const mcpUrl = getMcpUrlFromZone(accountZone, { local: session.localMcp });

  const agentPrompt = buildAgentPrompt(events, session);

  // Bound the ENTIRE call with an abort signal so a slow agent fallback cannot
  // block the wizard indefinitely.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => {
    logToFile(
      `[createDashboard] aborting — hit ${DASHBOARD_TIMEOUT_MS}ms ceiling`,
    );
    // Update the user-visible status the moment the timer fires. The SDK
    // subprocess can take several seconds to wind down after `controller.abort()`,
    // and until it does the spinner stays parked on "Creating charts and
    // dashboard in Amplitude…" — the UI lies that work is in flight while the
    // wizard has already given up. Pushing here gives the user immediate
    // feedback; the eventual `spinner.stop(spinnerMessage)` in the caller
    // overwrites this with the final timeout message.
    try {
      ui.pushStatus('Dashboard step is taking too long — wrapping up…');
    } catch {
      // pushStatus is best-effort here; never let a UI hiccup mask the abort.
    }
    controller.abort();
  }, DASHBOARD_TIMEOUT_MS);

  try {
    return await callAmplitudeMcp<DashboardResult>({
      accessToken,
      mcpUrl,
      label: 'createDashboard',
      agentTimeoutMs: DASHBOARD_TIMEOUT_MS,
      abortSignal: controller.signal,
      agentPrompt,
      parseAgent: parseAgentOutput,
      // Translate the fallback agent's MCP tool calls into status pill
      // updates so the 90s budget feels alive instead of frozen. The model
      // calls Amplitude MCP write tools as `mcp__amplitude__create_chart`,
      // `mcp__amplitude__create_dashboard`, etc. — any other tool name
      // falls through to a generic message.
      onAgentToolUse: ({ name, input }) => {
        const status = describeAgentToolUse(name, input);
        if (status) ui.pushStatus(status);
      },
    });
  } finally {
    clearTimeout(abortTimer);
  }
}

/**
 * Map an inner-agent tool_use to a human-readable status pill string.
 * Returns `null` when the tool isn't worth surfacing (e.g. read-only MCP
 * probes, internal SDK plumbing) so we don't churn the pill on noise.
 *
 * Exported for unit tests.
 */
export function describeAgentToolUse(
  name: string,
  input: unknown,
): string | null {
  // MCP tools land as `mcp__<server>__<tool>` — strip the prefix so we can
  // pattern-match on the bare tool name.
  const mcpMatch = name.match(/^mcp__[a-z0-9_-]+__(.+)$/i);
  const tool = mcpMatch ? mcpMatch[1] : name;
  // Pull a chart title out of the input when present; the model emits
  // `{ title: "..." }` in current Amplitude MCP schemas, but we treat it
  // as untrusted (string-cap, single-line).
  const title =
    readStringField(input, 'title') ?? readStringField(input, 'name');
  const trimmedTitle =
    title && title.length > 0
      ? `: ${title.replace(/\s+/g, ' ').slice(0, 60)}`
      : '';
  switch (tool) {
    case 'create_chart':
      return `Creating chart in Amplitude${trimmedTitle}…`;
    case 'create_dashboard':
      return `Assembling your dashboard in Amplitude${trimmedTitle}…`;
    case 'add_chart_to_dashboard':
    case 'attach_chart_to_dashboard':
      return 'Adding chart to dashboard…';
    case 'update_chart':
      return `Updating chart in Amplitude${trimmedTitle}…`;
    case 'update_dashboard':
      return `Updating dashboard in Amplitude${trimmedTitle}…`;
    default:
      // Read-only probes (list_charts, search_events, get_*) are noise —
      // the user doesn't care that the agent is browsing. Skip everything
      // we don't explicitly recognise as a write action.
      return null;
  }
}

function readStringField(input: unknown, key: string): string | null {
  if (input === null || typeof input !== 'object') return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function buildAgentPrompt(events: EventsFile, session: WizardSession): string {
  const productName = path.basename(session.installDir);
  const eventsBlock = events.events
    .map((e) => {
      const parts = [`- ${e.name}`];
      if (e.description) parts.push(` — ${e.description}`);
      return parts.join('');
    })
    .join('\n');

  return `You are creating an Amplitude dashboard for the "${productName}" project.
You have access to the Amplitude MCP server's chart and dashboard tools.

Events that were instrumented (use these exact names — do not rename or normalize):
${eventsBlock}

Tasks:
1. Plan 4-6 charts that together form a starter dashboard. Prefer at least one funnel, one volume (line) chart, one retention chart, and one Autocapture chart (\`[Amplitude] Page Viewed\`) when autocapture is likely enabled for a web SDK.
2. Create each chart via the Amplitude MCP. Collect chart IDs.
3. Create a dashboard named "${productName} Analytics — ${new Date().getFullYear()}" with all charts, description "Auto-generated by the Amplitude Wizard. Autocapture charts populate immediately; custom event charts populate once those user flows are triggered."
4. When finished, output EXACTLY one line, JSON only, on its own line, like this:
   <<<WIZARD_DASHBOARD_RESULT>>>{"dashboardUrl":"https://...","dashboardId":"...","charts":[{"id":"...","title":"...","type":"funnel"}]}<<<END>>>

Do not output anything after the result line. If chart creation fails partway, still emit the result line with whatever charts succeeded and the dashboard URL if the dashboard was created.`;
}

function parseAgentOutput(text: string): DashboardResult | null {
  const match = text.match(/<<<WIZARD_DASHBOARD_RESULT>>>([\s\S]*?)<<<END>>>/);
  if (match) {
    return safeParseDashboard(match[1].trim());
  }
  // Fallback: agent forgot the markers. Find the first balanced JSON object
  // that contains `"dashboardUrl"`. The dashboard result embeds a `charts`
  // array of objects, so a flat `[^{}]*` regex won't work here — we walk
  // braces manually accounting for string escapes.
  const candidate = extractJsonContaining(text, '"dashboardUrl"');
  if (!candidate) return null;
  return safeParseDashboard(candidate);
}

/**
 * Scan `text` for a balanced `{...}` substring that contains `needle`.
 * Returns the first such substring, or null if none is found. Ignores
 * braces that appear inside string literals.
 */
function extractJsonContaining(text: string, needle: string): string | null {
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

function safeParseDashboard(json: string): DashboardResult | null {
  try {
    const parsed = DashboardFileSchema.parse(JSON.parse(json));
    return parsed;
  } catch (err) {
    logToFile(
      `[createDashboard] parse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}
