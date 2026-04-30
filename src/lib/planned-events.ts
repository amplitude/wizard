/**
 * Commit the agent's instrumented event plan to the project's Amplitude
 * tracking plan as *planned* events.
 *
 * Currently a no-op. The Amplitude MCP server's `create_events` write
 * tool 400s on every call we observe in production (returns the literal
 * "MCP error" sentinel) — the taxonomy MCP category exposes only
 * read-only tools today (get_events / get_properties /
 * get_custom_or_labeled_events / get_transformations / get_group_types).
 * Same story for `update_event`.
 *
 * Until the server grows working write tools, we short-circuit the
 * entire create+update flow to avoid wasted MCP round-trips, a
 * subsequent ~12s Claude-agent fallback inference, and confusing
 * "MCP error" log noise. Events the agent wrote into
 * `.amplitude/events.json` still register in the user's Data tab once
 * the events fire from the user's app — pre-populating planned events
 * was always a "make them visible BEFORE first ingestion" nicety, not
 * a correctness requirement.
 *
 * To re-enable when the MCP server lands write support: revert this
 * file to the prior commit. The original implementation lives in
 * git history (search for `create_events` in `commitPlannedEvents`).
 */

import { logToFile } from '../utils/debug.js';

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
 * Returns counts instead of throwing — failure here must not break the
 * outro. While the MCP server lacks write tools (see file header), this
 * is a no-op and always returns `{ created: 0, described: 0 }` with an
 * `error` populated so the agent-runner skip-reason path picks it up.
 */
export function commitPlannedEvents(
  opts: CommitPlannedEventsOptions,
): Promise<CommitPlannedEventsResult> {
  const cleaned = dedupeAndClean(opts.events);

  if (cleaned.length === 0 || !opts.appId) {
    return Promise.resolve({ attempted: 0, created: 0, described: 0 });
  }

  logToFile(
    '[commitPlannedEvents] skipping — Amplitude MCP write tools (create_events / update_event) are disabled until server-side support lands',
  );
  return Promise.resolve({
    attempted: cleaned.length,
    created: 0,
    described: 0,
    error: 'tracking plan write unavailable',
  });
}
