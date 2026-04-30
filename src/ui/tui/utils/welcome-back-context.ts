/**
 * welcome-back-context — helpers for the IntroScreen "Welcome back" panel.
 *
 * The panel personalizes the first second of a returning run with whatever
 * stable signals we can read off disk before any network call:
 *
 *   - Event count from `<installDir>/.amplitude/events.json` (canonical) or
 *     the legacy `<installDir>/.amplitude-events.json`. Either path counts
 *     against the same "they instrumented N events last time" message.
 *   - Last-run timestamp from the freshest events file's mtime, formatted
 *     as a human-readable relative age ("2 hours ago", "3 days ago").
 *
 * Everything is best-effort: a missing or malformed events file silently
 * yields zero counts, never throws. The panel skips the events line in
 * that case and the user just sees the welcome line + project line.
 *
 * Kept out of IntroScreen.tsx so unit tests can hit the parsing and
 * humanization logic directly without rendering Ink.
 */

import * as fs from 'node:fs';
import { getEventsFile } from '../../../utils/storage-paths.js';
import { parseEventPlanContent } from '../../../lib/event-plan-parser.js';

export interface PreviousRunSummary {
  /** Number of events in the most recent events.json file. 0 if none readable. */
  eventCount: number;
  /** mtime of the freshest events file we found, or null if we found none. */
  lastRunAt: Date | null;
}

/**
 * Read `<installDir>/.amplitude/events.json` (canonical) and the legacy
 * `<installDir>/.amplitude-events.json` and return a summary of whichever
 * one has the most recent mtime. If neither exists, returns zero counts
 * and a null timestamp — the caller just hides the events line.
 *
 * This intentionally never throws. The IntroScreen renders during the
 * very first frame of a wizard run; an exception here would break the
 * whole intro for a user who has a junk JSON file lying around.
 */
export function readPreviousRunSummary(installDir: string): PreviousRunSummary {
  const canonical = getEventsFile(installDir);
  const legacy = `${installDir}/.amplitude-events.json`;

  // Pick the freshest of the two paths so we don't use a stale legacy
  // file as the "last run" signal when the user has run a more recent
  // wizard build that wrote canonical.
  let chosenPath: string | null = null;
  let chosenMtime = 0;
  for (const p of [canonical, legacy]) {
    try {
      const stat = fs.statSync(p);
      if (stat.isFile() && stat.mtime.getTime() > chosenMtime) {
        chosenPath = p;
        chosenMtime = stat.mtime.getTime();
      }
    } catch {
      // ENOENT / EACCES — file's just not there, that's fine.
    }
  }

  if (!chosenPath) {
    return { eventCount: 0, lastRunAt: null };
  }

  let eventCount = 0;
  try {
    const content = fs.readFileSync(chosenPath, 'utf-8');
    const parsed = parseEventPlanContent(content);
    if (parsed) {
      eventCount = parsed.filter((e) => e.name.trim().length > 0).length;
    }
    // If parseEventPlanContent returns null (malformed), eventCount stays 0
    // — we still surface the last-run timestamp because the file existing
    // at all is evidence of a previous run.
  } catch {
    // Read failed but stat succeeded — keep the timestamp, drop the count.
  }

  return {
    eventCount,
    lastRunAt: new Date(chosenMtime),
  };
}

/**
 * Format a Date as a human-readable relative age, e.g. "2 hours ago",
 * "3 days ago". Mirrors GitHub-style precision: minutes / hours / days /
 * months / years. Anything below a minute is "just now".
 *
 * We intentionally don't use `Intl.RelativeTimeFormat` here — it produces
 * locale-dependent output that would make snapshot tests flaky under
 * non-en-US locales. The wizard's UI strings are English-only today.
 */
export function humanizeAge(pastDate: Date, now: Date = new Date()): string {
  const deltaMs = now.getTime() - pastDate.getTime();
  // Future timestamps (clock skew, file copied from another machine) —
  // treat as "just now" rather than rendering a negative age.
  if (deltaMs < 0) return 'just now';

  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;

  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
