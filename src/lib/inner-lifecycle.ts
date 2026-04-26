/**
 * inner-lifecycle — bridge from Claude SDK hooks to AgentUI NDJSON events.
 *
 * The wizard runs an inner Claude SDK agent and exposes hooks for
 * PreToolUse / PostToolUse / SessionStart / Stop. In `--agent` mode we
 * forward those hook events to the AgentUI so outer agents can see what
 * the inner agent is doing in real time. In TUI / CI mode the hooks are
 * no-ops here (the existing UIs handle their own status display).
 *
 * Hook factories in `agent-interface.ts` should compose these helpers
 * into their callbacks rather than calling `emit*` on the UI directly.
 * Keeping the AgentUI-detection in one place means future UI variants
 * (LoggingUI emitting structured logs, future MCP-style transport, etc.)
 * can opt in by implementing the same emit methods.
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
    const ui = getAgentUI();
    if (!ui) return Promise.resolve({});
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
    ui.emitToolCall({ tool: toolName, summary });

    // For write tools, also emit `file_change_planned` so outer agents
    // see the intended path before the change happens.
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
        ui.emitFileChangePlanned({ path, operation });
      }
    }
    return Promise.resolve({});
  };

  const postToolUse: HookCallback = (input) => {
    const ui = getAgentUI();
    if (!ui) return Promise.resolve({});
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
      ui.emitFileChangeApplied({
        path,
        operation,
        ...(content !== null && { bytes: Buffer.byteLength(content, 'utf8') }),
      });
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
          ui.emitVerificationResult({
            phase,
            success: false,
            failures: [String((e as Error).message ?? e)],
          });
        }
        throw e;
      }
    },
  };
}
