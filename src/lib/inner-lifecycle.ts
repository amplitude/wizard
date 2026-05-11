/**
 * inner-lifecycle — bridge from Claude SDK hooks to UI events.
 *
 * The wizard runs an inner Claude SDK agent and exposes hooks for
 * PreToolUse / PostToolUse / SessionStart / Stop.
 *
 * Two classes of events flow through here:
 *
 *  1. **NDJSON-only inner-agent telemetry** (SessionStart →
 *     `inner_agent_started`, every tool call → `tool_call`, verification
 *     phases). These only matter to outer agents auditing the inner run,
 *     so the helpers early-return unless `--agent` mode is active.
 *
 *  2. **File-change events** (`recordFileChangePlanned` /
 *     `recordFileChangeApplied`). Routed through the abstract `WizardUI`
 *     so the TUI's `FileWritesPanel` populates as the inner agent writes,
 *     while AgentUI continues to emit the existing
 *     `file_change_planned` / `file_change_applied` NDJSON envelope on
 *     stdout (schema v:1, unchanged for outer-agent compatibility).
 *
 * Hook factories in `agent-interface.ts` should compose these helpers
 * into their callbacks rather than calling `emit*` on the UI directly.
 *
 * Integration point (deferred to follow-up to avoid conflicts with #243's
 * PreToolUse refactor):
 *
 * ```ts
 * // src/lib/agent-interface.ts, inside buildHooksConfig({...})
 * import { createInnerLifecycleHooks } from './inner-lifecycle.js';
 * const inner = createInnerLifecycleHooks({ phase: 'wizard' });
 * buildHooksConfig({
 *   ...inner.hooks(),
 *   Stop: createStopHook(...),
 * });
 * ```
 */

import nodePath from 'node:path';
import { getUI } from '../ui/index.js';
import { AgentUI } from '../ui/agent-ui.js';
import {
  classifyFileChangeError,
  classifyWriteOperation,
  summarizeToolInput,
  type InnerAgentStartedData,
} from './agent-events.js';
import type { ToolCallOutcome } from './agent-events.js';
import type { HookCallback } from './agent-hooks.js';
import { getFileChangeLedger } from './file-change-ledger.js';
import { formatToolCallLabel } from './tool-call-label.js';

/**
 * Type guard: returns the UI cast to AgentUI if we're in agent mode,
 * otherwise null. Used by every helper below to early-return cleanly
 * when the run isn't emitting NDJSON.
 */
function getAgentUI(): AgentUI | null {
  try {
    const ui = getUI();
    return ui instanceof AgentUI ? ui : null;
  } catch {
    return null;
  }
}

export interface InnerLifecycleConfig {
  /** Wizard phase the inner agent is running under. */
  phase: InnerAgentStartedData['phase'];
  /** Model identifier (Sonnet, Opus, …). Surfaced in `inner_agent_started`. */
  model?: string;
  /** Optional plan ID when running under `apply --plan-id`. */
  planId?: string;
  /**
   * Wizard install directory — when supplied, used to relativize the
   * absolute `path` the inner agent passes to write tools so the
   * `current_file` event ships a renderable `relativePath`. Falls back
   * to basename when the file lives outside `installDir`. Optional
   * because hook factories that don't have it (probe calls, tests) can
   * still emit the raw path safely.
   */
  installDir?: string;
}

/**
 * Best-effort relativization for the `current_file` event. Returns
 * `path.relative(installDir, abs)` when `abs` lives inside `installDir`,
 * otherwise falls back to the basename so orchestrators still see a
 * renderable short label. Pure — no I/O, no throws.
 */
function relativizeForCurrentFile(
  abs: string,
  installDir: string | undefined,
): string {
  if (!installDir) return abs;
  try {
    const rel = nodePath.relative(installDir, abs);
    if (!rel || rel.startsWith('..')) return nodePath.basename(abs);
    return rel;
  } catch {
    return abs;
  }
}

/**
 * Inspect a PostToolUse hook input for a tool-result error. The SDK
 * surfaces failures via either `tool_response.is_error` /
 * `tool_response.error` (newer hook shape) or a stringified result
 * containing common error markers. Returns the sanitized message when
 * a failure is detected, null when the tool succeeded. Pure — no
 * I/O, no throws.
 */
/**
 * Extract the SDK's `tool_use_id` from a hook input — the stable
 * correlation key that pairs a PreToolUse `tool_call` with its
 * matching PostToolUse `tool_response`. The SDK consistently surfaces
 * the field as `tool_use_id` (snake_case) on every Pre/Post/Failure
 * hook input shape since the SDK rev this wizard pins; the
 * `toolUseId` (camelCase) fallback exists for robustness against
 * older / future SDK shapes that some bridge layers normalize.
 * Returns null when the field is missing — we ship the envelope
 * without `id` rather than fake a synthetic one.
 */
export function extractToolUseId(
  input: Record<string, unknown>,
): string | null {
  if (typeof input.tool_use_id === 'string' && input.tool_use_id.length > 0) {
    return input.tool_use_id;
  }
  if (typeof input.toolUseId === 'string' && input.toolUseId.length > 0) {
    return input.toolUseId;
  }
  return null;
}

/**
 * Extract a stringified preview of the tool's response payload from a
 * PostToolUse hook input. The SDK surfaces tool output via
 * `tool_response` (newer shape) or `tool_result` (older shape), each
 * of which can be a string, an object with a `content[]` array of
 * `{ type: 'text', text }` chunks, or a Bash-style
 * `{ stdout, stderr, exitCode }` shape. This helper normalizes all
 * three into a single string the emitter can truncate + sanitize.
 *
 * Returns null when no extractable content is present — orchestrators
 * see absence of `contentHead` as "no captured output" (e.g. a
 * `TodoWrite` that returned only structural metadata). Pure — no I/O.
 */
export function extractToolContentHead(input: Record<string, unknown>): {
  content: string | null;
  exitCode: number | undefined;
} {
  const result =
    typeof input.tool_response !== 'undefined'
      ? input.tool_response
      : typeof input.tool_result !== 'undefined'
      ? input.tool_result
      : null;
  if (result === null || result === undefined) {
    return { content: null, exitCode: undefined };
  }
  if (typeof result === 'string') {
    return { content: result, exitCode: undefined };
  }
  if (typeof result !== 'object') {
    return { content: null, exitCode: undefined };
  }
  const obj = result as Record<string, unknown>;
  // Bash-style: `{ stdout, stderr, exitCode }`. Concatenate stderr
  // after stdout so the consumer sees both streams; exit code is a
  // first-class field on the wire so we don't repeat it in
  // contentHead.
  if (
    typeof obj.stdout === 'string' ||
    typeof obj.stderr === 'string' ||
    typeof obj.interrupted === 'boolean'
  ) {
    const stdout = typeof obj.stdout === 'string' ? obj.stdout : '';
    const stderr = typeof obj.stderr === 'string' ? obj.stderr : '';
    const combined =
      stderr.length > 0
        ? stdout + (stdout.length > 0 ? '\n' : '') + stderr
        : stdout;
    const exitCode =
      typeof obj.exitCode === 'number' && Number.isFinite(obj.exitCode)
        ? obj.exitCode
        : undefined;
    return { content: combined.length > 0 ? combined : null, exitCode };
  }
  // SDK `content[]` shape — array of `{ type: 'text', text }` chunks.
  // Concatenate text fields in order so a Read / Grep result reads
  // naturally on the wire.
  if (Array.isArray(obj.content) && obj.content.length > 0) {
    const parts: string[] = [];
    for (const chunk of obj.content) {
      if (
        typeof chunk === 'object' &&
        chunk !== null &&
        typeof (chunk as Record<string, unknown>).text === 'string'
      ) {
        parts.push((chunk as { text: string }).text);
      }
    }
    return {
      content: parts.length > 0 ? parts.join('\n') : null,
      exitCode: undefined,
    };
  }
  // Generic `text` / `output` / `error` strings — fall through to the
  // first non-empty one.
  for (const key of ['text', 'output', 'message']) {
    const candidate = obj[key];
    if (typeof candidate === 'string' && candidate.length > 0) {
      return { content: candidate, exitCode: undefined };
    }
  }
  return { content: null, exitCode: undefined };
}

export function extractToolFailureMessage(
  input: Record<string, unknown>,
): string | null {
  const result =
    typeof input.tool_response !== 'undefined'
      ? input.tool_response
      : typeof input.tool_result !== 'undefined'
      ? input.tool_result
      : null;
  if (result === null || result === undefined) return null;
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    // Newer SDK shape: `{ is_error: true, error: 'msg' }` or `{ error: 'msg' }`.
    if (obj.is_error === true || (obj.error && typeof obj.error === 'string')) {
      const msg = typeof obj.error === 'string' ? obj.error : 'tool error';
      return msg;
    }
    // Fallback: peek at a stringified `content[0].text` shape some SDK
    // versions use for tool errors. `Array.isArray` narrows `obj.content`
    // to `any[]` because `unknown[]` isn't expressible from the runtime
    // check — but we treat each entry as `unknown` and re-narrow before
    // reading any property.
    if (Array.isArray(obj.content) && obj.content.length > 0) {
      const first: unknown = obj.content[0];
      if (
        typeof first === 'object' &&
        first !== null &&
        typeof (first as Record<string, unknown>).text === 'string' &&
        ((first as Record<string, unknown>).type === 'tool_result_error' ||
          obj.is_error === true)
      ) {
        return (first as { text: string }).text;
      }
    }
  }
  return null;
}

/**
 * Build hook callbacks that forward inner-agent lifecycle events to
 * AgentUI as NDJSON. Returned `hooks()` is shaped to merge cleanly into
 * the existing `buildHooksConfig` call in `agent-interface.ts`.
 *
 * Each callback returns `{}` (no SDK-side action) — these hooks are
 * observers, not gates. The write-gate (Gap 4: `evaluateWriteGate`) is a
 * separate concern that can be composed alongside these.
 */
export function createInnerLifecycleHooks(config: InnerLifecycleConfig): {
  hooks: () => {
    SessionStart: HookCallback;
    PreToolUse: HookCallback;
    PostToolUse: HookCallback;
  };
  /**
   * Manually emit `event_plan_proposed` from the `confirm_event_plan` MCP
   * tool. The hook system can't observe MCP-tool calls, so the wizard-tools
   * server calls this directly when it processes the plan.
   */
  emitEventPlanProposed: (
    events: Array<{ name: string; description: string }>,
  ) => void;
  /** Emit `event_plan_confirmed` after the user/orchestrator decides. */
  emitEventPlanConfirmed: (
    source: 'auto' | 'human' | 'flag',
    decision: 'approved' | 'skipped' | 'revised',
  ) => void;
  /** Wrap a verification step so success/failure are surfaced as NDJSON. */
  withVerification: <T>(
    phase: 'sdk_present' | 'api_key' | 'ingestion' | 'overall',
    fn: () => Promise<T>,
  ) => Promise<T>;
} {
  /**
   * Closure-local map of `tool_use_id` -> PreToolUse wall-clock ms.
   * Used to compute `durationMs` for the `tool_response` envelope
   * when the SDK doesn't surface its own `duration_ms` on the
   * PostToolUse input. Entries are deleted at the matching
   * PostToolUse so a long-running run doesn't accumulate stale keys;
   * a hard cap of 256 entries protects against pathological SDK
   * inputs (e.g. PreToolUse fires without a matching PostToolUse,
   * which would otherwise leak forever).
   */
  const _toolCallStartTimes = new Map<string, number>();
  const _pruneToolCallStartTimes = (): void => {
    const MAX_ENTRIES = 256;
    if (_toolCallStartTimes.size <= MAX_ENTRIES) return;
    // Drop the oldest entries (Map iteration order is insertion order)
    // until back under the cap. Cheap and bounded.
    const overflow = _toolCallStartTimes.size - MAX_ENTRIES;
    let dropped = 0;
    for (const key of _toolCallStartTimes.keys()) {
      _toolCallStartTimes.delete(key);
      dropped += 1;
      if (dropped >= overflow) break;
    }
  };

  const sessionStart: HookCallback = (input) => {
    const ui = getAgentUI();
    if (ui) {
      ui.emitInnerAgentStarted({
        model:
          config.model ??
          (typeof input.model === 'string' ? input.model : 'unknown'),
        phase: config.phase,
        planId: config.planId,
      });
    }
    return Promise.resolve({});
  };

  const preToolUse: HookCallback = (input) => {
    const agentUI = getAgentUI();
    const toolName =
      typeof input.tool_name === 'string'
        ? input.tool_name
        : typeof input.toolName === 'string'
        ? input.toolName
        : 'unknown';
    const toolInput =
      typeof input.tool_input !== 'undefined'
        ? input.tool_input
        : typeof input.toolInput !== 'undefined'
        ? input.toolInput
        : null;
    const summary = summarizeToolInput(toolName, toolInput);
    // Capture the SDK's `tool_use_id` so the PostToolUse `tool_response`
    // envelope can correlate with this `tool_call`. Stored in a closure-
    // local map keyed on tool_use_id so the post side can also recover
    // the PreToolUse wall-clock timestamp (for duration math when the
    // SDK doesn't surface its own `duration_ms`).
    const toolUseId = extractToolUseId(input);
    if (toolUseId !== null) {
      _toolCallStartTimes.set(toolUseId, Date.now());
      _pruneToolCallStartTimes();
    }
    // `tool_call` is NDJSON-only — useful to outer agents auditing what
    // the inner agent did, but redundant in the TUI (the agent's own
    // TodoWrite items already show user-facing progress).
    if (agentUI) {
      agentUI.emitToolCall({
        tool: toolName,
        ...(toolUseId !== null ? { id: toolUseId } : {}),
        summary,
      });
    }
    // The first PreToolUse marks the `agent_running` coarse phase
    // boundary — the inner Claude agent has actually started doing
    // work (vs. still booting / handshaking MCP). The AgentUI
    // emitter dedups, so it's safe to call from every tool call.
    try {
      getUI().emitRunPhase?.('agent_running');
    } catch {
      // best-effort — phase signal must not abort the agent loop
    }

    // Live substep narration for InkUI: surface a single human-readable
    // line per tool call ("Reading package.json", "Running pnpm add …")
    // so the active task in the Tasks list shows WHAT the wizard is
    // doing, not just a spinning chevron. Pure pass-through to the
    // formatter — null-returns (TodoWrite, sub-agent Task,
    // wizard-tools MCP plumbing) are filtered here so the store only
    // ever sees user-meaningful labels.
    try {
      const label = formatToolCallLabel({
        toolName,
        summary,
        // installDir is best-effort — the hook input doesn't carry it
        // and threading it through every call site is invasive. The
        // formatter's `shortPath` falls back to basename for absolute
        // paths longer than 40 chars, so unrelativized paths still
        // render readably.
      });
      if (label) {
        getUI().recordToolActivity?.(label);
      }
    } catch {
      // Defensive — substep narration is purely cosmetic. A failed format
      // must never abort the agent loop.
    }

    // File-change events go through the abstract WizardUI so InkUI can
    // populate the FileWritesPanel and AgentUI keeps emitting NDJSON
    // (recordFileChangePlanned on AgentUI delegates to emitFileChangePlanned).
    const operation = classifyWriteOperation(toolName);
    if (operation) {
      const obj =
        toolInput && typeof toolInput === 'object'
          ? (toolInput as Record<string, unknown>)
          : {};
      const path =
        typeof obj.file_path === 'string'
          ? obj.file_path
          : typeof obj.path === 'string'
          ? obj.path
          : null;
      if (path) {
        try {
          getUI().recordFileChangePlanned({ path, operation });
        } catch {
          // getUI() throws before the wizard has bootstrapped a UI (e.g.
          // when inner-lifecycle hooks fire from a probe call). Swallow —
          // a missing pre-event is harmless, the apply-side handles it.
        }
        // v2 protocol: coarser `current_file` rollup. AgentUI debounces
        // repeated edits to the same (path, op) inside 250ms, so a tight
        // edit chain collapses into one orchestrator-facing event. InkUI
        // / LoggingUI no-op — they already have their own "active file"
        // surfaces via `recordFileChangePlanned`.
        try {
          getUI().emitCurrentFile?.({
            path,
            relativePath: relativizeForCurrentFile(path, config.installDir),
            operation,
          });
        } catch {
          // Same swallow rationale as recordFileChangePlanned above.
        }
        // Capture the pre-write content into the rollback ledger so a
        // cancelled / errored run can revert this file. No-op when no
        // ledger has been initialised (probe calls, unit tests).
        try {
          getFileChangeLedger()?.recordPreWrite(path);
        } catch {
          // Ledger capture must never break the agent loop. Swallow.
        }
      }
    }
    return Promise.resolve({});
  };

  const postToolUse: HookCallback = (input) => {
    const toolName =
      typeof input.tool_name === 'string'
        ? input.tool_name
        : typeof input.toolName === 'string'
        ? input.toolName
        : 'unknown';

    // Record the run-level tool-call outcome for ALL tools (not just
    // write tools) so `tool_call_summary` carries an accurate
    // success/error breakdown at phase / terminal boundaries. The
    // outcome is derived from the same `extractToolFailureMessage`
    // probe the write-tool path uses below — non-null message means
    // the tool surfaced an error. Wrapped in try/catch so the outcome
    // probe can never block the agent loop.
    let outcomeForResponse: ToolCallOutcome = 'success';
    let outcomeFailureMessage: string | null = null;
    try {
      outcomeFailureMessage = extractToolFailureMessage(input);
      outcomeForResponse = outcomeFailureMessage === null ? 'success' : 'error';
    } catch {
      // Probe must never break the loop — fall through with default
      // 'success' outcome and let the existing accumulator drift be
      // self-correcting.
    }
    try {
      const agentUI = getAgentUI();
      if (agentUI) {
        agentUI.recordToolOutcome(toolName, outcomeForResponse);
      }
    } catch {
      // Outcome accumulation must never break the agent loop.
    }

    // v2 protocol: emit `tool_response` for EVERY tool call (not just
    // write tools). Pairs with the preceding `tool_call` via the SDK
    // `tool_use_id` correlation field. Wrapped in try/catch so a
    // malformed response payload never blocks the agent loop — the
    // emit is observational, not load-bearing.
    try {
      const agentUI = getAgentUI();
      if (agentUI) {
        const toolUseIdPost = extractToolUseId(input);
        // Duration: prefer the SDK's reported `duration_ms` (more
        // accurate — excludes permission-prompt and hook time per the
        // SDK docs); fall back to PreToolUse wall-clock delta when
        // absent.
        let durationMs = 0;
        if (
          typeof input.duration_ms === 'number' &&
          Number.isFinite(input.duration_ms)
        ) {
          durationMs = Math.max(0, Math.floor(input.duration_ms));
        } else if (toolUseIdPost !== null) {
          const startedAt = _toolCallStartTimes.get(toolUseIdPost);
          if (typeof startedAt === 'number') {
            durationMs = Math.max(0, Date.now() - startedAt);
          }
        }
        // Free the map entry now that we've consumed it. Lookup
        // remains valid for one PostToolUse per PreToolUse — the
        // SDK doesn't surface duplicate PostToolUse for a single
        // tool call.
        if (toolUseIdPost !== null) {
          _toolCallStartTimes.delete(toolUseIdPost);
        }
        const { content, exitCode } = extractToolContentHead(input);
        // Re-derive a short summary mirroring the `tool_call.summary`
        // contract so consumers that branch only on `tool_response`
        // still get the same human-readable preview text. Pure pass-
        // through — `summarizeToolInput` already redacts secrets.
        const toolInputForSummary =
          typeof input.tool_input !== 'undefined'
            ? input.tool_input
            : typeof input.toolInput !== 'undefined'
            ? input.toolInput
            : null;
        const responseSummary = summarizeToolInput(
          toolName,
          toolInputForSummary,
        );
        agentUI.emitToolResponse({
          tool: toolName,
          ...(toolUseIdPost !== null ? { id: toolUseIdPost } : {}),
          outcome: outcomeForResponse,
          durationMs,
          ...(typeof exitCode === 'number' ? { exitCode } : {}),
          ...(content !== null ? { contentHead: content } : {}),
          isError: outcomeForResponse !== 'success',
          ...(outcomeFailureMessage !== null
            ? { errorMessage: outcomeFailureMessage }
            : {}),
          ...(responseSummary !== undefined
            ? { summary: responseSummary }
            : {}),
        });
      }
    } catch {
      // Emission must NEVER block tool execution. Swallow.
    }

    const operation = classifyWriteOperation(toolName);
    if (!operation) return Promise.resolve({});
    const toolInput =
      typeof input.tool_input !== 'undefined'
        ? input.tool_input
        : typeof input.toolInput !== 'undefined'
        ? input.toolInput
        : null;
    const obj =
      toolInput && typeof toolInput === 'object'
        ? (toolInput as Record<string, unknown>)
        : {};
    const path =
      typeof obj.file_path === 'string'
        ? obj.file_path
        : typeof obj.path === 'string'
        ? obj.path
        : null;
    if (path) {
      // v2 protocol: gate on tool_result outcome. If the write tool
      // surfaced an error, emit `file_change_failed` and SKIP
      // `recordFileChangeApplied` — which would falsely advertise a
      // successful write to the orchestrator's audit trail. The
      // pre-write entry stays in the rollback ledger so a cancelled
      // run can still restore the original on-disk state.
      const failureMessage = extractToolFailureMessage(input);
      if (failureMessage !== null) {
        try {
          getUI().emitFileChangeFailed?.({
            path,
            operation,
            errorClass: classifyFileChangeError(failureMessage),
            errorMessage: failureMessage,
          });
        } catch {
          // See preToolUse — same defensive swallow.
        }
        return Promise.resolve({});
      }

      const content = typeof obj.content === 'string' ? obj.content : null;
      // Use `content !== null` not `content` — empty string `''` is falsy
      // and would drop `bytes` from the event. Outer agents need to
      // distinguish "byte count unknown" (no content captured) from
      // "zero-byte file" (empty `Write`).
      try {
        getUI().recordFileChangeApplied({
          path,
          operation,
          ...(content !== null && {
            bytes: Buffer.byteLength(content, 'utf8'),
          }),
        });
      } catch {
        // See preToolUse — same defensive swallow.
      }
      // Finalise the rollback ledger entry with the new on-disk content.
      // For Edit/MultiEdit/NotebookEdit `obj.content` will be null and
      // the ledger re-reads from disk to capture the final form. The
      // ledger's `recordPostWrite` is a no-op when no ledger is
      // initialised.
      try {
        getFileChangeLedger()?.recordPostWrite(path, content);
      } catch {
        // Ledger capture must never break the agent loop. Swallow.
      }
    }
    return Promise.resolve({});
  };

  return {
    hooks: () => ({
      SessionStart: sessionStart,
      PreToolUse: preToolUse,
      PostToolUse: postToolUse,
    }),
    emitEventPlanProposed(events) {
      const ui = getAgentUI();
      if (ui) ui.emitEventPlanProposed({ events });
    },
    emitEventPlanConfirmed(source, decision) {
      const ui = getAgentUI();
      if (ui) ui.emitEventPlanConfirmed({ source, decision });
    },
    async withVerification(phase, fn) {
      const ui = getAgentUI();
      if (ui) ui.emitVerificationStarted({ phase });
      try {
        const result = await fn();
        if (ui) ui.emitVerificationResult({ phase, success: true });
        return result;
      } catch (e) {
        if (ui) {
          // `(e as Error).message` would throw TypeError if e is null /
          // undefined / a string / etc. — both valid throws in JS. Defensive
          // narrowing with instanceof avoids swallowing the original error
          // behind a confusing TypeError and ensures the verification_result
          // event still emits.
          const failureMessage = e instanceof Error ? e.message : String(e);
          ui.emitVerificationResult({
            phase,
            success: false,
            failures: [failureMessage],
          });
        }
        throw e;
      }
    },
  };
}
