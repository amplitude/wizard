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

/**
 * Envelope (top-level) wire-format version. Bump on any breaking change
 * to the FRAME shape — i.e. the keys directly on the JSON line itself
 * (`v`, `@timestamp`, `type`, `message`, `session_id`, `run_id`,
 * `level`, `data`, `data_version`).
 *
 * Per-event `data` shapes get their own version on the envelope via
 * `data_version` (see below). Bumping `v` is for the framing layer
 * only.
 */
export const AGENT_EVENT_WIRE_VERSION = 1 as const;

/**
 * Per-event-type data-shape version. The key insight from orchestrator
 * feedback: pinning to envelope `v: 1` doesn't protect orchestrators
 * from breaking changes inside `data`. Adding/renaming a field on
 * (say) `event_plan_proposed` keeps envelope v=1 stable but silently
 * shifts the contract for that one event.
 *
 * Solution: every event whose `data` shape is part of the public API
 * carries a `data_version` integer on the envelope. Orchestrators
 * should branch on `(type, data?.event, data_version)` rather than
 * envelope `v` alone. The default for events without a registered
 * version is 1 — adding `data_version` to an event for the first time
 * is itself the v=1 baseline. Bump to 2 on the first breaking change.
 *
 * Why a flat number per event-type+discriminator instead of one global
 * counter: a global counter forces every orchestrator to upgrade in
 * lockstep when any event changes. Per-event versions let one event's
 * shape evolve without invalidating an orchestrator that only cares
 * about (e.g.) `tool_call` and `dashboard_created`.
 *
 * Registry: see `EVENT_DATA_VERSIONS` below — single source of truth.
 * To bump a version, update that map AND add a regression test pinning
 * the new shape.
 */
export const EVENT_DATA_VERSIONS = {
  // Lifecycle
  start_run: 1,
  /**
   * Terminal lifecycle event — emitted exactly once per run, immediately
   * before the process exits via `wizardSuccessExit` / `wizardAbort`.
   * Carries the structured outcome (`success` / `error` / `cancelled`),
   * the exit code the process is about to return, and the run duration.
   * Orchestrators should treat absence of `run_completed` as
   * "wizard crashed mid-stream" — distinct from a clean failure exit.
   */
  run_completed: 1,
  intro: 1,
  outro: 1,
  cancel: 1,
  auth_required: 1,
  nested_agent: 1,
  inner_agent_started: 1,
  // Project create. Discriminators must match the actual `data.event`
  // strings emitted by AgentUI — bugbot caught a previous mismatch
  // (`project_created` vs the emitted `project_create_success`) that
  // silently dropped the data_version stamp from those events.
  project_create_start: 1,
  project_create_success: 1,
  project_create_error: 1,
  // Tool / file changes
  tool_call: 1,
  file_change_planned: 1,
  file_change_applied: 1,
  // Event plan
  event_plan_proposed: 1,
  event_plan_confirmed: 1,
  event_plan: 1,
  event_plan_set: 1,
  // Verification
  verification_started: 1,
  verification_result: 1,
  // Other results
  events_detected: 1,
  dashboard_created: 1,
  /**
   * `agent_metrics` — emitted once per agent run at finalize time
   * with aggregated token usage, tool call counts, and run duration.
   * Lets orchestrators bill / cap / monitor cost without re-parsing
   * the full event stream. Token counts come straight from the
   * Claude Agent SDK's terminal `result` message.
   */
  agent_metrics: 1,
  /**
   * `decision_auto` — emitted alongside a `needs_input` whenever the
   * wizard auto-resolves the prompt (under `--auto-approve` /
   * `--yes` / `--ci` / `--force`, OR the `--agent`-implies-autoApprove
   * back-compat path). Lets orchestrators distinguish "you should
   * surface this question to a human" from "FYI, I auto-picked the
   * recommended value." Without it, a strict orchestrator subscribing
   * to `needs_input` would race the wizard's auto-resolve.
   *
   * Fires AFTER the corresponding `needs_input` so a single-event
   * subscriber that sees `needs_input` first is guaranteed to see the
   * auto-resolution next on the same stream.
   */
  decision_auto: 1,
} as const;

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
  /**
   * Per-event-type data-shape version. Optional because not every
   * event's `data` is part of the orchestrator-facing contract (e.g.
   * `log`, `status`, `progress` carry free-form payloads). When
   * present, orchestrators should branch on this value to handle
   * breaking changes to `data`.
   */
  data_version?: number;
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

/**
 * UI rendering hints — a tiny "UI protocol over NDJSON" that lets the
 * wizard nudge outer agents (Claude Code, Cursor, Codex) toward the right
 * widget without assuming any specific renderer is available. Outer agents
 * are free to ignore the hints and fall back to a plain numbered list, but
 * when they're respected the human-facing UX is dramatically better.
 */
export interface UiHints {
  /**
   * Suggested widget. Outer agents pick the closest match they can render:
   *   - 'searchable_select' — long lists; pair with `pagination`/`searchPlaceholder`
   *   - 'select'            — short list, no search needed
   *   - 'multiselect'       — pick N (not yet used)
   *   - 'confirmation'      — yes/no
   *   - 'secret_input'      — free text but mask on display (API key, token)
   *   - 'text_input'        — free text, no masking
   */
  component:
    | 'searchable_select'
    | 'select'
    | 'multiselect'
    | 'confirmation'
    | 'secret_input'
    | 'text_input';
  /** Importance signal — `required` blocks; `optional` can be skipped. */
  priority?: 'required' | 'recommended' | 'optional';
  /** Heading for the widget. Use the message for short context, title for the heading. */
  title?: string;
  /** One-sentence supporting context shown beneath the title. */
  description?: string;
  /** Placeholder shown in the search field of `searchable_select`. */
  searchPlaceholder?: string;
  /** Message rendered when `choices` is empty (e.g. "No projects yet — create one"). */
  emptyState?: string;
}

/** Pagination signals for long choice lists. */
export interface PaginationInfo {
  /** Total number of choices the wizard knows about across all pages. */
  total: number;
  /** Number of choices included in this event. */
  returned: number;
  /**
   * Optional CLI invocation an outer agent can run to fetch the next page or
   * a search-filtered subset. Pre-built so orchestrators don't have to
   * compose the command themselves.
   */
  nextCommand?: string[];
  /** When set, indicates the choices in this event are filtered by `query`. */
  query?: string;
}

/** Free-form fallback when the right answer isn't in `choices`. */
export interface ManualEntryHint {
  /**
   * CLI flag the outer agent should use to pass the value back. Pairs with
   * `--app-id 769610`-style rerun semantics so manual entry is just another
   * resume flag.
   */
  flag: string;
  /** Placeholder the renderer can show in the input. */
  placeholder?: string;
  /**
   * Optional regex the outer agent SHOULD validate against before submitting.
   * Stringified — outer agents that don't speak regex should treat this as
   * documentation only.
   */
  pattern?: string;
}

export interface NeedsInputChoice<V = string> {
  /** Stable machine value to round-trip back via stdin or resume flags. */
  value: V;
  /** Short human-readable label for the outer agent's UI. */
  label: string;
  /** Optional secondary hint (e.g. environment name, framework version). */
  hint?: string;
  /**
   * One-line supporting description — used by `searchable_select` widgets
   * to render a secondary line under the label. Distinct from `hint` so
   * outer agents can choose to render hint as a badge and description as
   * a sub-label.
   */
  description?: string;
  /**
   * Structured key/value metadata the outer agent can use for richer
   * rendering (org name, env name, region, last-used timestamp, etc.).
   * Keep values primitive — strings, numbers, booleans — so they render
   * cleanly in any widget.
   */
  metadata?: Record<string, string | number | boolean>;
  /**
   * Per-choice argv that re-invokes the wizard with this choice already
   * picked. Equivalent to the top-level `resumeFlags` lookup keyed by
   * `value`, but inlined on each choice so outer agents can produce
   * "click this card to continue" copy without two-step lookups.
   */
  resumeFlags?: string[];
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
  /** Rendering hints the outer agent can use to pick the right widget. */
  ui?: UiHints;
  /** Available choices, in display order. */
  choices: NeedsInputChoice<V>[];
  /** Recommended choice value (used when `--auto-approve` is set). */
  recommended?: V;
  /** Why `recommended` was chosen — surfaced in the UI as a tooltip / badge. */
  recommendedReason?: string;
  /**
   * argv that, when re-invoked, resolves this prompt for each choice.
   * Outer agents prefer this to piping to stdin since it's stateless.
   * Per-choice flags are also available on each `NeedsInputChoice.resumeFlags`.
   */
  resumeFlags?: { value: V; flags: string[] }[];
  /**
   * Optional JSON shape the wizard accepts on stdin instead of a re-invoke.
   * Documents the round-trip format for stdin-driven orchestrators.
   */
  responseSchema?: Record<string, string>;
  /** Pagination metadata for long choice lists. */
  pagination?: PaginationInfo;
  /**
   * When `true`, the outer agent MAY collect free-form input from the user
   * instead of one of the listed choices. `manualEntry` describes the flag
   * to use when re-invoking with that input.
   */
  allowManualEntry?: boolean;
  manualEntry?: ManualEntryHint;
}

/**
 * Wire-format shape of the `data` field in a `needs_input` NDJSON line.
 *
 * `emitNeedsInput` hoists `message` to the envelope level and injects the
 * `event` discriminator, so the on-wire `data` omits `message` and includes
 * `event: 'needs_input'`.
 */
export interface NeedsInputWireData<V = string> {
  event: 'needs_input';
  code: string;
  ui?: UiHints;
  choices: NeedsInputChoice<V>[];
  recommended?: V;
  recommendedReason?: string;
  resumeFlags?: { value: V; flags: string[] }[];
  responseSchema?: Record<string, string>;
  pagination?: PaginationInfo;
  allowManualEntry?: boolean;
  manualEntry?: ManualEntryHint;
}

export type NeedsInputEvent<V = string> = AgentEventEnvelope<
  NeedsInputWireData<V>
>;

// ── Inner-agent lifecycle ───────────────────────────────────────────
//
// The wizard runs a Claude SDK agent under the hood. Today, outer agents
// have no visibility into what that inner agent is doing — they see start
// + stop + the final outro. The events below surface the in-flight state
// so an outer orchestrator can mirror the inner agent's progress, attribute
// file changes to specific tools, and decide when to abort.
//
// Each event is emitted from a hook (PreToolUse / PostToolUse / SessionStart /
// Stop) on the inner Claude SDK. They land on the SAME stdout NDJSON stream
// as the rest of the agent-mode events, so outer agents only need one parser.

/** `inner_agent_started` — emitted at SessionStart of the inner Claude run. */
export interface InnerAgentStartedData {
  event: 'inner_agent_started';
  model: string;
  /** 'plan' / 'apply' / 'verify' / 'wizard' depending on the entry command. */
  phase: 'plan' | 'apply' | 'verify' | 'wizard';
  /** Optional plan ID when running under `apply --plan-id`. */
  planId?: string;
}

/**
 * `run_completed` — terminal lifecycle event emitted exactly once per
 * run, immediately before the process calls `process.exit()`.
 *
 * Why this event exists: prior to this, an orchestrator parsing NDJSON
 * had no way to distinguish "wizard finished cleanly and closed
 * stdout" from "wizard crashed mid-stream and Node tore the pipe
 * down." Both look identical (stream EOF) to the consumer.
 *
 * Contract: orchestrators MUST treat absence of `run_completed` before
 * the stream ends as "wizard crashed" and surface a generic failure to
 * their caller. The presence of `run_completed` with `outcome:
 * "success"` and `exitCode: 0` is the only signal of a clean run.
 *
 * The event is wired into the singular exit funnels in
 * `src/utils/wizard-abort.ts` (`wizardSuccessExit` and `wizardAbort`).
 * Anything that calls `process.exit()` directly bypasses this event,
 * which is by design — direct exits are bugs and should be migrated.
 */
export interface RunCompletedData {
  event: 'run_completed';
  /**
   * High-level outcome. Distinct from `exitCode` because two different
   * exit codes can map to the same outcome (e.g. AGENT_FAILED and
   * INTERNAL_ERROR are both `error`), and orchestrators frequently
   * just want a tri-state for log-line color / dashboard rollups.
   */
  outcome: 'success' | 'error' | 'cancelled';
  /** Numeric exit code the process is about to return. */
  exitCode: number;
  /** Wall-clock duration of the run, in milliseconds. */
  durationMs: number;
  /**
   * Optional reason string when `outcome !== 'success'`. Sanitized via
   * the same redactor used by `setRunError` — paths / URLs scrubbed.
   * Free-form, intended for orchestrator log lines, not for
   * programmatic branching (use `exitCode` for that).
   */
  reason?: string;
}

/**
 * `tool_call` — emitted at PreToolUse for every tool the inner agent calls.
 * Carries a sanitized summary so secrets / large prompts don't leak.
 */
export interface ToolCallData {
  event: 'tool_call';
  tool: string;
  /** Short summary of the input — file path for Read/Edit, command head for Bash, etc. */
  summary?: string;
}

/**
 * `file_change_planned` — emitted at PreToolUse for write tools (Edit /
 * Write / MultiEdit / NotebookEdit). The change has been requested by the
 * agent but not yet executed; outer agents can stream this to a human to
 * preview before approving.
 */
export interface FileChangePlannedData {
  event: 'file_change_planned';
  path: string;
  operation: 'create' | 'modify' | 'delete';
}

/**
 * `file_change_applied` — emitted at PostToolUse for write tools that
 * succeeded. Pairs with `file_change_planned` (same path) so outer agents
 * can build an audit trail of "the wizard wrote these N files."
 */
export interface FileChangeAppliedData {
  event: 'file_change_applied';
  path: string;
  operation: 'create' | 'modify' | 'delete';
  /** Optional byte size of the new content for sanity checking. */
  bytes?: number;
}

/** `event_plan_proposed` — emitted when the inner agent calls `confirm_event_plan`. */
export interface EventPlanProposedData {
  event: 'event_plan_proposed';
  events: Array<{ name: string; description: string }>;
}

/** `event_plan_confirmed` — emitted after the user/orchestrator decides on the plan. */
export interface EventPlanConfirmedData {
  event: 'event_plan_confirmed';
  /**
   * How the decision was made:
   *   - 'auto' — `--auto-approve` / `--yes` / `--ci` / `--agent` silently approved
   *   - 'human' — interactive TUI user pressed approve
   *   - 'flag' — explicit `--approve-events` flag (future)
   */
  source: 'auto' | 'human' | 'flag';
  decision: 'approved' | 'skipped' | 'revised';
}

/** `verification_started` — emitted just before the wizard runs its post-apply checks. */
export interface VerificationStartedData {
  event: 'verification_started';
  phase: 'sdk_present' | 'api_key' | 'ingestion' | 'overall';
}

/** `verification_result` — emitted after each verification phase. */
export interface VerificationResultData {
  event: 'verification_result';
  phase: 'sdk_present' | 'api_key' | 'ingestion' | 'overall';
  success: boolean;
  /** Human-readable reasons for failure. Empty when success=true. */
  failures?: string[];
}

export type InnerAgentLifecycleData =
  | InnerAgentStartedData
  | ToolCallData
  | FileChangePlannedData
  | FileChangeAppliedData
  | EventPlanProposedData
  | EventPlanConfirmedData
  | VerificationStartedData
  | VerificationResultData;

// ── Tool-input summarizer ───────────────────────────────────────────
//
// PreToolUse hooks receive the raw tool input which can include large
// prompts, full file contents, or shell commands. We surface only a short
// summary string in NDJSON so:
//   - large file contents don't blow up the outer agent's context
//   - commands stay scannable in a transcript
//   - prompts/messages aren't leaked downstream

/** Truncate a string for inclusion in NDJSON event payloads. */
export function summarizeForEvent(s: string, max = 120): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Best-effort summarizer for PreToolUse `input` payloads. Recognizes the
 * common Claude tools (Read/Edit/Write/Bash/Grep/Glob/Task/TodoWrite/MCP)
 * and produces a short human-readable string. Falls back to a JSON head
 * for unknown tool shapes.
 */
export function summarizeToolInput(
  toolName: string,
  input: unknown,
): string | undefined {
  if (input === null || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  switch (toolName) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return typeof obj.file_path === 'string'
        ? summarizeForEvent(obj.file_path)
        : typeof obj.path === 'string'
        ? summarizeForEvent(obj.path)
        : undefined;
    case 'Bash':
      return typeof obj.command === 'string'
        ? summarizeForEvent(obj.command)
        : undefined;
    case 'Grep':
    case 'Glob':
      return typeof obj.pattern === 'string'
        ? summarizeForEvent(obj.pattern)
        : undefined;
    case 'Task':
      return typeof obj.description === 'string'
        ? summarizeForEvent(obj.description)
        : undefined;
    case 'TodoWrite':
      return Array.isArray(obj.todos)
        ? `${obj.todos.length} todo(s)`
        : undefined;
    default: {
      // Unknown tool: emit a short JSON head, stripped of newlines.
      try {
        return summarizeForEvent(
          JSON.stringify(input).replace(/\s+/g, ' '),
          80,
        );
      } catch {
        return undefined;
      }
    }
  }
}

/**
 * Map a Claude write-tool name to the operation kind the wire format
 * exposes. `Write` always creates (or overwrites), `Edit` / `MultiEdit` /
 * `NotebookEdit` modify. Returns null for non-write tools so callers can
 * skip emission cleanly.
 */
export function classifyWriteOperation(
  toolName: string,
): FileChangeAppliedData['operation'] | null {
  switch (toolName) {
    case 'Write':
      return 'create';
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'modify';
    default:
      return null;
  }
}
