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

import { callAmplitudeMcp, AMPLITUDE_MCP_URL } from '../lib/mcp-with-fallback';
import { parseEventPlanContent } from '../lib/event-plan-parser';
import { getUI } from '../ui';
import { analytics } from '../utils/analytics';
import { logToFile } from '../utils/debug';
import type { WizardSession } from '../lib/wizard-session';
import type { Integration } from '../lib/constants';

const EVENTS_FILE = '.amplitude-events.json';
const DASHBOARD_FILE = '.amplitude-dashboard.json';
const DASHBOARD_TIMEOUT_MS = 90_000;

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

  const eventsPath = path.join(session.installDir, EVENTS_FILE);
  const dashboardPath = path.join(session.installDir, DASHBOARD_FILE);

  // 1. Read the instrumentation manifest the agent just wrote.
  const events = readEventsFile(eventsPath);
  if (!events) {
    logToFile(
      `[createDashboard] skipping — no valid ${EVENTS_FILE} at ${eventsPath}`,
    );
    analytics.wizardCapture('dashboard skipped', {
      integration,
      reason: 'no events file',
    });
    return;
  }

  ui.pushStatus('Creating your analytics dashboard');
  const spinner = ui.spinner();
  spinner.start('Creating charts and dashboard in Amplitude…');

  // Wrap the entire dashboard run in try/finally so an unexpected throw from
  // runCreateDashboard (e.g. SDK module load failure outside the agent's own
  // try/catch) cannot leave the spinner running. The function's contract is
  // "never throws" — enforce that here even when callees violate it.
  const startedAt = Date.now();
  let result: DashboardResult | null = null;
  let unexpectedError: unknown = null;
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
    // - hard timeout (we hit the 90s ceiling)
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
    return;
  }

  // 2. Persist the wizard-visible artifact so OutroScreen can link to it.
  try {
    fs.writeFileSync(dashboardPath, JSON.stringify(result, null, 2), 'utf8');
  } catch (err) {
    logToFile(
      `[createDashboard] failed to write ${DASHBOARD_FILE}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  session.checklistDashboardUrl = result.dashboardUrl;
  ui.setDashboardUrl(result.dashboardUrl);
  spinner.stop('Dashboard ready');
  analytics.wizardCapture('dashboard created', {
    integration,
    'chart count': result.charts?.length ?? 0,
    'duration ms': durationMs,
  });
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

function readEventsFile(eventsPath: string): EventsFile | null {
  if (!fs.existsSync(eventsPath)) return null;
  try {
    const content = fs.readFileSync(eventsPath, 'utf8');
    const events = readEventsFromContent(content);
    if (!events) {
      logToFile(
        `[createDashboard] ${eventsPath} parsed but had no usable events`,
      );
    }
    return events;
  } catch (err) {
    logToFile(
      `[createDashboard] ${eventsPath} is invalid: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

async function runCreateDashboard(args: {
  accessToken: string;
  events: EventsFile;
  session: WizardSession;
}): Promise<DashboardResult | null> {
  const { accessToken, events, session } = args;
  const mcpUrl = session.localMcp
    ? 'http://localhost:8787/mcp'
    : process.env.MCP_URL || AMPLITUDE_MCP_URL;

  const agentPrompt = buildAgentPrompt(events, session);

  return await callAmplitudeMcp<DashboardResult>({
    accessToken,
    mcpUrl,
    label: 'createDashboard',
    agentTimeoutMs: DASHBOARD_TIMEOUT_MS,
    agentPrompt,
    parseAgent: parseAgentOutput,
  });
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
