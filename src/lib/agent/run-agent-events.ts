/**
 * NDJSON-event emission helpers for the AI-SDK inner-loop runner
 * (Phase D-3).
 *
 * These keep the new runner producing the same NDJSON envelope shape that
 * the legacy `agent-interface.ts` runner emits today via
 * `inner-lifecycle.ts`. The smoke parity test in
 * `__tests__/run-agent.test.ts` asserts both runners produce equivalent
 * `data.event` discriminators, so when D-5 flips the default and D-6
 * deletes the legacy path, orchestrators see no on-wire change.
 *
 * NDJSON-only telemetry (`tool_call`, `inner_agent_started`,
 * `file_change_*`) routes through `AgentUI` — we cast `getUI()` to
 * `AgentUI` and bail when the active UI is `InkUI` / `LoggingUI`. File
 * changes also go through the abstract `recordFileChange*` API on
 * `WizardUI` so the TUI's `FileWritesPanel` populates regardless of which
 * runner is active.
 */
import { getUI } from '../../ui/index.js';
import { AgentUI } from '../../ui/agent-ui.js';
import { classifyWriteOperation, summarizeToolInput } from '../agent-events.js';

/**
 * Resolve the active UI as `AgentUI` when --agent mode is in effect, or
 * `null` otherwise. Mirrors `inner-lifecycle.ts` so NDJSON emission stays
 * consistent across the legacy and AI-SDK runners.
 */
function getAgentUI(): AgentUI | null {
  try {
    const ui = getUI();
    return ui instanceof AgentUI ? ui : null;
  } catch {
    // UI not bootstrapped (probe / test path) — drop the event silently.
    return null;
  }
}

/**
 * Best-effort path extractor for write tools. Mirrors the logic in
 * `inner-lifecycle.ts` so AI-SDK tool inputs and Agent-SDK tool inputs
 * funnel through the same shape.
 */
function extractWriteTargetPath(input: unknown): string | null {
  if (input === null || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  if (typeof obj.file_path === 'string') return obj.file_path;
  if (typeof obj.path === 'string') return obj.path;
  return null;
}

/**
 * Emit `inner_agent_started` exactly once at the top of an AI-SDK run.
 * Mirrors `createInnerLifecycleHooks` SessionStart behavior.
 */
export function emitInnerAgentStarted(args: {
  model: string;
  phase: 'plan' | 'apply' | 'verify' | 'wizard';
  planId?: string;
}): void {
  const ui = getAgentUI();
  if (!ui) return;
  ui.emitInnerAgentStarted({
    model: args.model,
    phase: args.phase,
    ...(args.planId ? { planId: args.planId } : {}),
  });
}

/**
 * Emit a `tool_call` event — fires at PreToolUse for every tool the
 * inner agent invokes. Pairs with the legacy
 * `inner-lifecycle.ts:preToolUse` shape so orchestrators auditing
 * `--agent` output see the same NDJSON line regardless of runtime.
 */
export function emitToolCall(args: {
  toolName: string;
  toolInput: unknown;
}): void {
  const ui = getAgentUI();
  if (!ui) return;
  const summary = summarizeToolInput(args.toolName, args.toolInput);
  ui.emitToolCall({
    tool: args.toolName,
    ...(summary ? { summary } : {}),
  });
}

/**
 * Emit `file_change_planned` (PreToolUse) for write tools. Routes
 * through the abstract WizardUI so the TUI's FileWritesPanel
 * populates and AgentUI emits the NDJSON event in --agent mode.
 *
 * The runner doesn't itself execute these tools — it observes the AI
 * SDK's tool-call envelope and emits the event so outer agents can
 * track intent before the tool actually runs.
 */
export function emitFileChangePlanned(args: {
  toolName: string;
  toolInput: unknown;
}): void {
  const operation = classifyWriteOperation(args.toolName);
  if (!operation) return;
  const path = extractWriteTargetPath(args.toolInput);
  if (!path) return;
  try {
    getUI().recordFileChangePlanned({ path, operation });
  } catch {
    // UI not bootstrapped — drop.
  }
}

/**
 * Emit `file_change_applied` (PostToolUse) for write tools. Pairs with
 * `emitFileChangePlanned` — same path, same operation, fires after the
 * tool reports success. `bytes` is optional and surfaced when the
 * runner can compute it from the tool result.
 */
export function emitFileChangeApplied(args: {
  toolName: string;
  toolInput: unknown;
  bytes?: number;
}): void {
  const operation = classifyWriteOperation(args.toolName);
  if (!operation) return;
  const path = extractWriteTargetPath(args.toolInput);
  if (!path) return;
  try {
    getUI().recordFileChangeApplied({
      path,
      operation,
      ...(typeof args.bytes === 'number' ? { bytes: args.bytes } : {}),
    });
  } catch {
    // UI not bootstrapped — drop.
  }
}

/**
 * Categories of "what the wizard is doing right now" that the runner
 * may surface. Stable enum so the TUI / outer agents can branch on a
 * known set without sniffing free-form strings. Future events from the
 * #594 stall-event work should append to this union, not redefine it.
 */
export type CurrentActivityKind =
  | 'cold_start'
  | 'compaction'
  | 'ingestion'
  | 'mcp_tool_call'
  | 'retry'
  | 'streaming';

/**
 * Lightweight current-activity hook. Today AgentUI does not export a
 * dedicated `emitCurrentActivity` method (the #594 work that landed
 * `current_activity` events lives in TUI-side state), so we route
 * through `pushStatus` so the existing TUI's status pill updates and
 * `--agent` mode emits a `progress` line. When the dedicated emit
 * method lands, swap this to call it directly without changing the
 * runner-side call sites.
 */
export function emitCurrentActivity(args: {
  kind: CurrentActivityKind;
  detail?: string;
}): void {
  try {
    const message = args.detail ? `${args.kind}: ${args.detail}` : args.kind;
    getUI().pushStatus(message);
  } catch {
    // UI not bootstrapped — drop.
  }
}
