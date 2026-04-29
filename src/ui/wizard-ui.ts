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
   * Print a periodic "still running" summary of the last N status messages.
   * Called by the agent runner every ~10 seconds while the agent is active.
   * LoggingUI prints to stdout; InkUI is a no-op (TUI already shows live updates).
   */
  heartbeat(statuses: string[]): void;

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

  /** Warn that .claude/settings.json overrides blocking env vars (pushes blocking overlay in TUI). */
  showSettingsOverride(
    keys: string[],
    backupAndFix: () => boolean,
  ): Promise<void>;

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
}
