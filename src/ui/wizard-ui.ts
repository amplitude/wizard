/**
 * WizardUI — abstraction layer for all user-facing operations.
 *
 * Business logic calls `getUI()` instead of importing the store directly.
 * Implementations: InkUI (TUI), LoggingUI (CI).
 *
 * No prompt methods — the TUI screens own all user input.
 * Session-mutating methods trigger reactive screen resolution in the TUI.
 */

import type { OutroData, RetryState } from '../lib/wizard-session';

/** Result returned by the confirm_event_plan tool to the agent. */
export type EventPlanDecision =
  | { decision: 'approved' | 'skipped' }
  | { decision: 'revised'; feedback: string };

export enum TaskStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
}

export interface SpinnerHandle {
  start(message?: string): void;
  stop(message?: string): void;
  message(msg?: string): void;
}

export interface WizardUI {
  // ── Lifecycle messages ────────────────────────────────────────────
  intro(message: string): void;
  outro(message: string): void;
  /**
   * Cancel/abort UI. Sets the outro state so the user sees the failure
   * before the process exits.
   *
   * Returns a promise that resolves when the user has had a chance to
   * see the message:
   *   - InkUI: resolves when the OutroScreen has rendered AND the user
   *     dismisses it (keypress / picker action) — or after a safety
   *     timeout if the TUI is unresponsive. Awaiting this is what lets
   *     `wizardAbort` show the Outro on error paths instead of slamming
   *     `process.exit` before Ink renders the next frame.
   *   - AgentUI / LoggingUI: resolves immediately. There's no TUI to
   *     render and no user to interact with the message.
   */
  cancel(message: string, options?: { docsUrl?: string }): Promise<void>;

  /**
   * Set the OutroScreen state reactively. Use from business logic that needs
   * to render an Error or Success outro before calling `cancel()` — direct
   * mutation of `session.outroData` doesn't notify subscribers, so the
   * OutroScreen would not re-render and the user would miss the message.
   */
  setOutroData(data: OutroData): void;

  // ── Logging ───────────────────────────────────────────────────────
  log: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    success(message: string): void;
    step(message: string): void;
  };

  note(message: string): void;
  pushStatus(message: string): void;

  /**
   * Periodic "still alive" beat emitted every ~10s while the agent is
   * running. Three implementations diverge:
   *
   *   - InkUI:     no-op — the TUI already renders status messages
   *                reactively as `pushStatus()` fires.
   *   - LoggingUI: prints the rolling tail of statuses (and only the
   *                tail) so a CI log shows "still working…" without
   *                going dark on long tool calls.
   *   - AgentUI:   emits a structured `progress: heartbeat` NDJSON
   *                event carrying elapsed time + retry attempt + the
   *                rolling status tail. Always fires on the cadence —
   *                absence of heartbeat is the canonical orchestrator
   *                signal that the wizard process has stalled.
   *
   * `statuses` is the rolling last-N (3) `pushStatus()` messages —
   * may be empty if no status was pushed since the last beat.
   */
  heartbeat(data: {
    statuses: string[];
    /** Milliseconds since `runAgent()` started. Monotonic. */
    elapsedMs: number;
    /**
     * 1-indexed retry attempt the runner is on. Lets a stalled-agent
     * heuristic distinguish "still on attempt 1, just slow" from
     * "we're churning through retries" without re-parsing the
     * `progress: agent_retry` events.
     */
    attempt?: number;
  }): void;

  // ── Spinner ───────────────────────────────────────────────────────
  spinner(): SpinnerHandle;

  // ── Session state (triggers reactive screen resolution in TUI) ────
  /** Signal that the main work (agent run) has started. */
  startRun(): void;

  /**
   * Show an error that occurred outside React (e.g. agent init failure).
   * In TUI mode: displays the error banner and blocks until the user presses R to retry.
   * Returns true if the caller should retry, false if it should abort normally.
   */
  setRunError(error: Error): Promise<boolean>;

  /**
   * Store OAuth/API credentials and (optionally) the resolved scope context
   * that goes with them. Scope fields are used for display + NDJSON emission;
   * they're optional because manually-entered API keys can't always be
   * resolved to an org/project. Resolves past AuthScreen in TUI.
   */
  setCredentials(credentials: {
    accessToken: string;
    projectApiKey: string;
    host: string;
    /**
     * Numeric Amplitude app ID. Canonical per amplitude/amplitude (`app_id`)
     * and amplitude/javascript (`appId`, GraphQL `App.id`). Amplitude's UI
     * also labels this "Project ID".
     */
    appId: number;
    orgId?: string | null;
    orgName?: string | null;
    projectId?: string | null;
    projectName?: string | null;
    /** Amplitude environment name ("Production", "Development", etc.). */
    envName?: string | null;
  }): void;

  /** Show service degradation (pushes outage overlay in TUI). */
  showServiceStatus(data: { description: string; statusPageUrl: string }): void;

  /**
   * Surface a transient retry banner while the agent reconnects after a 504 /
   * transient API error / stall. Pass `null` to clear. TUI renders an amber
   * banner below the task list; LoggingUI logs transitions; AgentUI emits an
   * NDJSON event.
   */
  setRetryState(state: RetryState | null): void;

  // ── Display state ──────────────────────────────────────────────────
  /** Set the detected framework label (e.g., "Django with Wagtail CMS") */
  setDetectedFramework(label: string): void;

  /** Register a callback to run when the TUI transitions onto the given screen. */
  onEnterScreen(screen: string, fn: () => void): void;

  setLoginUrl(url: string | null): void;

  /**
   * Record the user's data-center region after OAuth. Advances past RegionSelect in TUI.
   * Called by agent-runner after credentials are obtained.
   */
  setRegion(region: string): void;

  /**
   * Record whether the current project already has Amplitude event data.
   * false = fresh project → proceed to framework setup.
   * Advances past DataSetup in TUI.
   */
  setProjectHasData(value: boolean): void;

  // ── Agent prompts (confirmation / multiple choice / event plan) ─────
  /** Show a yes/no confirmation. Resolves false if the user skips. */
  promptConfirm(message: string): Promise<boolean>;
  /** Show a multiple-choice selector. Resolves empty string if the user skips. */
  promptChoice(message: string, options: string[]): Promise<string>;
  /**
   * Show the instrumentation plan for user approval.
   * Called by the confirm_event_plan wizard tool AFTER the SDK is installed.
   * The agent shows proposed events; the user can approve, skip, or give feedback.
   * Feedback causes the agent to revise and call this again (feedback loop).
   */
  promptEventPlan(
    events: Array<{ name: string; description: string }>,
  ): Promise<EventPlanDecision>;

  // ── Todo tracking from SDK TodoWrite events ───────────────────────
  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void;

  // ── Real-time file write activity from inner-agent hooks ──────────
  /**
   * The inner agent has requested a file write (Edit / Write / MultiEdit /
   * NotebookEdit) at PreToolUse. The change has not yet been applied. The
   * TUI surfaces this as a spinning row in the FileWritesPanel; agent mode
   * emits the existing `file_change_planned` NDJSON event.
   *
   * `path` is the raw absolute path the inner agent passed to the tool; the
   * TUI relativizes it for display, the NDJSON contract leaves it untouched
   * for outer-agent compatibility (schema v:1).
   */
  recordFileChangePlanned(data: {
    path: string;
    operation: 'create' | 'modify' | 'delete';
  }): void;

  /**
   * The inner-agent's write tool succeeded at PostToolUse. Pairs with the
   * preceding `recordFileChangePlanned` for the same path. `bytes` is
   * present when the inner agent's tool input carried `content` (Write); it
   * may be undefined for Edit / MultiEdit where the SDK doesn't surface the
   * resulting file size to the hook.
   */
  recordFileChangeApplied(data: {
    path: string;
    operation: 'create' | 'modify' | 'delete';
    bytes?: number;
  }): void;

  // ── Event plan from .amplitude-events.json ────────────────────
  setEventPlan(events: Array<{ name: string; description: string }>): void;

  // ── Data ingestion confirmation ────────────────────────────────
  /** Emitted by agent mode when MCP polling detects events flowing into the project. */
  setEventIngestionDetected(eventNames: string[]): void;

  // ── Agent-created dashboard ────────────────────────────────────
  /**
   * Called when the agent writes .amplitude-dashboard.json with the URL of
   * the dashboard it created during the conclude phase. Surfaces the link in
   * ChecklistScreen so users can open the dashboard immediately.
   */
  setDashboardUrl(url: string): void;

  // ── Terminal lifecycle ─────────────────────────────────────────
  /**
   * Emitted exactly once per run, immediately before the process exits
   * via `wizardSuccessExit` / `wizardAbort`. Optional because the TUI
   * (InkUI) and CI logger (LoggingUI) don't need a structured terminal
   * event — their UI semantics already imply the run boundary. AgentUI
   * implements this to emit a `run_completed` NDJSON event so
   * orchestrators can distinguish "wizard finished cleanly" from
   * "wizard crashed mid-stream and tore the pipe down". Absence of
   * this event before stream EOF means crash; presence with
   * `outcome: "success"` is the only signal of a clean run.
   */
  emitRunCompleted?(data: {
    outcome: 'success' | 'error' | 'cancelled';
    exitCode: number;
    durationMs: number;
    reason?: string;
  }): void;

  /**
   * Emit a `setup_context` event carrying the resolved Amplitude scope
   * (region, org, project, app, env) at a known phase boundary.
   * Optional because only AgentUI emits to NDJSON — InkUI / LoggingUI
   * no-op, since their UI already shows the equivalent context.
   *
   * Skill rule: the outer agent SHOULD show this scope to the user
   * BEFORE asking them to approve the run, so they know which
   * Amplitude app the wizard is about to write to.
   */
  emitSetupContext?(data: {
    phase: 'plan' | 'apply_started' | 'whoami';
    amplitude: {
      region?: 'us' | 'eu';
      orgId?: string;
      orgName?: string;
      projectId?: string;
      projectName?: string;
      appId?: string;
      appName?: string;
      envName?: string;
    };
    sources?: Record<string, 'auto' | 'flag' | 'saved' | 'recommended'>;
    requiresConfirmation?: boolean;
    resumeFlags?: { changeApp: string[] };
  }): void;

  /**
   * Emit a terminal `setup_complete` event once per successful run,
   * just before `run_completed`. Carries the canonical artifact list
   * (app id, dashboard URL, files, env vars, events) the outer agent
   * needs to drive follow-up MCP calls into the right project.
   * Optional; only AgentUI implements.
   */
  emitSetupComplete?(data: {
    amplitude: {
      region?: 'us' | 'eu';
      orgId?: string;
      orgName?: string;
      projectId?: string;
      projectName?: string;
      appId?: string;
      appName?: string;
      envName?: string;
      dashboardUrl?: string;
      dashboardId?: string;
    };
    files?: { written: string[]; modified: string[] };
    envVars?: { added: string[]; modified: string[] };
    events?: Array<{ name: string; description?: string; file?: string }>;
    durationMs?: number;
    followups?: {
      mcpServer?: { command: string[]; description: string };
      docsUrl?: string;
    };
  }): void;

  /**
   * Aggregated agent-run metrics — emitted by the observability
   * middleware once per run at finalize time with token usage, tool
   * call counts, and duration. Optional; AgentUI emits a `progress`
   * NDJSON event so orchestrators can bill / cap / monitor cost.
   * InkUI / LoggingUI no-op.
   *
   * Token counts come straight from the Claude Agent SDK's terminal
   * `result` message — they're cumulative across the entire run
   * (including any retries the runner performed). `costUsd` is the
   * SDK's own cost estimate; the wizard doesn't apply its own rate
   * card so the number stays consistent with the gateway's billing
   * source of truth.
   */
  emitAgentMetrics?(data: {
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    costUsd?: number;
    numTurns?: number;
    totalToolCalls?: number;
    totalMessages?: number;
    isError?: boolean;
    /**
     * Per-tool invocation counts. Lets orchestrators answer
     * "where did the time/cost go?" without parsing every
     * `progress: tool_call` event. Keys are the SDK's tool-name
     * strings — built-in tools (`"Read"`, `"Edit"`, `"Bash"`,
     * `"Grep"`, `"TodoWrite"`) and MCP tools (e.g.
     * `"mcp__amplitude-wizard__check_env_keys"`). Values are
     * integer counts. Omitted entirely (not `{}`) when the run
     * had zero tool_use blocks (auth-required early-exits etc.).
     */
    toolCallsByTool?: Record<string, number>;
  }): void;
}
