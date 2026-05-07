/**
 * Journey state classifier — derives canonical-step transitions from the
 * agent's tool calls instead of from free-form `TodoWrite` text.
 *
 * The 4-step journey rendered in the TUI (see `canonical-tasks.ts`) was
 * historically driven by the agent's `TodoWrite` output. That coupling
 * was brittle: the LLM drifted on long runs, renamed steps on retry,
 * and occasionally regressed completed steps when re-emitting stale
 * state after an HTTP 400/429. This classifier replaces text-parsing
 * with a deterministic derivation: each step transitions on a specific
 * tool call (or pattern of tool calls) the agent must make to do its
 * job. PRs #474 (structured `fileWrites` instead of regex over
 * `statusMessages`), #479 / #480 (legacy `record_dashboard` signal,
 * since removed by PR 4 of DEFER_DASHBOARD_PLAN.md) established this
 * pattern; this module finishes it for the journey stepper.
 *
 * History: a fifth `dashboard` step lived here until DEFER_DASHBOARD_PLAN
 * PR 4 — chart and dashboard creation moved to the deferred
 * `amplitude-wizard dashboard` command, so the in-loop classifier no
 * longer tracks them. `wire` is the terminal step.
 *
 * The function is pure — no I/O, no store reference. Wire-up happens
 * in `agent-interface.ts` (`PreToolUse` / `PostToolUse` hook
 * composers) and dispatches into `WizardStore.applyJourneyTransition`.
 */
import type { CanonicalStep } from './canonical-tasks.js';

export type JourneyStepId = CanonicalStep['id'];

export type JourneyStatus = 'in_progress' | 'completed';

export interface JourneyTransition {
  stepId: JourneyStepId;
  status: JourneyStatus;
}

export interface ClassifyToolEventInput {
  /** SDK hook phase: `pre` for PreToolUse, `post` for PostToolUse. */
  phase: 'pre' | 'post';
  /** Tool name as the SDK reports it (e.g. `'mcp__wizard-tools__confirm_event_plan'`, `'Bash'`, `'Edit'`). */
  toolName: string;
  /** Tool input (`tool_input` field on the SDK hook payload). Shape varies by tool. */
  toolInput: unknown;
  /**
   * Tool result (`tool_response` / `tool_result` field on the SDK PostToolUse payload).
   * `null` for `pre` events.
   */
  toolResult?: unknown;
  /**
   * Per-step status as currently derived. Used to gate triggers that
   * depend on prior steps having advanced (e.g. `wire` only enters
   * `in_progress` once `plan` is `completed`).
   *
   * Keyed by step id; missing keys treated as not-yet-started.
   */
  prevDerived?: Partial<Record<JourneyStepId, JourneyStatus>>;
}

/**
 * Strip the standard MCP server prefix (`mcp__<server>__`) so callers can
 * pattern-match on the bare tool name. A tool named
 * `mcp__amplitude__create_chart` exposes `create_chart`. Returns the input
 * unchanged when no prefix matches.
 */
function bareToolName(name: string): string {
  const match = name.match(/^mcp__[a-z0-9_-]+__(.+)$/i);
  return match ? match[1] : name;
}

/**
 * Match the wizard-tools MCP server's tools regardless of which prefix
 * the SDK reports (`mcp__wizard-tools__*` in production,
 * `mcp__amplitude-wizard__*` in some test fixtures, bare names
 * elsewhere). The tool list is owned by `src/lib/wizard-tools.ts`.
 */
function isWizardTool(toolName: string, bare: string): boolean {
  return (
    /^mcp__[a-z0-9_-]*wizard[a-z0-9_-]*__/i.test(toolName) || toolName === bare
  );
}

/**
 * Recognise a Bash command that installs an Amplitude SDK package.
 * Covers npm / yarn / pnpm / bun (JS) and pip / poetry / uv (Python).
 * Conservative: requires both the install verb AND a literal
 * `@amplitude/` (JS) or `amplitude-` (Python) in the same command so a
 * Bash that merely mentions amplitude in a comment / unrelated flag
 * doesn't trigger the transition.
 */
function isAmplitudeInstallCommand(command: string): boolean {
  if (!command) return false;
  const cmd = command.toLowerCase();
  const hasJsInstallVerb = /\b(npm|pnpm|yarn|bun)\s+(install|add|i)\b/.test(
    cmd,
  );
  const hasJsAmplitudePackage = /(^|\s)@amplitude\//.test(cmd);
  if (hasJsInstallVerb && hasJsAmplitudePackage) return true;
  const hasPyInstallVerb = /\b(pip|poetry|uv)\s+(install|add)\b/.test(cmd);
  const hasPyAmplitudePackage =
    /(^|\s|=)amplitude(-analytics|_analytics)?\b/.test(cmd);
  if (hasPyInstallVerb && hasPyAmplitudePackage) return true;
  return false;
}

/** Set of write-tool names that mutate files on disk. Mirrors `classifyWriteOperation` in agent-interface.ts. */
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function readStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = (value as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Classify a single SDK tool event into a journey transition.
 *
 * Returns `null` when the event isn't load-bearing for any step — most
 * tool calls fall through to `null` so the caller can treat the
 * function output as "advance the journey if non-null."
 *
 * Steps and their triggers:
 *
 *   1. **detect** — `mcp__wizard-tools__detect_package_manager`
 *      Pre → in_progress, Post → completed.
 *   2. **install** — Bash command running an Amplitude package install
 *      (e.g. `pnpm add @amplitude/unified`, `pip install amplitude-analytics`).
 *      Pre → in_progress.
 *   3. **plan** — `mcp__wizard-tools__confirm_event_plan`
 *      Pre → in_progress, Post → completed (regardless of approval —
 *      the call returning means the agent finished the planning step;
 *      the user's verdict on the plan is orthogonal).
 *   4. **wire** — any Edit/Write tool firing AFTER plan has completed.
 *      Pre → in_progress. Wire is the terminal step; it transitions to
 *      `completed` from the agent-runner post-loop boundary
 *      (`finalizeWireStep`) once the agent stream ends and an
 *      events.json artifact is on disk. There is no per-tool completion
 *      signal — wiring spans many files and the first PostToolUse on a
 *      write would falsely flip the pill to "done" while the agent is
 *      still mid-instrumentation.
 *
 * History: a fifth `dashboard` step used to live here, with triggers on
 * Amplitude MCP `create_chart` / `create_dashboard` / `record_dashboard`
 * / chart-builder tools. DEFER_DASHBOARD_PLAN PR 4 deleted it — chart +
 * dashboard creation now happens in the deferred
 * `amplitude-wizard dashboard` command, after event ingestion catches up.
 */
export function classifyToolEvent(
  input: ClassifyToolEventInput,
): JourneyTransition | null {
  const { phase, toolName, toolInput, prevDerived } = input;
  const bare = bareToolName(toolName);

  // ── Step 3: plan ──
  if (bare === 'confirm_event_plan' && isWizardTool(toolName, bare)) {
    if (phase === 'post') return { stepId: 'plan', status: 'completed' };
    return { stepId: 'plan', status: 'in_progress' };
  }

  // ── Step 1: detect ──
  if (bare === 'detect_package_manager' && isWizardTool(toolName, bare)) {
    if (phase === 'post') return { stepId: 'detect', status: 'completed' };
    return { stepId: 'detect', status: 'in_progress' };
  }

  // ── Step 2: install ──
  if (phase === 'pre' && toolName === 'Bash') {
    const command = readStringField(toolInput, 'command') ?? '';
    if (isAmplitudeInstallCommand(command)) {
      return { stepId: 'install', status: 'in_progress' };
    }
  }

  // ── Step 4: wire ──
  // First write-tool call after `plan` completes flips wire to in_progress.
  // We deliberately don't try to detect "is this a track() callsite" —
  // the agent is instructed to confirm_event_plan THEN write track calls,
  // so the temporal gate is sufficient and avoids parsing edit content.
  //
  // No `dashboard` guard any more — the dashboard step is gone, and wire
  // is now the terminal step. Agent-runner flips wire to `completed` at
  // the post-agent boundary (see `finalizeWireStep`), not here.
  if (
    phase === 'pre' &&
    WRITE_TOOLS.has(toolName) &&
    prevDerived?.plan === 'completed' &&
    prevDerived?.wire !== 'completed'
  ) {
    return { stepId: 'wire', status: 'in_progress' };
  }

  return null;
}
