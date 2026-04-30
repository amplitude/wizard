/**
 * Commit the agent's instrumented event plan to the project's Amplitude
 * tracking plan as *planned* events.
 *
 * Runs after the agent finishes instrumenting (i.e. `.amplitude-events.json`
 * is populated and `track()` calls are written). Uses the Amplitude MCP
 * `create_events` tool (`wasPlanned: true`) so each name the wizard added
 * shows up in the customer's Data tab alongside any live events. Follows up
 * with `update_event` to attach the descriptions the agent captured.
 *
 * Errors are swallowed into a result object — a failure here should never
 * derail the happy-path outro.
 */

import { z } from 'zod';
import { logToFile } from '../utils/debug.js';
import { callAmplitudeMcp } from './mcp-with-fallback.js';

const CreateEventsResponse = z.object({
  success: z.boolean().optional(),
  createdEvents: z.array(z.string()).optional(),
  message: z.string().optional(),
});

const UpdateEventResponse = z.object({
  success: z.boolean().optional(),
});

export interface PlannedEventInput {
  name: string;
  description: string;
}

export interface CommitPlannedEventsResult {
  attempted: number;
  created: number;
  described: number;
  error?: string;
}

export interface CommitPlannedEventsOptions {
  accessToken: string;
  appId: string;
  events: PlannedEventInput[];
  abortSignal?: AbortSignal;
}

const CREATE_EVENTS_TIMEOUT_MS = 30_000;

function dedupeAndClean(events: PlannedEventInput[]): PlannedEventInput[] {
  const seen = new Set<string>();
  const out: PlannedEventInput[] = [];
  for (const e of events) {
    const name = e.name?.trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, description: (e.description ?? '').trim() });
  }
  return out;
}

/**
 * Commit the event plan to the Amplitude tracking plan as planned events.
 *
 * Returns counts instead of throwing — failure here must not break the outro.
 */
export async function commitPlannedEvents(
  opts: CommitPlannedEventsOptions,
): Promise<CommitPlannedEventsResult> {
  const { accessToken, appId, events, abortSignal } = opts;
  const cleaned = dedupeAndClean(events);

  if (cleaned.length === 0 || !appId) {
    return { attempted: 0, created: 0, described: 0 };
  }

  const mcpEvents = cleaned.map((e) => ({
    eventType: e.name,
    wasPlanned: true,
  }));

  // ── Step 1: create_events ─────────────────────────────────────────────────
  const createResult = await callAmplitudeMcp<{
    success: boolean;
    createdEvents?: string[];
    message?: string;
  }>({
    accessToken,
    label: 'commitPlannedEvents.create',
    abortSignal,
    agentTimeoutMs: CREATE_EVENTS_TIMEOUT_MS,
    direct: async (callTool) => {
      const text = await callTool(1, 'create_events', {
        projectId: appId,
        events: mcpEvents,
      });
      if (!text) return null;

      // Hard short-circuit: the Amplitude MCP server's `create_events` tool
      // currently returns a payload that begins with the literal string
      // "MCP error" (visible across every successful instrumentation run we
      // have logs for — the taxonomy MCP category exposes only read-only
      // tools today: get_events / get_properties / get_custom_or_labeled_events
      // / get_transformations / get_group_types). Treat that signature as
      // "tool not implemented" and return a non-null sentinel so the
      // callAmplitudeMcp wrapper does NOT fall back to a 20s Claude-agent
      // round-trip that ends in the same conclusion. The events the agent
      // wrote into `.amplitude/events.json` will still register in the
      // user's Data tab once the events fire from the user's app — this
      // step was only ever a "make them visible BEFORE first ingestion"
      // nicety. When the MCP server eventually grows a write tool, the text
      // won't start with "MCP error" anymore and the normal parse path
      // takes over without any code change here.
      if (text.startsWith('MCP error')) {
        logToFile(
          `[commitPlannedEvents] create_events not available on Amplitude MCP — events will register on first ingestion`,
        );
        return {
          success: false,
          createdEvents: [],
          message: 'create_events tool not available on Amplitude MCP server',
        };
      }

      try {
        const parsed = CreateEventsResponse.parse(JSON.parse(text));
        return {
          success: parsed.success ?? false,
          createdEvents: parsed.createdEvents ?? [],
          message: parsed.message,
        };
      } catch (err) {
        logToFile(
          `[commitPlannedEvents] create_events parse error: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return null;
      }
    },
    agentPrompt: `Use the Amplitude MCP tool create_events to add these events to project ${appId} as planned events.
Pass wasPlanned: true for every event.
Events: ${JSON.stringify(mcpEvents)}
Respond with JSON only — no prose, no markdown fences:
{"success":true|false,"createdEvents":["..."],"message":"..."}`,
    parseAgent: (text) => {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        const parsed = CreateEventsResponse.parse(JSON.parse(match[0]));
        return {
          success: parsed.success ?? false,
          createdEvents: parsed.createdEvents ?? [],
          message: parsed.message,
        };
      } catch {
        return null;
      }
    },
  });

  if (!createResult || createResult.success !== true) {
    const errMsg = createResult?.message ?? 'create_events failed';
    logToFile(`[commitPlannedEvents] ${errMsg}`);
    return {
      attempted: cleaned.length,
      created: 0,
      described: 0,
      error: errMsg,
    };
  }

  const created = createResult.createdEvents ?? cleaned.map((e) => e.name);

  // ── Step 2: update_event with descriptions ────────────────────────────────
  const descriptions: Record<string, string> = {};
  for (const e of cleaned) {
    if (e.description && created.includes(e.name)) {
      descriptions[e.name] = e.description;
    }
  }

  if (Object.keys(descriptions).length === 0) {
    return { attempted: cleaned.length, created: created.length, described: 0 };
  }

  const updateResult = await callAmplitudeMcp<{ success: boolean }>({
    accessToken,
    label: 'commitPlannedEvents.update',
    abortSignal,
    agentTimeoutMs: CREATE_EVENTS_TIMEOUT_MS,
    direct: async (callTool) => {
      const text = await callTool(2, 'update_event', {
        projectId: appId,
        descriptions,
      });
      if (!text) return null;
      try {
        const parsed = UpdateEventResponse.parse(JSON.parse(text));
        return { success: parsed.success ?? false };
      } catch {
        return null;
      }
    },
    agentPrompt: `Use the Amplitude MCP tool update_event to set descriptions on project ${appId}.
Descriptions map: ${JSON.stringify(descriptions)}
Respond with JSON only: {"success":true|false}`,
    parseAgent: (text) => {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        const parsed = UpdateEventResponse.parse(JSON.parse(match[0]));
        return { success: parsed.success ?? false };
      } catch {
        return null;
      }
    },
  });

  const described =
    updateResult?.success === true ? Object.keys(descriptions).length : 0;

  return {
    attempted: cleaned.length,
    created: created.length,
    described,
  };
}
