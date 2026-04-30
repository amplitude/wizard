/**
 * Commit the agent's instrumented event plan to the project's Amplitude
 * tracking plan as *planned* events.
 *
 * Runs after the agent finishes instrumenting (i.e. `.amplitude-events.json`
 * is populated and `track()` calls are written).
 *
 * Step 1 — POST `/v1/planned-events` on the wizard proxy (OAuth Bearer, same
 * host as `createAmplitudeApp`). If the route is not deployed yet (HTTP 404),
 * falls back to the Amplitude MCP `create_events` tool with `wasPlanned: true`.
 *
 * Step 2 — Amplitude MCP `update_event` to attach descriptions (no HTTP
 * equivalent yet).
 *
 * Errors are swallowed into a result object — a failure here should never
 * derail the happy-path outro.
 */

import axios from 'axios';
import { z } from 'zod';
import { logToFile } from '../utils/debug.js';
import type { AmplitudeZone } from './constants.js';
import { WIZARD_USER_AGENT } from './constants.js';
import { getWizardProxyBase } from './api.js';
import { callAmplitudeMcp } from './mcp-with-fallback.js';
import { decodeJwtZone } from '../utils/jwt-exp.js';
import { getMcpUrlFromZone } from '../utils/urls.js';

const PlannedEventsSuccessSchema = z.object({
  createdCount: z.number(),
  eventTypes: z.array(z.string()),
  appId: z.string(),
});

const PlannedEventsErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

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
  /** Used to resolve `getWizardProxyBase` for POST `/v1/planned-events`. */
  zone: AmplitudeZone;
  abortSignal?: AbortSignal;
}

const CREATE_EVENTS_TIMEOUT_MS = 30_000;
const PLANNED_EVENTS_HTTP_TIMEOUT_MS = 60_000;

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

type CreateEventsOutcome = {
  success: boolean;
  createdEvents?: string[];
  message?: string;
};

async function createPlannedEventsViaHttp(
  accessToken: string,
  zone: AmplitudeZone,
  appId: string,
  events: Array<{ eventType: string; wasPlanned: boolean }>,
  abortSignal?: AbortSignal,
): Promise<
  | { kind: 'ok'; createdEvents: string[] }
  | { kind: 'error'; message: string; notFound: boolean }
> {
  const url = `${getWizardProxyBase(zone)}/v1/planned-events`;
  try {
    const response = await axios.post(
      url,
      { appId, events },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': WIZARD_USER_AGENT,
        },
        validateStatus: () => true,
        timeout: PLANNED_EVENTS_HTTP_TIMEOUT_MS,
        signal: abortSignal,
      },
    );

    if (response.status === 404) {
      return {
        kind: 'error',
        message: 'planned-events endpoint not found',
        notFound: true,
      };
    }

    if (response.status >= 200 && response.status < 300) {
      const parsed = PlannedEventsSuccessSchema.safeParse(response.data);
      if (parsed.success) {
        return {
          kind: 'ok',
          createdEvents: parsed.data.eventTypes,
        };
      }
      logToFile(
        `[commitPlannedEvents] planned-events success body parse failed: ${JSON.stringify(
          response.data,
        )}`,
      );
      return {
        kind: 'error',
        message: 'Invalid response from planned-events endpoint',
        notFound: false,
      };
    }

    const errParsed = PlannedEventsErrorSchema.safeParse(response.data);
    const msg = errParsed.success
      ? `${errParsed.data.error.code}: ${errParsed.data.error.message}`
      : `HTTP ${response.status}`;
    return { kind: 'error', message: msg, notFound: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logToFile(`[commitPlannedEvents] planned-events HTTP error: ${message}`);
    return { kind: 'error', message, notFound: false };
  }
}

async function createPlannedEventsViaMcp(
  accessToken: string,
  appId: string,
  mcpEvents: Array<{ eventType: string; wasPlanned: boolean }>,
  mcpUrl: string,
  abortSignal?: AbortSignal,
): Promise<CreateEventsOutcome | null> {
  return callAmplitudeMcp<CreateEventsOutcome>({
    accessToken,
    mcpUrl,
    label: 'commitPlannedEvents.create',
    abortSignal,
    agentTimeoutMs: CREATE_EVENTS_TIMEOUT_MS,
    direct: async (callTool) => {
      const text = await callTool(1, 'create_events', {
        projectId: appId,
        events: mcpEvents,
      });
      if (!text) return null;

      // Hard short-circuit: Amplitude MCP may return plain text starting with
      // "MCP error" when create_events is not implemented for the session.
      // Return a sentinel so callAmplitudeMcp does not burn ~20s on an agent
      // fallback that reaches the same outcome.
      if (text.startsWith('MCP error')) {
        logToFile(
          '[commitPlannedEvents] create_events not available on Amplitude MCP — events will register on first ingestion',
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
      } catch (e) {
        logToFile(
          `[commitPlannedEvents] create_events parse error: ${
            e instanceof Error ? e.message : String(e)
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
}

/**
 * Commit the event plan to the Amplitude tracking plan as planned events.
 *
 * Returns counts instead of throwing — failure here must not break the outro.
 */
export async function commitPlannedEvents(
  opts: CommitPlannedEventsOptions,
): Promise<CommitPlannedEventsResult> {
  const { accessToken, appId, events, zone, abortSignal } = opts;
  const accountZone = decodeJwtZone(accessToken) ?? zone;
  const mcpUrl = getMcpUrlFromZone(accountZone);
  const cleaned = dedupeAndClean(events);

  if (cleaned.length === 0 || !appId) {
    return { attempted: 0, created: 0, described: 0 };
  }

  const mcpEvents = cleaned.map((e) => ({
    eventType: e.name,
    wasPlanned: true,
  }));

  // ── Step 1: wizard-proxy POST /v1/planned-events (MCP fallback on 404) ───
  const httpResult = await createPlannedEventsViaHttp(
    accessToken,
    zone,
    appId,
    mcpEvents,
    abortSignal,
  );

  let createResult: CreateEventsOutcome | null;
  if (httpResult.kind === 'ok') {
    createResult = {
      success: true,
      createdEvents: httpResult.createdEvents,
    };
  } else if (httpResult.notFound) {
    logToFile(
      '[commitPlannedEvents] planned-events returned 404 — falling back to MCP create_events',
    );
    createResult = (await createPlannedEventsViaMcp(
      accessToken,
      appId,
      mcpEvents,
      mcpUrl,
      abortSignal,
    )) ?? { success: false, message: 'create_events failed' };
  } else {
    createResult = {
      success: false,
      message: httpResult.message,
    };
  }

  if (!createResult || createResult.success !== true) {
    const errMsg = createResult?.message ?? 'planned events create failed';
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
    mcpUrl,
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
