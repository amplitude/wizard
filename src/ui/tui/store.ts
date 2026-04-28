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
  type CloudRegion,
  type RetryState,
  buildSession,
} from '../../lib/wizard-session.js';
import { DEFAULT_AMPLITUDE_ZONE } from '../../lib/constants.js';
import { resolveZone } from '../../lib/zone-resolution.js';
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
export type { ScreenName, OutroData, WizardSession, RetryState };

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
      'setup confirmed',
      sessionPropertiesCompact(this.session),
    );
    this._resolveSetup();
    this.emitChange();
  }

  setRunPhase(phase: RunPhase): void {
    const prevPhase = this.session.runPhase;
    this.$session.setKey('runPhase', phase);
    // Stamp the start time on the transition into Running so the elapsed
    // timer on the Run screen survives tab re-mounts (TabContainer fully
    // unmounts inactive tabs).
    if (phase === RunPhase.Running && prevPhase !== RunPhase.Running) {
      this.$session.setKey('runStartedAt', Date.now());
    }
    this.emitChange();
  }

  setCredentials(credentials: WizardSession['credentials']): void {
    this.$session.setKey('credentials', credentials);
    const session = this.$session.get();
    // readDisk: true — setCredentials may be called from paths (agent mode,
    // classic UI, token refresh) that run before / around RegionSelect.
    const zone = resolveZone(session, DEFAULT_AMPLITUDE_ZONE, {
      readDisk: true,
    });
    if (session.userEmail) {
      analytics.setDistinctId(session.userEmail);
      analytics.identifyUser({
        email: session.userEmail,
        org_id: session.selectedOrgId ?? undefined,
        org_name: session.selectedOrgName ?? undefined,
        project_id: session.selectedProjectId ?? undefined,
        project_name: session.selectedProjectName ?? undefined,
        app_id: session.selectedAppId ?? credentials?.appId,
        env_name: session.selectedEnvName,
        region: zone,
        integration: session.integration,
      });
    }
    analytics.wizardCapture('auth complete', {
      'app id': credentials?.appId,
      region: zone,
    });
    this.emitChange();
  }

  /**
   * Update the cached user email used by `/whoami`. Required because nanostores'
   * map-based storage replaces the top-level session object on every `setKey`,
   * so closed-over `session` references in long-lived callbacks (e.g. the
   * re-auth watcher in bin.ts) become stale and direct mutation would land on
   * a discarded object.
   */
  setUserEmail(email: string | null): void {
    this.$session.setKey('userEmail', email);
    this.emitChange();
  }

  setApiKeyNotice(notice: string | null): void {
    this.$session.setKey('apiKeyNotice', notice);
    this.emitChange();
  }

  setSelectedEnvName(name: string | null): void {
    this.$session.setKey('selectedEnvName', name);
    this.emitChange();
  }

  setFrameworkConfig(
    integration: WizardSession['integration'],
    config: WizardSession['frameworkConfig'],
  ): void {
    this.$session.setKey('integration', integration);
    this.$session.setKey('frameworkConfig', config);
    if (integration) {
      analytics.identifyUser({ integration });
    }
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
    analytics.wizardCapture('region selected', { region });

    // Persist the chosen zone to project-level ampli.json so the next
    // wizard run uses the right zone — even if the user exits before
    // completing SUSI. When the user is switching regions via /region the
    // prior OrgId/ProjectId are invalid in the new zone; drop them so
    // resolveCredentials doesn't silently steer back to a stale project.
    //
    // Only updates an existing ampli.json; never creates one. Fresh
    // projects have their zone persisted later by setOrgAndProject()
    // once the full SUSI flow completes.
    const session = this.$session.get();
    const typedZone = region as 'us' | 'eu';
    void (async () => {
      try {
        const { readAmpliConfig, writeAmpliConfig } = await import(
          '../../lib/ampli-config.js'
        );
        const prior = readAmpliConfig(session.installDir);
        if (!prior.ok) return; // no existing ampli.json — nothing to update
        const next = { ...prior.config, Zone: typedZone };
        if (session.selectedOrgId && session.selectedProjectId) {
          next.OrgId = session.selectedOrgId;
          next.ProjectId = session.selectedProjectId;
        } else {
          // Cleared by setRegionForced — IDs from the old zone are invalid.
          delete next.OrgId;
          delete next.ProjectId;
        }
        writeAmpliConfig(session.installDir, next);
      } catch (err) {
        // Non-fatal: ampli.json persistence is best-effort. On read-only
        // filesystems or permission errors we'd leave the old Zone in place
        // and users can still complete the current session.
        analytics.captureException(
          err instanceof Error ? err : new Error(String(err)),
        );
        // Surface a non-blocking notice in the command bar so the user
        // knows the region change wasn't persisted to ampli.json — the
        // next wizard run won't auto-pick this zone. The session itself
        // is fine; only on-disk persistence failed.
        this.setCommandFeedback(
          "Region updated for this session, but couldn't persist to ampli.json. Re-pick if it sticks to the old zone next run.",
          6000,
        );
      }
    })();

    this.emitChange();
  }

  setSignupEmail(email: string): void {
    this.$session.setKey('signupEmail', email);
    analytics.wizardCapture('signup email captured', { 'has email': !!email });
    this.emitChange();
  }

  markEmailCaptureComplete(): void {
    this.$session.setKey('emailCaptureComplete', true);
    analytics.wizardCapture('email capture complete');
    this.emitChange();
  }

  acceptTermsOfService(): void {
    this.$session.setKey('tosAccepted', true);
    analytics.wizardCapture('terms of service accepted');
    this.emitChange();
  }

  resetEmailCapture(): void {
    this.$session.setKey('emailCaptureComplete', false);
    analytics.wizardCapture('back navigation', { to: 'email-capture' });
    this.emitChange();
  }

  resetToS(): void {
    this.$session.setKey('tosAccepted', null);
    analytics.wizardCapture('back navigation', { to: 'tos' });
    this.emitChange();
  }

  cancelWizard(reason: string): void {
    this.setOutroData({
      kind: 'cancel' as const,
      message: reason,
    });
    this.emitChange();
  }

  /**
   * Force the RegionSelect screen to re-appear (/region command).
   *
   * A mid-session region change is equivalent to logging out and logging back
   * in against the other data center: OAuth tokens are zone-scoped, and every
   * org/workspace/environment the user has picked lives in the old region.
   * Clear all of that so the Auth screen reappears once a new region is
   * picked, forcing a fresh login. Stored tokens in ~/.ampli.json are kept
   * per-zone and will be silently reused if the user already signed into the
   * target region previously.
   */
  setRegionForced(): void {
    this.$session.setKey('regionForced', true);

    // Credentials and OAuth intermediates (all zone-scoped)
    this.$session.setKey('credentials', null);
    this.$session.setKey('pendingOrgs', null);
    this.$session.setKey('pendingAuthIdToken', null);
    this.$session.setKey('pendingAuthAccessToken', null);
    this.$session.setKey('apiKeyNotice', null);

    // User / org / workspace / project selection — all lived in the old zone
    this.$session.setKey('userEmail', null);
    this.$session.setKey('selectedOrgId', null);
    this.$session.setKey('selectedOrgName', null);
    this.$session.setKey('selectedProjectId', null);
    this.$session.setKey('selectedProjectName', null);
    this.$session.setKey('selectedAppId', null);
    this.$session.setKey('selectedEnvName', null);

    // Downstream flow state that depends on the old zone's data
    this.$session.setKey('projectHasData', null);
    this.$session.setKey('activationLevel', null);
    this.$session.setKey('activationOptionsComplete', false);
    this.$session.setKey('dataIngestionConfirmed', false);
    this.$session.setKey('mcpComplete', false);
    this.$session.setKey('mcpOutcome', null);
    this.$session.setKey('mcpInstalledClients', []);
    this.$session.setKey('slackComplete', false);
    this.$session.setKey('slackOutcome', null);

    // Framework-detection + feature-discovery state lived against the old
    // zone's project. Clearing these BEFORE we touch outroData/runPhase keeps
    // the router from transiently resolving to a post-detection screen
    // (e.g. FeatureOptIn / Setup) while runPhase is still mid-tear-down.
    this.$session.setKey('integration', null);
    this.$session.setKey('frameworkConfig', null);
    this.$session.setKey('frameworkContext', {});
    this.$session.setKey('discoveredFeatures', []);
    this.$session.setKey('additionalFeatureQueue', []);
    this.$session.setKey('additionalFeatureCurrent', null);
    this.$session.setKey('additionalFeatureCompleted', []);
    this.$session.setKey('optInFeaturesComplete', false);

    // If the wizard had already reached Outro (success, error, or cancel)
    // the outroData short-circuits router.resolve and would block the
    // re-auth flow. A region switch is a hard reset — clear outroData so
    // the user lands on RegionSelect → Auth → ... for the new zone.
    this.$session.setKey('outroData', null);
    this.$session.setKey('runPhase', RunPhase.Idle);

    this.emitChange();
  }

  /**
   * Reset session fields cleared by IntroScreen's "Start fresh" branch
   * after a checkpoint restore.
   *
   * Previously the screen did `store.session = { ...store.session, ... }`
   * — direct top-level reassignment goes through the `set session()`
   * setter, which calls `$session.set()` + `emitChange()`. That works
   * for `useSyncExternalStore` subscribers (everyone reads via
   * `$version`), BUT it bypasses the per-key change events that
   * nanostores `map.setKey()` emits. Any future code that subscribes
   * via `listenKeys(['integration'])` etc. would silently miss the
   * reset. Routing the same reset through individual `setKey` calls is
   * the idiomatic store pattern and keeps the contract uniform across
   * actions — every other reset (`setRegionForced`, etc.) does it this
   * way already.
   */
  resetForFreshStart(): void {
    this.$session.setKey('_restoredFromCheckpoint', false);
    this.$session.setKey('introConcluded', false);
    this.$session.setKey('detectionComplete', false);
    this.$session.setKey('detectedFrameworkLabel', null);
    this.$session.setKey('integration', null);
    this.$session.setKey('frameworkConfig', null);
    this.$session.setKey('frameworkContext', {});
    this.$session.setKey('region', null);
    this.$session.setKey('selectedOrgId', null);
    this.$session.setKey('selectedOrgName', null);
    this.$session.setKey('selectedProjectId', null);
    this.$session.setKey('selectedProjectName', null);
    this.$session.setKey('selectedEnvName', null);
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
    analytics.wizardCapture('prompt response', {
      'prompt kind': prompt.kind,
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
    analytics.wizardCapture('prompt response', {
      'prompt kind': 'event-plan',
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
    // Set the loggingOut flag SYNCHRONOUSLY before pushing the overlay so the
    // bin.ts re-auth watcher can't race the overlay push and observe a state
    // where credentials are null but currentScreen is not yet Overlay.Logout
    // (which would trigger an unwanted runOAuthCycle and pop the browser).
    this.$session.setKey('loggingOut', true);
    this.pushOverlay(Overlay.Logout);
  }

  hideLogoutOverlay(): void {
    // Clearing loggingOut here covers the cancel path (user dismissed the
    // confirm prompt). On the confirm path, process.exit(0) tears the
    // process down before this matters.
    this.$session.setKey('loggingOut', false);
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

  /** Update both access and id tokens (e.g. after a silent OAuth refresh). */
  updateTokens(accessToken: string, idToken: string): void {
    const creds = this.$session.get().credentials;
    if (!creds) return;
    this.$session.setKey('credentials', { ...creds, accessToken, idToken });
    this.$version.set(this.$version.get() + 1);
  }

  /**
   * Restore org/project/app session IDs that weren't populated at startup
   * (e.g. because the fire-and-forget fetchAmplitudeUser failed due to expired token).
   * Only updates fields that are provided.
   */
  restoreSessionIds(fields: {
    orgId?: string;
    orgName?: string;
    projectId?: string;
    projectName?: string;
    appId?: string | null;
  }): void {
    if (fields.orgId !== undefined)
      // Mirror setOrgAndWorkspace: collapse '' -> null so isAuthenticated
      // doesn't treat an empty org id as a real one.
      this.$session.setKey('selectedOrgId', fields.orgId || null);
    if (fields.orgName !== undefined)
      this.$session.setKey('selectedOrgName', fields.orgName);
    if (fields.projectId !== undefined)
      // Mirror setOrgAndProject: collapse empty strings to null so an
      // accidental '' from a caller is treated as "no project" rather than
      // a real ID. No current caller passes empty (CreateProjectScreen
      // omits projectId, DataIngestionCheckScreen reads from API
      // responses), but keeping the guard consistent across both write
      // paths prevents future regressions.
      this.$session.setKey('selectedProjectId', fields.projectId || null);
    if (fields.projectName !== undefined)
      this.$session.setKey('selectedProjectName', fields.projectName);
    if (fields.appId !== undefined)
      this.$session.setKey('selectedAppId', fields.appId);
    this.emitChange();
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
      'data ingestion confirmed',
      sessionPropertiesCompact(this.session),
    );
    this.emitChange();
  }

  setChecklistDashboardUrl(url: string): void {
    this.$session.setKey('checklistDashboardUrl', url);
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
    cloudRegion: CloudRegion | null;
    orgs: WizardSession['pendingOrgs'];
  }): void {
    this.$session.setKey('pendingAuthAccessToken', data.accessToken);
    this.$session.setKey('pendingAuthIdToken', data.idToken);
    this.$session.setKey('pendingOrgs', data.orgs);
    // Auto-set region — skips RegionSelect for users whose zone is detected.
    // OAuth-derived zone is intent-equivalent per the write invariant on the
    // region field (see src/lib/wizard-session.ts).
    if (data.cloudRegion) {
      this.$session.setKey('region', data.cloudRegion);
    }
    this.emitChange();
  }

  /** Replace the cached org list (used by Start Over to pick up newly-created projects). */
  setPendingOrgs(orgs: WizardSession['pendingOrgs']): void {
    this.$session.setKey('pendingOrgs', orgs);
    this.emitChange();
  }

  /**
   * Enter the create-project flow. Sets `session.createProject.pending = true`
   * so the router resolves to CreateProjectScreen.
   *
   * @param source which picker or invocation triggered creation
   * @param suggestedName optional pre-filled name (e.g. from /create-project <name> or --project-name)
   */
  startCreateProject(
    source: 'project' | 'environment' | 'slash' | 'cli-flag',
    suggestedName?: string | null,
  ): void {
    this.$session.setKey('createProject', {
      pending: true,
      source,
      suggestedName: suggestedName ?? null,
    });
    analytics.wizardCapture('Create Project Started', { source });
    this.emitChange();
  }

  /** Exit the create-project flow without creating a project. */
  cancelCreateProject(): void {
    this.$session.setKey('createProject', {
      pending: false,
      source: null,
      suggestedName: null,
    });
    analytics.wizardCapture('Create Project Cancelled', {});
    this.emitChange();
  }

  /**
   * Finish the create-project flow successfully. Clears the pending flag
   * — the caller is responsible for calling `setCredentials()` with the
   * returned apiKey so the rest of the auth flow stays consistent.
   */
  completeCreateProject(): void {
    this.$session.setKey('createProject', {
      pending: false,
      source: null,
      suggestedName: null,
    });
    this.emitChange();
  }

  /**
   * Called from AuthScreen when org + project selection changes.
   * Records org/project on the session, and (when `persist` is true)
   * writes the IDs to the project's ampli.json.
   *
   * Pass `persist: false` from synthesisers that only mirror existing state
   * (e.g. the auto-resolve effect that reflects values already loaded from
   * ampli.json) — those code paths shouldn't trigger fresh disk writes
   * during render. User-driven flows (picker selection, "start over",
   * "create project") leave `persist` at its default of `true` so the
   * config file stays in sync with what the user picked.
   */
  setOrgAndProject(
    org: { id: string; name: string },
    project: {
      id: string;
      name: string;
      environments?: Array<{
        rank: number;
        app: { id: string; apiKey?: string | null } | null;
      }> | null;
    },
    installDir: string,
    options: { persist?: boolean } = {},
  ): void {
    const { persist = true } = options;

    // Callers (e.g. AuthScreen "Start Over", stale-org clear, create-project
    // fallback) pass `{ id: '', name: '' }` to reset session state. Collapse
    // empty IDs to null so `isAuthenticated` and downstream truthy checks
    // treat them as "not selected" rather than as real values.
    this.$session.setKey('selectedOrgId', org.id || null);
    this.$session.setKey('selectedOrgName', org.name);
    this.$session.setKey('selectedProjectId', project.id || null);
    this.$session.setKey('selectedProjectName', project.name);

    // Extract the Amplitude app ID from the lowest-rank environment.
    const appId =
      project.environments
        ?.slice()
        .sort((a, b) => a.rank - b.rank)
        .find((e) => e.app?.id)?.app?.id ?? null;
    this.$session.setKey('selectedAppId', appId);

    if (persist) {
      // Write ampli.json to the project directory.
      void import('../../lib/ampli-config.js').then(({ writeAmpliConfig }) => {
        // readDisk: true — invoked from store mutation paths where the
        // RegionSelect invariant isn't guaranteed (e.g. checkpoint restore).
        const zone = resolveZone(this.$session.get(), DEFAULT_AMPLITUDE_ZONE, {
          readDisk: true,
        });
        writeAmpliConfig(installDir, {
          OrgId: org.id,
          ProjectId: project.id,
          Zone: zone,
        });
      });
    }

    this.emitChange();
  }

  setServiceStatus(
    status: { description: string; statusPageUrl: string } | null,
  ): void {
    this.$session.setKey('serviceStatus', status);
    this.emitChange();
  }

  setRetryState(state: RetryState | null): void {
    this.$session.setKey('retryState', state);
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
   * Auto-enable every opt-in addon (Session Replay, Guides & Surveys,
   * LLM when the feature flag is on) that's been discovered for the
   * current integration. Routes through `enableFeature` so React
   * subscribers get notified and per-feature analytics fire.
   *
   * No opt-in picker — the unified browser SDK ships with all three
   * addons in one package. Quota / privacy concerns are surfaced via
   * per-option inline comments in the agent-generated init code, which
   * users can comment out individually — a clearer opt-out surface
   * than a one-shot picker.
   */
  autoEnableInlineAddons(
    source: 'auto-tui' | 'auto-ci' | 'auto-agent' = 'auto-tui',
  ): void {
    for (const feature of this.session.discoveredFeatures) {
      let additional: AdditionalFeature | null = null;
      if (feature === ('session_replay' as AdditionalFeature)) {
        additional = AdditionalFeature.SessionReplay;
      } else if (feature === ('llm' as AdditionalFeature)) {
        additional = AdditionalFeature.LLM;
      } else if (feature === ('engagement' as AdditionalFeature)) {
        additional = AdditionalFeature.Engagement;
      }
      if (!additional) continue;
      this.enableFeature(additional, source);
    }
    this.$session.setKey('optInFeaturesComplete', true);
    this.emitChange();
  }

  /**
   * Set the additional feature currently being processed by the stop hook.
   * Used by the Run screen to render it as an in-progress task.
   */
  setCurrentFeature(feature: AdditionalFeature | null): void {
    this.$session.setKey('additionalFeatureCurrent', feature);
    this.emitChange();
  }

  /**
   * Mark a feature as completed by the stop hook (clears `current`).
   * Used by the Run screen to render it as a done task.
   */
  markFeatureComplete(feature: AdditionalFeature): void {
    if (!this.session.additionalFeatureCompleted.includes(feature)) {
      this.$session.setKey('additionalFeatureCompleted', [
        ...this.session.additionalFeatureCompleted,
        feature,
      ]);
    }
    if (this.session.additionalFeatureCurrent === feature) {
      this.$session.setKey('additionalFeatureCurrent', null);
    }
    this.emitChange();
  }

  /**
   * Enable an additional feature: enqueue it for the stop hook
   * and set any feature-specific session flags.
   * Respects Amplitude Experiment feature flags — if the corresponding
   * flag is off the feature is silently skipped.
   */
  enableFeature(
    feature: AdditionalFeature,
    source: 'picklist' | 'auto-tui' | 'auto-ci' | 'auto-agent' = 'picklist',
  ): void {
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
    if (feature === AdditionalFeature.SessionReplay) {
      this.$session.setKey('sessionReplayOptIn', true);
    }
    if (feature === AdditionalFeature.Engagement) {
      this.$session.setKey('engagementOptIn', true);
    }
    analytics.wizardCapture('feature enabled', { feature, source });
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
    analytics.wizardCapture('mcp complete', {
      'mcp outcome': outcome,
      'mcp installed clients': installedClients,
      ...sessionPropertiesCompact(this.session),
    });
    this.emitChange();
  }

  setSlackComplete(outcome: SlackOutcome = SlackOutcome.Skipped): void {
    this.$session.setKey('slackComplete', true);
    this.$session.setKey('slackOutcome', outcome);
    analytics.wizardCapture('slack complete', {
      'slack outcome': outcome,
      ...sessionPropertiesCompact(this.session),
    });
    this.emitChange();
  }

  setOutroData(data: OutroData): void {
    this.$session.setKey('outroData', data);
    analytics.wizardCapture('outro reached', { 'outro kind': data.kind });
    this.emitChange();
  }

  /**
   * One-shot signal that the OutroScreen has been dismissed by the user
   * (keypress on cancel/error, picker action on success). Used by
   * `wizardAbort` to wait for the Outro to render and be acknowledged
   * before calling `process.exit` — without this, the process exits
   * while Ink is still flushing the previous frame and the user never
   * sees the OutroScreen at all on error paths.
   *
   * Resolves at most once. Subsequent calls to `signalOutroDismissed`
   * are no-ops; subsequent awaiters get a fresh pending promise that
   * will resolve on the next dismissal (in practice there's only ever
   * one dismissal per process).
   */
  private _resolveOutroDismissed: (() => void) | null = null;
  private _outroDismissedPromise: Promise<void> | null = null;

  /** Returns a promise that resolves when the OutroScreen is dismissed. */
  outroDismissed(): Promise<void> {
    if (!this._outroDismissedPromise) {
      this._outroDismissedPromise = new Promise<void>((resolve) => {
        this._resolveOutroDismissed = resolve;
      });
    }
    return this._outroDismissedPromise;
  }

  /** Mark the outro as dismissed. Idempotent. */
  signalOutroDismissed(): void {
    if (this._resolveOutroDismissed) {
      this._resolveOutroDismissed();
      this._resolveOutroDismissed = null;
    } else if (!this._outroDismissedPromise) {
      // Dismissal arrived before anyone awaited it — pre-resolve so the
      // first awaiter gets a settled promise immediately.
      this._outroDismissedPromise = Promise.resolve();
    }
  }

  setFrameworkContext(key: string, value: unknown, autoDetected = false): void {
    const ctx = { ...this.$session.get().frameworkContext, [key]: value };
    this.$session.setKey('frameworkContext', ctx);
    if (!autoDetected) {
      // Only track user-answered keys so back-nav can distinguish them
      // from auto-detected entries. popLastFrameworkContextAnswer returns
      // false when no user answers remain, letting the router walk back
      // past Setup transparently.
      const order = this.$session.get().frameworkContextAnswerOrder;
      const next = order.filter((k) => k !== key).concat(key);
      this.$session.setKey('frameworkContextAnswerOrder', next);
    }
    this.emitChange();
  }

  /**
   * Pop the most recently-answered framework setup question from
   * `frameworkContext`. Used by SetupScreen and by back-navigation past
   * FeatureOptIn. Returns `true` if an answer was popped.
   */
  popLastFrameworkContextAnswer(): boolean {
    const session = this.$session.get();
    const order = session.frameworkContextAnswerOrder;
    if (order.length === 0) return false;
    const lastKey = order[order.length - 1];
    const { [lastKey]: _removed, ...rest } = session.frameworkContext;
    void _removed;
    this.$session.setKey('frameworkContext', rest);
    this.$session.setKey('frameworkContextAnswerOrder', order.slice(0, -1));
    // Setup is a pre-Run flow entry; if the user's stepping back into Setup
    // from a post-run state (e.g. via /restart or repeat-run paths) we must
    // not leave the router short-circuited past Run.
    this.clearPostRunStateForBackNav();
    this.emitChange();
    return true;
  }

  // ── Back-navigation reverts ────────────────────────────────────
  // Each helper here un-completes one flow entry. They're invoked via
  // FlowEntry.revert callbacks from flows.ts during goBack().

  /**
   * Clear post-Run state so a back-nav into pre-Run territory doesn't
   * leave the router short-circuited past the agent run / outro.
   *
   * Called by every reset helper that lands the user on a screen *before*
   * the Run entry. Without this, after a back-nav the router would see
   * `runPhase === Completed` and skip Run (and any post-run flow entries
   * with completed isComplete predicates), routing the user straight to
   * stale post-run state.
   *
   * `outroData` is also cleared because the OutroKind.Cancel branch in
   * router.resolve() jumps directly to Outro regardless of pipeline order.
   *
   * No-op when there's nothing to clear, so calling it is safe whether or
   * not the run actually started.
   */
  private clearPostRunStateForBackNav(): void {
    this.$session.setKey('runPhase', RunPhase.Idle);
    this.$session.setKey('runStartedAt', null);
    this.$session.setKey('outroData', null);
    this.$session.setKey('mcpComplete', false);
    this.$session.setKey('mcpOutcome', null);
    this.$session.setKey('mcpInstalledClients', []);
    this.$session.setKey('slackComplete', false);
    this.$session.setKey('slackOutcome', null);
    this.$session.setKey('dataIngestionConfirmed', false);
    this.$session.setKey('optInFeaturesComplete', false);
    this.$session.setKey('additionalFeatureQueue', []);
    this.$session.setKey('additionalFeatureCurrent', null);
    this.$session.setKey('additionalFeatureCompleted', []);
  }

  /**
   * Revert past the Auth step back to RegionSelect. Region affects the
   * OAuth host, so we drop pending tokens, the cached org list, and any
   * resolved credentials so the next pass actually re-authenticates.
   */
  resetAuthForRegionChange(): void {
    this.$session.setKey('region', null);
    this.$session.setKey('regionForced', true);
    this.$session.setKey('credentials', null);
    this.$session.setKey('pendingAuthAccessToken', null);
    this.$session.setKey('pendingAuthIdToken', null);
    this.$session.setKey('pendingOrgs', null);
    this.$session.setKey('selectedOrgId', null);
    this.$session.setKey('selectedOrgName', null);
    this.$session.setKey('selectedProjectId', null);
    this.$session.setKey('selectedProjectName', null);
    this.$session.setKey('selectedAppId', null);
    this.$session.setKey('selectedEnvName', null);
    this.$session.setKey('projectHasData', null);
    this.clearPostRunStateForBackNav();
    analytics.wizardCapture('back navigation', { from: 'auth', to: 'region' });
    this.emitChange();
  }

  /**
   * Revert past the Auth step back into the org/workspace picker. Keeps
   * credentials so we don't force a fresh OAuth round-trip — only the
   * picked identity is cleared.
   */
  clearOrgAndProjectSelection(): void {
    this.$session.setKey('selectedOrgId', null);
    this.$session.setKey('selectedOrgName', null);
    this.$session.setKey('selectedProjectId', null);
    this.$session.setKey('selectedProjectName', null);
    this.$session.setKey('selectedAppId', null);
    this.$session.setKey('selectedEnvName', null);
    this.$session.setKey('projectHasData', null);
    this.clearPostRunStateForBackNav();
    analytics.wizardCapture('back navigation', {
      from: 'data-setup',
      to: 'auth',
    });
    this.emitChange();
  }

  /** Re-run the activation check on the next visit to DataSetup. */
  resetActivationCheck(): void {
    this.$session.setKey('projectHasData', null);
    this.$session.setKey('activationLevel', 'none');
    this.$session.setKey('activationOptionsComplete', false);
    this.clearPostRunStateForBackNav();
    analytics.wizardCapture('back navigation', { to: 'data-setup' });
    this.emitChange();
  }

  /** Re-show the activation-options picker. */
  resetActivationOptions(): void {
    this.$session.setKey('activationOptionsComplete', false);
    this.clearPostRunStateForBackNav();
    analytics.wizardCapture('back navigation', { to: 'activation-options' });
    this.emitChange();
  }

  /** Re-show the feature opt-in picklist. */
  resetFeatureOptIn(): void {
    // Note: clearPostRunStateForBackNav also clears optInFeaturesComplete,
    // but we keep the explicit set above for clarity since this method's
    // primary purpose is reverting that flag.
    this.$session.setKey('optInFeaturesComplete', false);
    this.clearPostRunStateForBackNav();
    analytics.wizardCapture('back navigation', { to: 'feature-opt-in' });
    this.emitChange();
  }

  /** Re-show the MCP install picker. */
  resetMcp(): void {
    this.$session.setKey('mcpComplete', false);
    this.$session.setKey('mcpOutcome', null);
    this.$session.setKey('mcpInstalledClients', []);
    analytics.wizardCapture('back navigation', { to: 'mcp' });
    this.emitChange();
  }

  /** Re-enter the wait-for-events screen. */
  resetDataIngestion(): void {
    this.$session.setKey('dataIngestionConfirmed', false);
    analytics.wizardCapture('back navigation', { to: 'data-ingestion' });
    this.emitChange();
  }

  /** Re-show the Slack setup prompt. */
  resetSlack(): void {
    this.$session.setKey('slackComplete', false);
    this.$session.setKey('slackOutcome', null);
    analytics.wizardCapture('back navigation', { to: 'slack' });
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

  /** Whether the user can step back from the current screen. */
  canGoBack(): boolean {
    return this.router.canGoBack(this.session);
  }

  /**
   * Step back to the previous decision. Returns true if a revert fired.
   * No-ops (returns false) when the active screen is a back-stop, has no
   * prior revertible step, or an overlay is currently active.
   */
  goBack(): boolean {
    // Suppress direction/transition in emitChange during reverts so the
    // single _detectTransition below fires with the correct 'pop' direction.
    this._reverting = true;
    const ok = this.router.goBack(this.session, this);
    this._reverting = false;
    if (!ok) return false;
    // router already flipped direction to 'pop'. Bump version + run the
    // transition hooks so React + analytics observe the move.
    this.$version.set(this.$version.get() + 1);
    this._detectTransition();
    return true;
  }

  /** True while a revert callback is executing inside goBack(). */
  private _reverting = false;

  // ── Change notification ─────────────────────────────────────────

  getVersion(): number {
    return this.$version.get();
  }

  /**
   * Notify React that state has changed.
   * The router re-resolves the active screen on next render.
   */
  emitChange(): void {
    if (!this._reverting) {
      this.router._setDirection('push');
    }
    this.$version.set(this.$version.get() + 1);
    if (!this._reverting) {
      this._detectTransition();
    }
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
      analytics.wizardCapture('wizard screen entered', {
        'screen name': next,
        'previous screen': prev,
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
    // Index the previous task list by label so we can preserve
    // already-completed work across re-plans. Common scenario: an SDK
    // retry (HTTP 400 / 429) causes the agent to re-emit its TodoWrite
    // with stale state — tasks that were already ✓ get demoted back to
    // ◐ or ○. The user sees their progress visibly un-check. We force
    // monotonic progress: once a task with a given label is completed,
    // it stays completed even if a later TodoWrite says otherwise.
    const previousByLabel = new Map(this.$tasks.get().map((t) => [t.label, t]));

    const incoming = todos.map((t) => {
      const prev = previousByLabel.get(t.content);
      let status = (t.status as TaskStatus) || TaskStatus.Pending;
      let done = status === TaskStatus.Completed;
      if (prev?.done && !done) {
        status = TaskStatus.Completed;
        done = true;
      }
      return {
        label: t.content,
        activeForm: t.activeForm,
        status,
        done,
      };
    });

    // Trust the agent's TodoWrite list as authoritative for *which* tasks
    // exist. We previously retained "orphaned" completed tasks (done but
    // missing from the new list) on the theory that Claude Code might
    // compact away history — in practice the agent keeps completed items
    // and *renames* in-progress ones, and the retention logic surfaced
    // zombie labels like "Set up env" alongside its renamed successor
    // "Set up env and install SDK". Trusting the incoming list eliminates
    // the duplicate; the monotonic guard above protects against the
    // retry-induced regression case.
    this.$tasks.set(incoming);
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
