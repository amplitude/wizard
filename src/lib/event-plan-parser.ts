/**
 * event-plan-parser — canonical parser for `<installDir>/.amplitude-events.json`.
 *
 * Single source of truth for reading the event-plan file the agent writes via
 * `confirm_event_plan`. Both the TUI's Event Plan viewer (which imports
 * `parseEventPlanContent` from `agent-interface.ts`) and the CLI plan reader
 * (`agent-ops.ts#runPlan`) ultimately route through this module so the schema
 * and fallback chains stay in lock-step.
 *
 * Lightweight on purpose — only depends on `zod`. Pure-ops modules can import
 * it without dragging in the Claude Agent SDK loader, the wizard UI singleton,
 * analytics, or any other agent-runtime surface.
 *
 * History: extracted from `agent-interface.ts` after Bugbot flagged that the
 * inlined parser in `agent-ops.ts` had drifted from the TUI's copy. See PR
 * #295.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { getEventsFile } from '../utils/storage-paths.js';
import { logToFile } from '../utils/debug.js';

// The agent doesn't always use the same field casing in .amplitude-events.json
// — observed in the wild: name, event, eventName, event_name (and the same
// for description: description, event_description, eventDescription,
// eventDescriptionAndReasoning). Accept every common variant so the event
// plan renders instead of falling back to an empty name. Some skills also
// imply a top-level `{ events: [...] }` wrapper; we unwrap it before parsing.
const eventPlanSchema = z.array(
  z.looseObject({
    name: z.string().optional(),
    event: z.string().optional(),
    eventName: z.string().optional(),
    event_name: z.string().optional(),
    description: z.string().optional(),
    event_description: z.string().optional(),
    eventDescription: z.string().optional(),
    eventDescriptionAndReasoning: z.string().optional(),
  }),
);

/**
 * Parse the agent-written `.amplitude-events.json` into a normalized
 * `[{ name, description }]` array. Returns `null` if the input isn't valid
 * JSON or doesn't match the schema, so callers can distinguish "not ready
 * yet" from a structural problem.
 *
 * Tolerates all observed agent-written field variants:
 *   name        → name | event | eventName | event_name
 *   description → description | event_description | eventDescription
 *                 | eventDescriptionAndReasoning
 *
 * Description fallback prefers concise standard aliases over the verbose
 * `eventDescriptionAndReasoning` legacy field — if an agent emits both,
 * the concise one wins so the plan stays scannable.
 *
 * Also unwraps a `{ events: [...] }` wrapper some skills produce.
 */
export function parseEventPlanContent(
  content: string,
): Array<{ name: string; description: string }> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  // Tolerate `{ events: [...] }` wrapper objects — some skills imply this
  // shape and the parser would otherwise reject them outright.
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Array.isArray((parsed as { events?: unknown }).events)
  ) {
    parsed = (parsed as { events: unknown[] }).events;
  }

  const result = eventPlanSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data.map((e) => ({
    name: e.name ?? e.event ?? e.eventName ?? e.event_name ?? '',
    description:
      e.description ??
      e.event_description ??
      e.eventDescription ??
      e.eventDescriptionAndReasoning ??
      '',
  }));
}

/**
 * Read the agent-written event plan from a project's install dir.
 *
 * Tries the canonical path first (`<installDir>/.amplitude/events.json`),
 * then the legacy dotfile (`<installDir>/.amplitude-events.json`) that
 * older context-hub integration skills still emit. Returns whichever has
 * the more recent mtime so a stale canonical from a previous run can't
 * shadow a fresh legacy write — mirroring the `pickFreshestExisting`
 * logic in `agent-interface.ts`.
 *
 * Returns `[]` for any non-fatal failure (file missing, malformed JSON,
 * schema mismatch). Empty entries (no name) are dropped. Logs to the
 * debug file so issues are recoverable post-mortem.
 *
 * Used by the Event Verification screen to render the planned tracking
 * list inline so users can see what they need to trigger.
 */
export function readLocalEventPlan(
  installDir: string,
): Array<{ name: string; description: string }> {
  const candidates = [
    getEventsFile(installDir),
    path.join(installDir, '.amplitude-events.json'),
  ];

  let winner: string | null = null;
  let winnerMtime = -Infinity;
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      const mtime = stat.mtimeMs;
      if (mtime > winnerMtime) {
        winner = candidate;
        winnerMtime = mtime;
      }
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        logToFile(
          `[readLocalEventPlan] stat ${candidate} failed: ${
            err.message ?? err
          }`,
        );
      }
    }
  }

  if (!winner) return [];

  let raw: string;
  try {
    raw = fs.readFileSync(winner, 'utf8');
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    logToFile(
      `[readLocalEventPlan] read ${winner} failed: ${err.message ?? err}`,
    );
    return [];
  }

  const parsed = parseEventPlanContent(raw);
  if (parsed === null) {
    logToFile(
      `[readLocalEventPlan] ${winner} could not be parsed as an event plan`,
    );
    return [];
  }

  return parsed.filter((e) => e.name.trim().length > 0);
}
