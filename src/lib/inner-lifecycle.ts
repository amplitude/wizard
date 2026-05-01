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

import { getUI } from '../ui/index.js';
import { AgentUI } from '../ui/agent-ui.js';
import {
  classifyWriteOperation,
  summarizeToolInput,
  type InnerAgentStartedData,
} from './agent-events.js';
import type { HookCallback } from './agent-hooks.js';

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
    // `tool_call` is NDJSON-only — useful to outer agents auditing what
    // the inner agent did, but redundant in the TUI (the agent's own
    // TodoWrite items already show user-facing progress).
    if (agentUI) agentUI.emitToolCall({ tool: toolName, summary });

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
