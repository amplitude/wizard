/**
 * WizardUI — abstraction layer for all user-facing operations.
 *
 * Business logic calls `getUI()` instead of importing the store directly.
 * Implementations: InkUI (TUI), LoggingUI (CI).
 *
 * No prompt methods — the TUI screens own all user input.
 * Session-mutating methods trigger reactive screen resolution in the TUI.
 */

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
  cancel(message: string, options?: { docsUrl?: string }): void;

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

  /** Store OAuth/API credentials. Resolves past AuthScreen in TUI. */
  setCredentials(credentials: {
    accessToken: string;
    projectApiKey: string;
    host: string;
    projectId: number;
  }): void;

  /** Show service degradation (pushes outage overlay in TUI). */
  showServiceStatus(data: { description: string; statusPageUrl: string }): void;

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
}
