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
 * Locate the freshest existing event-plan file (canonical
 * `.amplitude/events.json` or legacy `.amplitude-events.json`) and read its
 * raw contents. Returns null when no candidate exists or read failed; the
 * `[label]` prefix on log lines distinguishes which caller logged the error.
 *
 * Shared between {@link readLocalEventPlan} and {@link readLocalEventPlanRich}
 * so the file-discovery + winner-by-mtime logic stays in one place. Mirrors
 * the `pickFreshestExisting` logic in `agent-interface.ts` — picks whichever
 * candidate has the more recent mtime so a stale canonical from a previous
 * run can't shadow a fresh legacy write.
 */
function readFreshestEventPlanFile(
  installDir: string,
  label: string,
): { content: string; path: string } | null {
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
        logToFile(`[${label}] stat ${candidate} failed: ${err.message ?? err}`);
      }
    }
  }

  if (!winner) return null;

  try {
    return { content: fs.readFileSync(winner, 'utf8'), path: winner };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    logToFile(`[${label}] read ${winner} failed: ${err.message ?? err}`);
    return null;
  }
}

/**
 * Read the agent-written event plan from a project's install dir.
 *
 * Tries the canonical path first (`<installDir>/.amplitude/events.json`),
 * then the legacy dotfile (`<installDir>/.amplitude-events.json`) that
 * older context-hub integration skills still emit. Returns whichever has
 * the more recent mtime so a stale canonical from a previous run can't
 * shadow a fresh legacy write.
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
  const file = readFreshestEventPlanFile(installDir, 'readLocalEventPlan');
  if (!file) return [];

  const parsed = parseEventPlanContent(file.content);
  if (parsed === null) {
    logToFile(
      `[readLocalEventPlan] ${file.path} could not be parsed as an event plan`,
    );
    return [];
  }

  return parsed.filter((e) => e.name.trim().length > 0);
}

/**
 * Like {@link readLocalEventPlan} but preserves optional `callsites` arrays
 * written by `persistEventPlan`. Used by the batch-merge path so earlier
 * batches' callsite annotations survive when subsequent batches are merged in.
 */
export function readLocalEventPlanRich(installDir: string): Array<{
  name: string;
  description: string;
  callsites?: Array<{ filePath: string; anchor?: string }>;
}> {
  const file = readFreshestEventPlanFile(installDir, 'readLocalEventPlanRich');
  if (!file) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    logToFile(
      `[readLocalEventPlanRich] ${file.path} could not be parsed as JSON`,
    );
    return [];
  }

  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Array.isArray((parsed as { events?: unknown }).events)
  ) {
    parsed = (parsed as { events: unknown[] }).events;
  }

  if (!Array.isArray(parsed)) return [];

  const str = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : undefined;

  return (parsed as Array<Record<string, unknown>>)
    .map((e) => {
      const name =
        str(e.name) ??
        str(e.event) ??
        str(e.eventName) ??
        str(e.event_name) ??
        '';
      const description =
        str(e.description) ??
        str(e.event_description) ??
        str(e.eventDescription) ??
        str(e.eventDescriptionAndReasoning) ??
        '';
      const result: {
        name: string;
        description: string;
        callsites?: Array<{ filePath: string; anchor?: string }>;
      } = {
        name,
        description,
      };
      if (Array.isArray(e.callsites) && e.callsites.length > 0) {
        const filtered = (
          e.callsites as Array<{ filePath: string; anchor?: string }>
        ).filter((c) => c && typeof c.filePath === 'string');
        if (filtered.length > 0) {
          result.callsites = filtered;
        }
      }
      return result;
    })
    .filter((e) => e.name.trim().length > 0);
}
