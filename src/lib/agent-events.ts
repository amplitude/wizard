/**
 * Agent-mode NDJSON event schema.
 *
 * The wizard's `--agent` mode emits one JSON line per significant moment to
 * stdout. Outer agents (Claude Code, Cursor, Codex, custom orchestrators)
 * parse these to drive their own UX — display login URLs, inspect plans,
 * decide whether to retry, surface choices to the human.
 *
 * This module is the source of truth for that wire format. Every event is a
 * member of `AgentEvent` and shares the `AgentEventEnvelope` shape:
 *
 *   { v, '@timestamp', type, message, session_id, run_id, data, level? }
 *
 * Schema rules:
 *   - `v` is the wire-format version. Bump on any breaking shape change.
 *   - Discriminator is `data.event` for `lifecycle` / `prompt` / `result` / `error` events.
 *   - Never include access tokens, API keys, refresh tokens, or full URLs
 *     containing query-string secrets in any payload.
 *   - Resume hints (`resumeFlags`, `resumeCommand`) are arrays of CLI argv,
 *     not shell strings, so outer agents can spawn directly.
 *
 * The `AgentUI` class (`src/ui/agent-ui.ts`) is the only writer of these
 * events. New events MUST land here first so the schema doc and the emitter
 * stay in sync.
 */

/** Wire-format version. Bump on any breaking shape change. */
export const AGENT_EVENT_WIRE_VERSION = 1 as const;

/** All NDJSON event-level types. */
export type AgentEventType =
  | 'lifecycle'
  | 'log'
  | 'status'
  | 'progress'
  | 'session_state'
  | 'prompt'
  | 'needs_input'
  | 'diagnostic'
  | 'result'
  | 'error';

/** Base envelope shared by every NDJSON line. */
export interface AgentEventEnvelope<TData = unknown> {
  v: typeof AGENT_EVENT_WIRE_VERSION;
  '@timestamp': string;
  type: AgentEventType;
  message: string;
  session_id?: string;
  run_id?: string;
  level?: 'info' | 'warn' | 'error' | 'success' | 'step';
  data?: TData;
}

// ── needs_input ─────────────────────────────────────────────────────
//
// Emitted whenever the wizard would otherwise auto-select or silently choose
// a default. Outer agents can inspect `choices` + `recommended`, surface the
// decision to a human, and resume with `resumeFlags` (preferred) or by
// piping a JSON line to stdin matching `responseSchema`.
//
// When `--auto-approve` is set, `needs_input` is still emitted (for audit)
// but the wizard proceeds with `recommended` automatically. When neither
// `--auto-approve` nor `--yes` are set in agent mode, the wizard exits with
// `INPUT_REQUIRED` (exit code 12) after emitting this event.

export interface NeedsInputChoice<V = string> {
  /** Stable machine value to round-trip back via stdin or resume flags. */
  value: V;
  /** Short human-readable label for the outer agent's UI. */
  label: string;
  /** Optional secondary hint (e.g. environment name, framework version). */
  hint?: string;
}

export interface NeedsInputData<V = string> {
  /**
   * Stable machine code identifying *what* is being asked. Outer agents key
   * off this to decide how to surface the question. Examples:
   *   - 'environment_selection'
   *   - 'project_selection'
   *   - 'framework_disambiguation'
   *   - 'event_plan_approval'
   *   - 'destructive_overwrite_confirm'
   */
  code: string;
  /** Short human-readable description of the question. */
  message: string;
  /** Available choices, in display order. */
  choices: NeedsInputChoice<V>[];
  /** Recommended choice value (used when `--auto-approve` is set). */
  recommended?: V;
  /**
   * argv that, when re-invoked, resolves this prompt for each choice.
   * Outer agents prefer this to piping to stdin since it's stateless.
   */
  resumeFlags?: { value: V; flags: string[] }[];
  /**
   * Optional JSON shape the wizard accepts on stdin instead of a re-invoke.
   * Documents the round-trip format for stdin-driven orchestrators.
   */
  responseSchema?: Record<string, string>;
}

export type NeedsInputEvent<V = string> = AgentEventEnvelope<NeedsInputData<V>>;

// ── Type guard helpers ──────────────────────────────────────────────

export function isNeedsInputEvent(
  event: AgentEventEnvelope<unknown>,
): event is NeedsInputEvent<unknown> {
  return event.type === 'needs_input';
}
