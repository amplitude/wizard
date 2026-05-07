/**
 * Canonical wizard tasks — the four user-visible progress steps.
 *
 * The agent commandment in `src/lib/commandments.ts` instructs the LLM
 * to emit TodoWrite using these exact labels in this order. The TUI
 * store (`syncTodos` in `store.ts`) treats this list as the source of
 * truth for the rendered checklist: it pre-populates these four rows
 * on `RunPhase.Running`, matches incoming TodoWrite entries by exact
 * label, and drops anything that doesn't match. That keeps LLM drift
 * (a renamed step on retry, a stray fifth todo) from reordering or
 * regressing the user-visible journey.
 *
 * History: this list was 5 steps until DEFER_DASHBOARD_PLAN.md PR 4
 * removed `dashboard` — dashboard creation now happens in the deferred
 * `amplitude-wizard dashboard` command, which runs once event ingestion
 * has caught up. `wire` is the terminal step of the main run.
 *
 * Order matters — index 0 is the first step shown, index 3 is the last.
 */
export interface CanonicalStep {
  /** Stable identifier; index in CANONICAL_STEPS == step order. */
  readonly id: 'detect' | 'install' | 'plan' | 'wire';
  /** User-visible label shown in the progress list. Must match the agent commandment exactly. */
  readonly label: string;
  /** Default activeForm shown when the step is in_progress and the agent has not provided one. */
  readonly defaultActiveForm: string;
}

export const CANONICAL_STEPS: readonly CanonicalStep[] = [
  {
    id: 'detect',
    label: 'Detect your project setup',
    defaultActiveForm: 'Detecting your project setup',
  },
  {
    id: 'install',
    label: 'Install Amplitude',
    defaultActiveForm: 'Installing Amplitude',
  },
  {
    id: 'plan',
    label: 'Plan and approve events to track',
    defaultActiveForm: 'Planning events to track',
  },
  {
    id: 'wire',
    label: 'Wire up event tracking',
    defaultActiveForm: 'Wiring up event tracking',
  },
] as const;

/** The canonical labels in order — convenience for callers that only need the strings. */
export const CANONICAL_LABELS: readonly string[] = CANONICAL_STEPS.map(
  (s) => s.label,
);

/**
 * Match an agent-emitted TodoWrite content string to a canonical step.
 * Case-insensitive exact-label match only — anything else returns -1
 * and is dropped by the renderer. The system prompt is the contract;
 * we don't paper over drift here.
 */
export function matchCanonicalStep(content: string): number {
  if (!content) return -1;
  const lc = content.toLowerCase().trim();
  if (!lc) return -1;
  for (let i = 0; i < CANONICAL_STEPS.length; i++) {
    if (CANONICAL_STEPS[i].label.toLowerCase() === lc) return i;
  }
  return -1;
}
