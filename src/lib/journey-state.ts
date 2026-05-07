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
 * Recognise a Bash command that runs a JS or Python package install.
 * Covers npm / yarn / pnpm / bun (JS) and pip / poetry / uv (Python).
 *
 * Deliberately broad: any package install verb during a wizard run is
 * load-bearing progress (the agent is past detection and into
 * dependency setup), so we flip Install to in_progress on the first
 * such Bash call rather than waiting for the literal Amplitude package
 * argument. This is the cold-start "0 done · 4 to go" fix — users see
 * the journey advance the moment the agent starts installing things.
 */
function isPackageInstallCommand(command: string): boolean {
  if (!command) return false;
  const cmd = command.toLowerCase();
  // JS managers: `i` is npm / pnpm / yarn shorthand for `install`. Match it
  // only as a standalone token so we don't accidentally fire on `pip` or
  // other words that happen to contain the letter.
  const jsInstallVerb = /\b(npm|pnpm|yarn|bun)\s+(install|add|i)\b/.test(cmd);
  if (jsInstallVerb) return true;
  const pyInstallVerb = /\b(pip|poetry|uv)\s+(install|add)\b/.test(cmd);
  if (pyInstallVerb) return true;
  return false;
}

/** Set of write-tool names that mutate files on disk. Mirrors `classifyWriteOperation` in agent-interface.ts. */
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/**
 * Read-only investigation tools the agent uses while ramping up. The
 * first such call is a strong signal that detection work has started —
 * we flip Detect to in_progress so the user sees progress during the
 * 1-3s cold-start window before any explicit detect tool fires.
 */
const DETECT_INVESTIGATION_TOOLS = new Set(['Read', 'Grep', 'Glob']);

/**
 * File-path patterns the wizard itself owns. An Edit / Write to one of
 * these is bookkeeping (events.json, dashboard.json, the post-run
 * setup report), not user-facing instrumentation, so it must NOT flip
 * Wire to in_progress.
 */
function isWizardManagedPath(filePath: string): boolean {
  if (!filePath) return false;
  // Project metadata directory: `<installDir>/.amplitude/...`
  if (/(^|[\\/])\.amplitude([\\/]|$)/.test(filePath)) return true;
  // Wizard-generated post-run reports.
  if (/amplitude-setup-report(\.previous)?\.md$/.test(filePath)) return true;
  // Legacy mirrors next to the project root.
  if (/(^|[\\/])\.amplitude-events\.json$/.test(filePath)) return true;
  if (/(^|[\\/])\.amplitude-dashboard\.json$/.test(filePath)) return true;
  if (/(^|[\\/])ampli\.json$/.test(filePath)) return true;
  return false;
}

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
 *   1. **detect** — flips to in_progress on the FIRST of:
 *        - any `Read` / `Grep` / `Glob` call (agent ramping up), OR
 *        - `mcp__wizard-tools__detect_package_manager` Pre.
 *      Completes on `detect_package_manager` Post.
 *   2. **install** — flips to in_progress on the FIRST of:
 *        - any `(npm|pnpm|yarn|bun)\s+(install|add|i)` /
 *          `(pip|poetry|uv)\s+(install|add)` Bash command (Pre), OR
 *        - `detect_package_manager` Post (detection just finished, the
 *          agent is about to install something).
 *      No completion trigger — install is implicitly completed when a
 *      later step (plan / wire) advances and the store cascades.
 *   3. **plan** — `mcp__wizard-tools__confirm_event_plan`
 *      Pre → in_progress, Post → completed (regardless of approval —
 *      the call returning means the agent finished the planning step;
 *      the user's verdict on the plan is orthogonal). Feedback /
 *      re-loop calls re-enter Pre but the idempotent guard means the
 *      step stays in_progress without churn.
 *   4. **wire** — first Edit / Write / MultiEdit / NotebookEdit Pre to
 *      a non-wizard-managed file path AFTER `plan` has completed.
 *      Pre → in_progress. Wire is the terminal step; it transitions to
 *      `completed` from the agent-runner post-loop boundary
 *      (`finalizeWireStep`) once the agent stream ends and an
 *      events.json artifact is on disk. There is no per-tool completion
 *      signal — wiring spans many files and the first PostToolUse on a
 *      write would falsely flip the pill to "done" while the agent is
 *      still mid-instrumentation.
 *
 * Idempotency: every `in_progress` trigger checks `prevDerived[stepId]`
 * and returns null if the step is already in_progress or completed.
 * The classifier never demotes a completed step back to in_progress
 * (mirroring the store's monotonic guard) — second/third Read calls,
 * additional install Bashes, repeated confirm_event_plan invocations,
 * and subsequent Edits after wire is in_progress all fall through to
 * `null` so the UI is only notified on genuine state changes.
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

  const detectStatus = prevDerived?.detect;
  const installStatus = prevDerived?.install;
  const planStatus = prevDerived?.plan;
  const wireStatus = prevDerived?.wire;

  // ── Step 3: plan ──
  if (bare === 'confirm_event_plan' && isWizardTool(toolName, bare)) {
    if (phase === 'post') return { stepId: 'plan', status: 'completed' };
    // Pre: only emit on the first call. Subsequent calls (feedback
    // loops, retries) are no-ops once plan is already in_progress or
    // completed.
    if (planStatus === 'in_progress' || planStatus === 'completed') return null;
    return { stepId: 'plan', status: 'in_progress' };
  }

  // ── Step 1: detect — explicit detect_package_manager tool ──
  // Pre flips to in_progress on first call. Post completes detect.
  // The function can only return one transition per event, so we
  // emit detect:completed on Post — the install→in_progress signal
  // comes from the agent's subsequent Bash install command. The
  // store cascades detect→completed automatically when install
  // advances later, so we don't lose any signal.
  if (bare === 'detect_package_manager' && isWizardTool(toolName, bare)) {
    if (phase === 'post') return { stepId: 'detect', status: 'completed' };
    if (detectStatus === 'in_progress' || detectStatus === 'completed') {
      return null;
    }
    return { stepId: 'detect', status: 'in_progress' };
  }

  // ── Step 1: detect — implicit ramp-up (Read / Grep / Glob) ──
  // First read-only investigation tool flips detect to in_progress
  // even before the agent calls detect_package_manager. This is the
  // cold-start fix: users see progress during the 1-3s window while
  // the agent is reading skill files / project layout.
  if (
    phase === 'pre' &&
    DETECT_INVESTIGATION_TOOLS.has(toolName) &&
    detectStatus !== 'in_progress' &&
    detectStatus !== 'completed'
  ) {
    return { stepId: 'detect', status: 'in_progress' };
  }

  // ── Step 2: install ──
  if (
    phase === 'pre' &&
    toolName === 'Bash' &&
    installStatus !== 'in_progress' &&
    installStatus !== 'completed'
  ) {
    const command = readStringField(toolInput, 'command') ?? '';
    if (isPackageInstallCommand(command)) {
      return { stepId: 'install', status: 'in_progress' };
    }
  }

  // ── Step 4: wire ──
  // First write-tool call after `plan` completes flips wire to in_progress.
  // We deliberately don't try to detect "is this a track() callsite" —
  // the agent is instructed to confirm_event_plan THEN write track calls,
  // so the temporal gate is sufficient and avoids parsing edit content.
  //
  // Wizard-managed paths (`.amplitude/events.json`, the post-run setup
  // report, legacy mirrors) are bookkeeping writes the wizard itself
  // performs — they don't count as user-facing instrumentation.
  //
  // No `dashboard` guard any more — the dashboard step is gone, and wire
  // is now the terminal step. Agent-runner flips wire to `completed` at
  // the post-agent boundary (see `finalizeWireStep`), not here.
  if (
    phase === 'pre' &&
    WRITE_TOOLS.has(toolName) &&
    planStatus === 'completed' &&
    wireStatus !== 'in_progress' &&
    wireStatus !== 'completed'
  ) {
    const filePath = readStringField(toolInput, 'file_path') ?? '';
    if (!isWizardManagedPath(filePath)) {
      return { stepId: 'wire', status: 'in_progress' };
    }
  }

  return null;
}
