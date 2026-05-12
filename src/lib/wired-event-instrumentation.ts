/**
 * wired-event-instrumentation — classify plan events as "instrumented via
 * track()" vs "covered by autocapture" by reading the actual file content
 * the agent wrote during this run.
 *
 * Why this exists
 *
 * The wizard's outro previously rendered `store.eventPlan` as the
 * celebration list: "N events instrumented" with every plan entry shown
 * as if it were wired up. Two ways that lied:
 *
 *   1. **Name casing.** `confirm_event_plan` normalizes proposed names to
 *      Title Case before persisting to `.amplitude/events.json`. The
 *      agent often takes the user's feedback ("use lowercase") and writes
 *      `amplitude.track("app loaded", ...)` in the code — but the plan
 *      keeps the older Title Case shape (`App Loaded`). The outro showed
 *      the Title Case copy; the Setup Report read straight from the wired
 *      code. The two disagreed in front of the user.
 *
 *   2. **Coverage type.** When the agent decides an event is already
 *      handled by Amplitude autocapture (sessions / page views / form
 *      interactions / clicks for web SDKs), it deliberately does NOT
 *      write a `track()` call for it. Those events still appear in the
 *      plan — they're real events the project will collect — but
 *      claiming they were "instrumented" in the Wizard API sense is
 *      false. The Setup Report distinguishes; the outro didn't.
 *
 * What this module returns
 *
 * Given the wizard's plan and access to the per-run file-change ledger
 * (every file the agent's Write / Edit / MultiEdit tools touched), this
 * module:
 *
 *   - Walks the ledger's `afterContent` snapshots
 *   - Greps each one for `track('...')` / `track("...")` /
 *     `.track("...")` invocations (any language — JS / TS / Python /
 *     Swift / Kotlin / Go all use `track("event-name", ...)` as the SDK
 *     call shape)
 *   - For each plan event, asks "did any wired file mention this name?"
 *     — case-insensitive, since the canonical plan is Title Case but
 *     the wired code may be lowercase or original-cased
 *
 * The plan is the source of truth for descriptions and the canonical
 * roster of events; the wired code is the source of truth for **whether
 * a name was actually written** and **what the name actually looks like
 * in the code**. We trust the wired-code casing — the Title-Cased
 * version in the plan is a normalization artifact, not user intent.
 *
 * Outputs:
 *
 *   ```ts
 *   {
 *     instrumented: [{ name, description }],   // appeared in some track() call
 *     autocaptured: [{ name, description }],   // in plan, NOT in any track() call
 *   }
 *   ```
 *
 * Names in `instrumented` are the wired-code casing when found;
 * `autocaptured` names are the plan's canonical casing (since there's no
 * wired-code form to fall back to).
 *
 * Pure module — no I/O of its own. The caller passes file contents
 * (either harvested from the ledger or — in tests — provided directly).
 * This keeps the helper trivially unit-testable without booting the
 * full wizard.
 */

import type { FileChangeEntry } from './file-change-ledger.js';

/**
 * Minimal shape consumed by the classifier. Mirrors `PlannedEvent` in
 * the store and `SetupCompleteEvent` in agent-events — both already
 * have `name` + optional `description`. Kept structural here so callers
 * can pass either shape without an adapter.
 */
export interface PlanEventInput {
  name: string;
  description?: string;
}

/** Returned shape for an event the wizard claims to have wired up. */
export interface ClassifiedEvent {
  /**
   * The name to render. For instrumented events, this is the EXACT
   * spelling found in the wired code (e.g. `"app loaded"`) so the
   * celebration matches the diff and the Setup Report. For autocaptured
   * events, falls back to the plan's name (canonical casing).
   */
  name: string;
  /** From the plan, since wired code doesn't carry descriptions. */
  description: string;
}

export interface InstrumentationClassification {
  instrumented: ClassifiedEvent[];
  autocaptured: ClassifiedEvent[];
}

/**
 * Regex matching SDK-style `track()` callsites across the languages the
 * wizard targets. Three forms:
 *
 *   1. `track("Event Name", ...)`           — JS / TS / Swift / Kotlin / Go
 *   2. `.track("Event Name", ...)`          — method form (`amplitude.track(...)`,
 *                                              `analytics.track(...)`, etc.)
 *   3. `track('event name', ...)`           — single-quoted variant
 *
 * Captures the inner string literal in group 1. Intentionally permissive
 * on the suffix — we don't try to validate the rest of the call — so the
 * agent can pass properties, callbacks, async/await wrappers, anything.
 *
 * Limitations (acceptable for this read-only celebration display):
 *
 *   - Misses template-literal calls (`track(\`User ${verb}\``). The
 *     wizard's commandments tell the agent to use literal strings, and
 *     no current integration skill emits template-literal track names.
 *     If that ever changes, the outro just under-counts — it never
 *     over-counts, which is the dangerous failure direction.
 *   - Misses Python f-strings — same reason as template literals.
 *   - Doesn't try to disambiguate `track("Foo")` from
 *     `someOther.track("Foo")`. Both count as "an event named Foo was
 *     written to disk", which is what we want.
 *   - Doesn't validate that the surrounding token is `track` — a method
 *     named `bracket` on some unrelated lib would match too. In practice
 *     the only `track(...)` shaped calls in wizard-touched files are
 *     analytics; collisions would be very rare and the worst outcome is
 *     a single false-positive "instrumented" event in the celebration.
 */
const TRACK_CALL_RE = /\btrack\s*\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g;

/**
 * Lowercase + collapse-whitespace key for fuzzy event-name matching.
 *
 * Why fuzzy: the plan is normalized to Title Case (`App Loaded`) but the
 * wired code may use lowercase (`app loaded`) or any other casing the
 * agent decided on after honoring user feedback. Comparing on the
 * lowercased, whitespace-collapsed form catches all common variants
 * without trying to be clever about word boundaries.
 *
 * We DON'T strip punctuation — `Form: Submit` vs `Form Submit` are
 * meaningfully different to Amplitude. Whitespace collapse is enough.
 */
function eventKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Scan a single file's content for `track(...)` callsites and return
 * the event names found, in source order, deduplicated.
 *
 * Returns the names with their original casing — the caller decides
 * whether to compare case-insensitively (via `eventKey`) or display them
 * as-is.
 */
export function extractTrackCallNames(content: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  TRACK_CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TRACK_CALL_RE.exec(content)) !== null) {
    const raw = match[2];
    if (!raw) continue;
    // Strip simple backslash escapes so `\"User Signed Up\"` ends up as
    // `User Signed Up`. The regex captured the inner content; escape
    // unwrapping is purely cosmetic for display.
    const name = raw.replace(/\\(["'\\])/g, '$1').trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Walk a set of file-change entries and return every event name that
 * appears in any `track()` call across all written/modified files.
 * Returns a Map keyed by lowercase-collapsed name → first-seen original
 * casing so the caller can both match-against (case-insensitive) and
 * render (preferring the wired-code spelling over the plan's spelling).
 *
 * Entries with no `afterContent` (e.g. ledger captured PreToolUse but
 * PostToolUse never fired, or a `delete` entry) are skipped silently —
 * they can't have wired event names.
 */
export function collectWiredEventNames(
  entries: readonly Pick<FileChangeEntry, 'afterContent'>[],
): Map<string, string> {
  const byKey = new Map<string, string>();
  for (const entry of entries) {
    const content = entry.afterContent;
    if (!content) continue;
    for (const name of extractTrackCallNames(content)) {
      const key = eventKey(name);
      if (!byKey.has(key)) byKey.set(key, name);
    }
  }
  return byKey;
}

/**
 * Classify a plan into instrumented (track() was written) vs
 * autocaptured (in the plan, no track() in any wired file).
 *
 * `wiredNames` is the map returned by {@link collectWiredEventNames}.
 * The caller is responsible for collecting it from the run's ledger —
 * this function stays pure for testability.
 *
 * Empty plan → both arrays empty. Empty wiredNames + non-empty plan →
 * everything lands in `autocaptured`, which is the correct
 * interpretation when the agent decided no custom tracking was needed.
 */
export function classifyPlanAgainstWiredCode(
  plan: readonly PlanEventInput[],
  wiredNames: ReadonlyMap<string, string>,
): InstrumentationClassification {
  const instrumented: ClassifiedEvent[] = [];
  const autocaptured: ClassifiedEvent[] = [];
  for (const entry of plan) {
    const planName = entry.name?.trim();
    if (!planName) continue;
    const description = entry.description ?? '';
    const wired = wiredNames.get(eventKey(planName));
    if (wired) {
      // Prefer the spelling that actually landed in the code. The plan's
      // Title-Cased version is a normalization artifact; the wired
      // version reflects whatever the agent (and the user, via feedback)
      // settled on.
      instrumented.push({ name: wired, description });
    } else {
      autocaptured.push({ name: planName, description });
    }
  }
  return { instrumented, autocaptured };
}
