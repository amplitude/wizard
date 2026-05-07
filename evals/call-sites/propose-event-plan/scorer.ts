/**
 * Scorer for the `propose_event_plan` call site.
 *
 * Per MIGRATION_PLAN.md §7.4, structured-output sites get schema +
 * semantic checks rather than wire-equality. Three asserts:
 *
 *   1. Event count is within the fixture's `maxEvents` (no spam).
 *   2. Every event name is snake_case (no Title Case, kebab, or
 *      mixed-case slipping past the wizard's normalization layer).
 *   3. No obviously hallucinated names (no `click`, `do_thing`,
 *      `trigger`, `event` — these are tells the model gave up).
 *
 * The hallucination list is deliberately short and conservative; it
 * lives here rather than in a shared module because each call site's
 * notion of "obvious garbage" is different.
 */

import type {
  CallSiteArtifact,
  CallSiteFixture,
  CallSiteScorer,
  ScorerResult,
} from '../types.js';

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

/**
 * Names that almost always indicate the model gave up and emitted a
 * placeholder. Keep the list short — false positives here defeat the
 * point of the scorer.
 */
const OBVIOUSLY_HALLUCINATED = new Set([
  'click',
  'event',
  'trigger',
  'do_thing',
  'something_happened',
  'placeholder',
  'tbd',
  'todo',
]);

interface ProposedEvent {
  name: string;
  description?: string;
  properties?: Array<{ name: string; type: string }>;
}

interface ProposeEventPlanOutput {
  events: ProposedEvent[];
}

function isProposeEventPlanOutput(x: unknown): x is ProposeEventPlanOutput {
  if (!x || typeof x !== 'object') return false;
  const o = x as { events?: unknown };
  if (!Array.isArray(o.events)) return false;
  return o.events.every(
    (e) =>
      e &&
      typeof e === 'object' &&
      typeof (e as { name?: unknown }).name === 'string',
  );
}

export const scorer: CallSiteScorer = {
  id: 'CS-propose-event-plan-shape',
  layer: 1,
  description:
    '`propose_event_plan` output must be ≤ maxEvents, all snake_case names, no hallucinated placeholders.',
  evaluate(artifact: CallSiteArtifact, fixture: CallSiteFixture): ScorerResult {
    if (!isProposeEventPlanOutput(artifact.output)) {
      return {
        pass: false,
        weight: 10,
        detail: 'output did not match { events: [{ name, ... }] } shape',
      };
    }

    const events = artifact.output.events;
    const maxEvents =
      typeof (fixture.input as { maxEvents?: number }).maxEvents === 'number'
        ? (fixture.input as { maxEvents: number }).maxEvents
        : 25;

    if (events.length > maxEvents) {
      return {
        pass: false,
        weight: 10,
        detail: `event plan has ${events.length} events, exceeds maxEvents=${maxEvents}`,
      };
    }

    if (events.length === 0) {
      return {
        pass: false,
        weight: 10,
        detail: 'event plan is empty — at least one event is required',
      };
    }

    const seen = new Set<string>();
    for (const ev of events) {
      const name = ev.name;
      if (!SNAKE_CASE.test(name)) {
        return {
          pass: false,
          weight: 10,
          detail: `event name not snake_case: "${name}"`,
        };
      }
      if (OBVIOUSLY_HALLUCINATED.has(name)) {
        return {
          pass: false,
          weight: 10,
          detail: `event name is an obvious hallucination: "${name}"`,
        };
      }
      if (seen.has(name)) {
        return {
          pass: false,
          weight: 10,
          detail: `event name is duplicated: "${name}"`,
        };
      }
      seen.add(name);
    }

    return { pass: true, weight: 10 };
  },
};
