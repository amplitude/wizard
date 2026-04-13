/**
 * WizardStore — Nanostore-backed reactive store for the TUI.
 * React components subscribe via useSyncExternalStore.
 *
 * Navigation is delegated to WizardRouter.
 * The active screen is derived from session state — not imperatively set.
 * Overlays (outage, etc.) are the only imperative navigation.
 *
 * All session mutations that affect screen resolution go through
 * explicit setters so emitChange() is always called.
 */

import { atom, map } from 'nanostores';
import { TaskStatus, type EventPlanDecision } from '../wizard-ui.js';
import {
  type WizardSession,
  type OutroData,
  type DiscoveredFeature,
  buildSession,
} from '../../lib/wizard-session.js';
import {
  AdditionalFeature,
  McpOutcome,
  SlackOutcome,
  RunPhase,
} from './session-constants.js';
import {
  WizardRouter,
  type ScreenName,
  Screen,
  Overlay,
  Flow,
} from './router.js';
import { analytics, sessionPropertiesCompact } from '../../utils/analytics.js';
// Inlined to avoid tsx ESM resolution bug with dynamic import().
const FLAG_LLM_ANALYTICS = 'wizard-llm-analytics';

export {
  TaskStatus,
  Screen,
  Overlay,
  Flow,
  RunPhase,
  McpOutcome,
  SlackOutcome,
};
export type { ScreenName, OutroData, WizardSession };

export interface TaskItem {
  label: string;
  activeForm?: string;
  status: TaskStatus;
  /** Legacy compat */
  done: boolean;
}

export interface PlannedEvent {
  name: string;
  description: string;
}

export type PendingPrompt =
  | { kind: 'confirm'; message: string; resolve: (value: boolean) => void }
  | {
      kind: 'choice';
      message: string;
      options: string[];
      resolve: (value: string) => void;
    }
  | {
      kind: 'event-plan';
      events: PlannedEvent[];
      resolve: (value: EventPlanDecision) => void;
    };

export class WizardStore {
  // ── Internal nanostore atoms ─────────────────────────────────────
  private $session = map<WizardSession>(buildSession({}));
  private $statusMessages = atom<string[]>([]);
  private $tasks = atom<TaskItem[]>([]);
  private $eventPlan = atom<PlannedEvent[]>([]);
  private $version = atom(0);

  /** True while the user is typing a slash command in the command bar. */
  private $commandMode = atom(false);

  /** Transient feedback message shown in the command bar after a command runs. */
  private $commandFeedback = atom<string | null>(null);

  /** Error caught by the app error boundary — shown in ConsoleView. */
  private $screenError = atom<Error | null>(null);
  private $screenErrorRetry = atom(0);

  /** Tab id to switch to imperatively (e.g. from a slash command). */
  private $requestedTab = atom<string | null>(null);

  /** Last screen seen — used to detect screen transitions for analytics. */
  private _lastScreen: ScreenName | null = null;

  /** Hooks run when transitioning onto a screen. */
  private _enterScreenHooks = new Map<ScreenName, (() => void)[]>();

  version = '';

  /** Navigation router — resolves active screen from session state. */
  readonly router: WizardRouter;

  /**
   * Setup promise — IntroScreen resolves this when the user confirms.
   * bin.ts awaits it before calling runWizard.
   */
  private _resolveSetup!: () => void;
  readonly setupComplete: Promise<void> = new Promise((resolve) => {
    this._resolveSetup = resolve;
  });

  /** Blocks agent execution until the settings-override overlay is dismissed. */
  private _resolveSettingsOverride: (() => void) | null = null;
  private _backupAndFixSettings: (() => boolean) | null = null;

  /** Pending confirmation or choice prompt from the agent. */
  private $pendingPrompt = atom<PendingPrompt | null>(null);

  /** Resolves when the user picks continue vs run wizard after Amplitude pre-detection. */
  private _preDetectedChoiceResolver:
    | ((runWizardAnyway: boolean) => void)
    | null = null;

  constructor(flow: Flow = Flow.Wizard) {
    this.router = new WizardRouter(flow);
  }

  // ── State accessors (read from atoms) ────────────────────────────

  get session(): WizardSession {
    return this.$session.get();
  }

  set session(value: WizardSession) {
    this.$session.set(value);
    this.emitChange();
  }

  get commandMode(): boolean {
    return this.$commandMode.get();
  }

  get commandFeedback(): string | null {
    return this.$commandFeedback.get();
  }

  get screenError(): Error | null {
    return this.$screenError.get();
  }

  get screenErrorRetry(): number {
    return this.$screenErrorRetry.get();
  }

  get requestedTab(): string | null {
    return this.$requestedTab.get();
  }

  get statusMessages(): string[] {
    return this.$statusMessages.get();
  }

  get tasks(): TaskItem[] {
    return this.$tasks.get();
  }

  get eventPlan(): PlannedEvent[] {
    return this.$eventPlan.get();
  }

  get pendingPrompt(): PendingPrompt | null {
    return this.$pendingPrompt.get();
  }

  // ── Session setters ─────────────────────────────────────────────
  // Every setter that affects screen resolution calls emitChange().
  // Business logic calls these instead of mutating session directly.

  /** Advances the flow past IntroScreen. Does not start the agent. */
  concludeIntro(): void {
    this.$session.setKey('introConcluded', true);
    this.emitChange();
  }

  /**
   * Unblocks bin.ts via the setupComplete promise, signalling that the agent
   * can start. Called by bin.ts via onEnterScreen(Screen.Run) so it fires at
   * the right point in the flow — after auth, data check, and setup questions.
   */
  completeSetup(): void {
    this.$session.setKey('setupConfirmed', true);
    analytics.wizardCapture(
      'Setup Confirmed',
      sessionPropertiesCompact(this.session),
    );
    this._resolveSetup();
    this.emitChange();
  }

  setRunPhase(phase: RunPhase): void {
    this.$session.setKey('runPhase', phase);
    this.emitChange();
  }

  setCredentials(credentials: WizardSession['credentials']): void {
    this.$session.setKey('credentials', credentials);
    if (credentials?.projectId) {
      analytics.setDistinctId(String(credentials.projectId));
    }
    analytics.wizardCapture('Auth Complete', {
      project_id: credentials?.projectId,
      region: this.session.region,
    });
    this.emitChange();
  }

  setApiKeyNotice(notice: string | null): void {
    this.$session.setKey('apiKeyNotice', notice);
    this.emitChange();
  }

  setSelectedProjectName(name: string | null): void {
    this.$session.setKey('selectedProjectName', name);
    this.emitChange();
  }

  setFrameworkConfig(
    integration: WizardSession['integration'],
    config: WizardSession['frameworkConfig'],
  ): void {
    this.$session.setKey('integration', integration);
    this.$session.setKey('frameworkConfig', config);
    this.emitChange();
  }

  setDetectionComplete(): void {
    this.$session.setKey('detectionComplete', true);
    this.emitChange();
  }

  setDetectedFramework(label: string): void {
    this.$session.setKey('detectedFrameworkLabel', label);
    this.emitChange();
  }

  setLoginUrl(url: string | null): void {
    this.$session.setKey('loginUrl', url);
    this.emitChange();
  }

  setRegion(region: string): void {
    this.$session.setKey('region', region as WizardSession['region']);
    this.$session.setKey('regionForced', false);

    // Persist region to project-level ampli.json so next run uses the right zone.
    // Only writes if OrgId/WorkspaceId already exist (otherwise writeAmpliConfig
    // would create a partial config).
    const session = this.$session.get();
    if (session.selectedOrgId && session.selectedWorkspaceId) {
      void import('../../lib/ampli-config.js').then(({ writeAmpliConfig }) => {
        writeAmpliConfig(session.installDir, {
          OrgId: session.selectedOrgId!,
          WorkspaceId: session.selectedWorkspaceId!,
          Zone: region as 'us' | 'eu',
        });
      });
    }

    this.emitChange();
  }

  /** Force the RegionSelect screen to re-appear (/region command). */
  setRegionForced(): void {
    this.$session.setKey('regionForced', true);
    // Reset data check so it re-runs after region changes
    this.$session.setKey('projectHasData', null);
    this.emitChange();
  }

  private _retryResolve: (() => void) | null = null;

  setScreenError(error: Error): void {
    this.$screenError.set(error);
    this.$version.set(this.$version.get() + 1);
  }

  clearScreenError(): void {
    this.$screenError.set(null);
    this.$screenErrorRetry.set(this.$screenErrorRetry.get() + 1);
    this.$version.set(this.$version.get() + 1);
    this._retryResolve?.();
    this._retryResolve = null;
  }

  /**
   * Returns a Promise that resolves the next time clearScreenError() is called
   * (i.e. the user presses R). Used by InkUI.setRunError to block until retry.
   */
  waitForRetry(): Promise<void> {
    return new Promise((resolve) => {
      this._retryResolve = resolve;
    });
  }

  /** Show a confirmation prompt. Resolves with true (yes) or false (no / skipped). */
  promptConfirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.$pendingPrompt.set({ kind: 'confirm', message, resolve });
      this.$version.set(this.$version.get() + 1);
    });
  }

  /** Show a multiple-choice prompt. Resolves with the chosen option or empty string if skipped. */
  promptChoice(message: string, options: string[]): Promise<string> {
    return new Promise((resolve) => {
      this.$pendingPrompt.set({ kind: 'choice', message, options, resolve });
      this.$version.set(this.$version.get() + 1);
    });
  }

  /** Resolve a confirm or choice pending prompt. */
  resolvePrompt(answer: boolean | string): void {
    const prompt = this.$pendingPrompt.get();
    if (!prompt || prompt.kind === 'event-plan') return;
    analytics.wizardCapture('Prompt Response', {
      prompt_kind: prompt.kind,
      response: String(answer),
    });
    this.$pendingPrompt.set(null);
    this.$version.set(this.$version.get() + 1);
    if (prompt.kind === 'confirm') {
      prompt.resolve(answer as boolean);
    } else {
      prompt.resolve(answer as string);
    }
  }

  /** Show an event-plan confirmation. Resolves when the user approves, skips, or gives feedback. */
  promptEventPlan(events: PlannedEvent[]): Promise<EventPlanDecision> {
    return new Promise((resolve) => {
      this.$pendingPrompt.set({ kind: 'event-plan', events, resolve });
      this.$version.set(this.$version.get() + 1);
    });
  }

  /** Resolve the pending event-plan prompt. */
  resolveEventPlan(decision: EventPlanDecision): void {
    const prompt = this.$pendingPrompt.get();
    if (!prompt || prompt.kind !== 'event-plan') return;
    analytics.wizardCapture('Prompt Response', {
      prompt_kind: 'event-plan',
      response: typeof decision === 'object' ? 'feedback' : String(decision),
    });
    this.$pendingPrompt.set(null);
    this.$version.set(this.$version.get() + 1);
    prompt.resolve(decision);
  }

  /** Enter or exit slash command mode. */
  setCommandMode(active: boolean): void {
    this.$commandMode.set(active);
    this.$version.set(this.$version.get() + 1);
  }

  showSnakeOverlay(): void {
    this.pushOverlay(Overlay.Snake);
  }

  hideSnakeOverlay(): void {
    this.popOverlay();
  }

  showMcpOverlay(): void {
    this.pushOverlay(Overlay.Mcp);
  }

  hideMcpOverlay(): void {
    this.popOverlay();
  }

  showSlackOverlay(): void {
    this.pushOverlay(Overlay.Slack);
  }

  hideSlackOverlay(): void {
    this.popOverlay();
  }

  showLogoutOverlay(): void {
    this.pushOverlay(Overlay.Logout);
  }

  hideLogoutOverlay(): void {
    this.popOverlay();
  }

  showLoginOverlay(): void {
    this.pushOverlay(Overlay.Login);
  }

  hideLoginOverlay(): void {
    this.popOverlay();
  }

  /** Update just the access token in credentials without triggering auth analytics. */
  updateAccessToken(accessToken: string): void {
    const creds = this.$session.get().credentials;
    if (!creds) return;
    this.$session.setKey('credentials', { ...creds, accessToken });
    this.$version.set(this.$version.get() + 1);
  }

  /** Request the TabContainer to switch to a tab by id. Clears after consumption. */
  setRequestedTab(id: string): void {
    this.$requestedTab.set(id);
    this.$version.set(this.$version.get() + 1);
  }

  clearRequestedTab(): void {
    this.$requestedTab.set(null);
  }

  /** Show a transient feedback message in the command bar. Clears after ms. */
  setCommandFeedback(message: string, ms = 3000): void {
    this.$commandFeedback.set(message);
    this.$version.set(this.$version.get() + 1);
    setTimeout(() => {
      this.$commandFeedback.set(null);
      this.$version.set(this.$version.get() + 1);
    }, ms);
  }

  setProjectHasData(value: boolean): void {
    this.$session.setKey('projectHasData', value);
    this.emitChange();
  }

  setActivationLevel(level: 'none' | 'partial' | 'full'): void {
    this.$session.setKey('activationLevel', level);
    // Keep projectHasData in sync so existing routing still works
    this.$session.setKey('projectHasData', level === 'full' ? true : false);
    this.emitChange();
  }

  setSnippetConfigured(value: boolean): void {
    this.$session.setKey('snippetConfigured', value);
    this.emitChange();
  }

  setDataIngestionConfirmed(): void {
    this.$session.setKey('dataIngestionConfirmed', true);
    analytics.wizardCapture(
      'Data Ingestion Confirmed',
      sessionPropertiesCompact(this.session),
    );
    this.emitChange();
  }

  setChecklistChartComplete(): void {
    this.$session.setKey('checklistChartComplete', true);
    this.emitChange();
  }

  setChecklistDashboardComplete(): void {
    this.$session.setKey('checklistDashboardComplete', true);
    this.emitChange();
  }

  setChecklistComplete(): void {
    this.$session.setKey('checklistComplete', true);
    analytics.wizardCapture('Checklist Completed', {
      chart_complete: this.session.checklistChartComplete,
      dashboard_complete: this.session.checklistDashboardComplete,
      ...sessionPropertiesCompact(this.session),
    });
    this.emitChange();
  }

  setActivationOptionsComplete(): void {
    this.$session.setKey('activationOptionsComplete', true);
    this.emitChange();
  }

  /**
   * Called from bin.ts when OAuth completes (browser redirect done).
   * Stores auth tokens + org list so AuthScreen can show the SUSI pickers.
   * Also sets region from the detected cloud zone.
   */
  setOAuthComplete(data: {
    accessToken: string;
    idToken: string;
    cloudRegion: WizardSession['pendingAuthCloudRegion'];
    orgs: WizardSession['pendingOrgs'];
  }): void {
    this.$session.setKey('pendingAuthAccessToken', data.accessToken);
    this.$session.setKey('pendingAuthIdToken', data.idToken);
    this.$session.setKey('pendingAuthCloudRegion', data.cloudRegion);
    this.$session.setKey('pendingOrgs', data.orgs);
    // Auto-set region — skips RegionSelect for users whose zone is detected.
    if (data.cloudRegion) {
      this.$session.setKey('region', data.cloudRegion);
    }
    this.emitChange();
  }

  /**
   * Called from AuthScreen when the user finishes org + workspace selection.
   * Writes ampli.json and records org/workspace on the session.
   */
  setOrgAndWorkspace(
    org: { id: string; name: string },
    workspace: { id: string; name: string },
    installDir: string,
  ): void {
    this.$session.setKey('selectedOrgId', org.id);
    this.$session.setKey('selectedOrgName', org.name);
    this.$session.setKey('selectedWorkspaceId', workspace.id);
    this.$session.setKey('selectedWorkspaceName', workspace.name);

    // Write ampli.json to the project directory.
    // Use session.region (user-confirmed) over pendingAuthCloudRegion (auto-detected)
    // so that /region changes are respected.
    void import('../../lib/ampli-config.js').then(({ writeAmpliConfig }) => {
      const zone =
        this.$session.get().region ??
        this.$session.get().pendingAuthCloudRegion ??
        'us';
      writeAmpliConfig(installDir, {
        OrgId: org.id,
        WorkspaceId: workspace.id,
        Zone: zone,
      });
    });

    this.emitChange();
  }

  setServiceStatus(
    status: { description: string; statusPageUrl: string } | null,
  ): void {
    this.$session.setKey('serviceStatus', status);
    this.emitChange();
  }

  /**
   * Push the settings-override overlay and return a promise that blocks
   * until the user dismisses it via backupAndFixSettingsOverride().
   */
  showSettingsOverride(
    keys: string[],
    backupAndFix: () => boolean,
  ): Promise<void> {
    this.$session.setKey('settingsOverrideKeys', keys);
    this._backupAndFixSettings = backupAndFix;
    this.pushOverlay(Overlay.SettingsOverride);
    return new Promise((resolve) => {
      this._resolveSettingsOverride = resolve;
    });
  }

  /**
   * Back up .claude/settings.json. Dismisses the overlay on success.
   */
  backupAndFixSettingsOverride(): boolean {
    const ok = this._backupAndFixSettings?.() ?? false;
    if (ok) {
      this.$session.setKey('settingsOverrideKeys', null);
      this.popOverlay();
      this._resolveSettingsOverride?.();
      this._resolveSettingsOverride = null;
      this._backupAndFixSettings = null;
    }
    return ok;
  }

  addDiscoveredFeature(feature: DiscoveredFeature): void {
    if (!this.session.discoveredFeatures.includes(feature)) {
      this.$session.setKey('discoveredFeatures', [
        ...this.session.discoveredFeatures,
        feature,
      ]);
      this.emitChange();
    }
  }

  /**
   * Enable an additional feature: enqueue it for the stop hook
   * and set any feature-specific session flags.
   * Respects Amplitude Experiment feature flags — if the corresponding
   * flag is off the feature is silently skipped.
   */
  enableFeature(feature: AdditionalFeature): void {
    // Gate LLM analytics behind the wizard-llm-analytics feature flag
    if (feature === AdditionalFeature.LLM) {
      if (!analytics.isFeatureFlagEnabled(FLAG_LLM_ANALYTICS)) {
        return;
      }
    }

    if (!this.session.additionalFeatureQueue.includes(feature)) {
      this.$session.setKey('additionalFeatureQueue', [
        ...this.session.additionalFeatureQueue,
        feature,
      ]);
    }
    // Feature-specific flags
    if (feature === AdditionalFeature.LLM) {
      this.$session.setKey('llmOptIn', true);
    }
    analytics.wizardCapture('Feature Enabled', { feature });
    this.emitChange();
  }

  setAmplitudePreDetected(): void {
    this.$session.setKey('amplitudePreDetected', true);
    this.$session.setKey('amplitudePreDetectedChoicePending', true);
    this.emitChange();
  }

  /**
   * Blocks bin.ts until McpScreen resolves via resolvePreDetectedChoice().
   */
  waitForPreDetectedChoice(): Promise<boolean> {
    return new Promise((resolve) => {
      this._preDetectedChoiceResolver = resolve;
    });
  }

  /**
   * Called from McpScreen when the user chooses to skip the agent (continue to
   * MCP) or run the full setup wizard anyway.
   */
  resolvePreDetectedChoice(runWizardAnyway: boolean): void {
    const resolveFn = this._preDetectedChoiceResolver;
    this._preDetectedChoiceResolver = null;
    if (!runWizardAnyway) {
      this.$session.setKey('amplitudePreDetectedChoicePending', false);
    }
    this.emitChange();
    resolveFn?.(runWizardAnyway);
  }

  /**
   * Undo the pre-detection fast-path so runWizard can run; used when the user
   * opts into the setup agent after Amplitude was already found in the project.
   */
  resetForAgentAfterPreDetected(): void {
    this.$session.setKey('amplitudePreDetected', false);
    this.$session.setKey('amplitudePreDetectedChoicePending', false);
    this.$session.setKey('runPhase', RunPhase.Idle);
    this.emitChange();
  }

  setMcpComplete(
    outcome: McpOutcome = McpOutcome.Skipped,
    installedClients: string[] = [],
  ): void {
    this.$session.setKey('mcpComplete', true);
    this.$session.setKey('mcpOutcome', outcome);
    this.$session.setKey('mcpInstalledClients', installedClients);
    analytics.wizardCapture('MCP Complete', {
      mcp_outcome: outcome,
      mcp_installed_clients: installedClients,
      ...sessionPropertiesCompact(this.session),
    });
    this.emitChange();
  }

  setSlackComplete(outcome: SlackOutcome = SlackOutcome.Skipped): void {
    this.$session.setKey('slackComplete', true);
    this.$session.setKey('slackOutcome', outcome);
    analytics.wizardCapture('Slack Complete', {
      slack_outcome: outcome,
      ...sessionPropertiesCompact(this.session),
    });
    this.emitChange();
  }

  setOutroData(data: OutroData): void {
    this.$session.setKey('outroData', data);
    this.emitChange();
  }

  setFrameworkContext(key: string, value: unknown): void {
    const ctx = { ...this.$session.get().frameworkContext, [key]: value };
    this.$session.setKey('frameworkContext', ctx);
    this.emitChange();
  }

  // ── Derived state ───────────────────────────────────────────────

  /**
   * The screen that should be rendered right now.
   * Derived from session state via the router.
   */
  get currentScreen(): ScreenName {
    return this.router.resolve(this.session);
  }

  /** Direction hint for screen transitions. */
  get lastNavDirection(): 'push' | 'pop' | null {
    return this.router.lastNavDirection;
  }

  // ── Change notification ─────────────────────────────────────────

  getVersion(): number {
    return this.$version.get();
  }

  /**
   * Notify React that state has changed.
   * The router re-resolves the active screen on next render.
   */
  emitChange(): void {
    this.router._setDirection('push');
    this.$version.set(this.$version.get() + 1);
    this._detectTransition();
  }

  // ── Overlay navigation ──────────────────────────────────────────

  pushOverlay(overlay: Overlay): void {
    this.router._setDirection('push');
    this.router.pushOverlay(overlay);
    this.$version.set(this.$version.get() + 1);
    this._detectTransition();
  }

  popOverlay(): void {
    this.router._setDirection('pop');
    this.router.popOverlay();
    this.$version.set(this.$version.get() + 1);
    this._detectTransition();
  }

  // ── Screen transition analytics ─────────────────────────────────

  /**
   * Register a callback to run when transitioning onto the given screen.
   * Fires after every transition that lands on this screen.
   */
  onEnterScreen(screen: ScreenName, fn: () => void): void {
    const list = this._enterScreenHooks.get(screen) ?? [];
    list.push(fn);
    this._enterScreenHooks.set(screen, list);
  }

  /**
   * Detect screen transitions, run enter-screen hooks, and fire analytics.
   * Called at the end of emitChange/pushOverlay/popOverlay.
   */
  private _detectTransition(): void {
    const next = this.router.resolve(this.session);
    const prev = this._lastScreen;
    // Update _lastScreen before invoking hooks so re-entrant emitChange calls
    // (e.g. completeSetup inside an onEnterScreen hook) see prev === next and
    // don't re-fire the same hooks, preventing infinite recursion.
    this._lastScreen = next;
    if (prev !== null && next !== prev) {
      const hooks = this._enterScreenHooks.get(next);
      if (hooks) {
        for (const fn of hooks) fn();
      }
      analytics.wizardCapture('Wizard Screen Entered', {
        screen_name: next,
        previous_screen: prev,
        ...sessionPropertiesCompact(this.session),
      });
    }
  }

  // ── Agent observation state ─────────────────────────────────────

  pushStatus(message: string): void {
    this.$statusMessages.set([...this.$statusMessages.get(), message]);
    this.emitChange();
  }

  setTasks(tasks: TaskItem[]): void {
    this.$tasks.set(tasks);
    this.emitChange();
  }

  updateTask(index: number, done: boolean): void {
    const tasks = this.$tasks.get();
    if (tasks[index]) {
      const updated = [...tasks];
      updated[index] = {
        ...updated[index],
        done,
        status: done ? TaskStatus.Completed : TaskStatus.Pending,
      };
      this.$tasks.set(updated);
      this.emitChange();
    }
  }

  setEventPlan(events: PlannedEvent[]): void {
    this.$eventPlan.set(events);
    this.emitChange();
  }

  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void {
    const incoming = todos.map((t) => ({
      label: t.content,
      activeForm: t.activeForm,
      status: (t.status as TaskStatus) || TaskStatus.Pending,
      done: (t.status as TaskStatus) === TaskStatus.Completed,
    }));

    const incomingLabels = new Set(incoming.map((t) => t.label));

    const retained = this.$tasks
      .get()
      .filter((t) => t.done && !incomingLabels.has(t.label));

    this.$tasks.set([...retained, ...incoming]);
    this.emitChange();
  }

  // ── React integration ───────────────────────────────────────────

  subscribe(callback: () => void): () => void {
    return this.$version.listen(() => callback());
  }

  getSnapshot(): number {
    return this.$version.get();
  }
}
