/**
 * Canonical wizard tasks — the five user-visible progress steps.
 *
 * These are the source of truth for the progress checklist the user sees
 * during the agent run. The agent commandment in
 * `src/lib/commandments.ts` instructs the LLM to emit TodoWrite using
 * these exact labels, but compliance is unreliable across long runs and
 * retries. The TUI store treats this list as the canonical structure and
 * buckets agent output into it — see `bucketTodoToCanonicalStep` and
 * `syncTodos` in `store.ts`.
 *
 * Keeping the labels and order locked in code means LLM drift can't
 * unstick the progress bar: tasks can't reorder, regress, or duplicate
 * even if the agent renames a step mid-run.
 *
 * Order matters — index 0 is the first step shown, index 4 is the last.
 */
export interface CanonicalStep {
  /** Stable identifier; index in CANONICAL_STEPS == step order. */
  readonly id: 'detect' | 'install' | 'plan' | 'wire' | 'dashboard';
  /** User-visible label shown in the progress list. */
  readonly label: string;
  /** Default activeForm shown when the step is in_progress and the agent has not provided one. */
  readonly defaultActiveForm: string;
  /**
   * Lowercase keyword fragments used to match agent-emitted todos to this
   * step when the label doesn't match exactly. Order is significant:
   * earlier keywords are weighted higher. Pick fragments distinct enough
   * that step N doesn't match step M's wording.
   */
  readonly keywords: readonly string[];
}

export const CANONICAL_STEPS: readonly CanonicalStep[] = [
  {
    id: 'detect',
    label: 'Detect your project setup',
    defaultActiveForm: 'Detecting your project setup',
    keywords: [
      'detect',
      'inspect',
      'framework',
      'project setup',
      'analyze project',
    ],
  },
  {
    id: 'install',
    label: 'Install Amplitude',
    defaultActiveForm: 'Installing Amplitude',
    keywords: ['install', 'sdk', 'depend', 'package', 'add amplitude'],
  },
  {
    id: 'plan',
    label: 'Plan and approve events to track',
    defaultActiveForm: 'Planning events to track',
    keywords: ['plan', 'approve', 'taxonomy', 'event plan', 'propose event'],
  },
  {
    id: 'wire',
    label: 'Wire up event tracking',
    defaultActiveForm: 'Wiring up event tracking',
    keywords: [
      'wire',
      'wiring',
      'instrument',
      'track call',
      'tracking',
      'add track',
      'write track',
    ],
  },
  {
    id: 'dashboard',
    label: 'Open your dashboard',
    defaultActiveForm: 'Opening your dashboard',
    keywords: [
      'dashboard',
      'report',
      'outro',
      'finalize',
      'finalizing',
      'wrap up',
    ],
  },
] as const;

/** The canonical labels in order — convenience for callers that only need the strings. */
export const CANONICAL_LABELS: readonly string[] = CANONICAL_STEPS.map(
  (s) => s.label,
);

/**
 * Match an agent-emitted TodoWrite content string to a canonical step.
 *
 * Strategy:
 *   1. Exact (case-insensitive) match against the canonical label — fast path
 *      when the agent followed the commandment.
 *   2. Keyword scan — for each step, score by the number of keyword fragments
 *      that appear in the lowercased content. Highest score wins; ties broken
 *      by step order (earlier wins, since the first canonical step is the
 *      first thing the agent does).
 *
 * Returns the step index, or `-1` if nothing matched. A `-1` return tells
 * `syncTodos` to drop the todo: the user-visible list stays at exactly
 * five rows even if the agent decides to add a sixth.
 */
export function bucketTodoToCanonicalStep(content: string): number {
  if (!content) return -1;
  const lc = content.toLowerCase().trim();
  if (!lc) return -1;

  for (let i = 0; i < CANONICAL_STEPS.length; i++) {
    if (CANONICAL_STEPS[i].label.toLowerCase() === lc) return i;
  }

  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < CANONICAL_STEPS.length; i++) {
    const step = CANONICAL_STEPS[i];
    let score = 0;
    for (const kw of step.keywords) {
      if (lc.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}
