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
