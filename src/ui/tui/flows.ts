/**
 * Flow pipelines — declarative screen sequences for each wizard flow.
 *
 * Owns the Screen and Flow enums (re-exported by router.ts) to avoid
 * circular imports between router ↔ flows.
 *
 * Each entry defines a screen, optional visibility predicate, and
 * optional completion predicate. The router walks the active flow
 * to resolve which screen to show.
 */

import type { WizardSession } from '../../lib/wizard-session.js';
// WizardStore is used by the FlowEntry.revert callback signature below
// (PR 301 — Esc-based back navigation).
import type { WizardStore } from './store.js';
import { RunPhase } from './session-constants.js';
import { tryResolveZone } from '../../lib/zone-resolution.js';

// ── Screen + Flow enums ──────────────────────────────────────────────

/** Screens that participate in linear flows */
export enum Screen {
  Intro = 'intro',
  Setup = 'setup',
  Auth = 'auth',
  CreateProject = 'create-project',
  RegionSelect = 'region-select',
  EmailCapture = 'email-capture',
  ToS = 'tos',
  DataSetup = 'data-setup',
  Options = 'options',
  ActivationOptions = 'activation-options',
  Run = 'run',
  Mcp = 'mcp',
  DataIngestionCheck = 'data-ingestion-check',
  Slack = 'slack',
  Outro = 'outro',
  McpAdd = 'mcp-add',
  McpRemove = 'mcp-remove',
  SlackSetup = 'slack-setup',
}

/** Named flows the router can run */
export enum Flow {
  Wizard = 'wizard',
  McpAdd = 'mcp-add',
  McpRemove = 'mcp-remove',
  SlackSetup = 'slack-setup',
  RegionSelect = 'region-select',
}

// ── Flow definitions ─────────────────────────────────────────────────

export interface FlowEntry {
  /** Screen to show */
  screen: Screen;
  /** If provided, screen is skipped when this returns false. Omit = always show. */
  show?: (session: WizardSession) => boolean;
  /** If provided, screen is considered complete when this returns true. */
  isComplete?: (session: WizardSession) => boolean;
  /**
   * Back-navigation: undoes whatever made `isComplete` true so the router
   * resolves back to this screen on the next render. Entries without a
   * `revert` act as a wall — back-navigation is blocked past them
   * (e.g. agent Run, which would be destructive to undo).
   *
   * Return `false` when the revert was a no-op (nothing meaningful to undo);
   * the router will keep walking further back. `void` / `true` count as a
   * successful revert.
   */
  revert?: (store: WizardStore) => boolean | void;
}

/**
 * Check if the SetupScreen is needed (unresolved framework questions).
 */
function needsSetup(session: WizardSession): boolean {
  const config = session.frameworkConfig;
  if (!config?.metadata.setup?.questions) return false;

  return config.metadata.setup.questions.some(
    (q: { key: string }) => !(q.key in session.frameworkContext),
  );
}

/** All flow pipelines. Add new screens by appending entries. */
export const FLOWS: Record<Flow, FlowEntry[]> = {
  [Flow.Wizard]: [
    // 1. Welcome + framework detection — always shown first so the user
    //    confirms before the wizard proceeds to region select and auth.
    {
      screen: Screen.Intro,
      isComplete: (s) => s.introConcluded,
    },
    // 2. Region selection — must know US vs EU before opening OAuth URL.
    //    Skipped for returning users (zone resolvable from ampli.json or
    //    stored user). `session.region` represents this-run user intent and
    //    is intentionally NOT populated from disk by resolveCredentials —
    //    so we use `tryResolveZone` here to consult Tier 2/3 (ampli.json
    //    Zone, stored user zone) and skip the picker when a returning user
    //    already has a zone on disk.
    //    Re-shown when /region slash command sets regionForced.
    {
      screen: Screen.RegionSelect,
      show: (s) => tryResolveZone(s) === null || s.regionForced,
      isComplete: (s) => tryResolveZone(s) !== null && !s.regionForced,
      // Back from Auth — re-show the region picker. Region affects OAuth
      // host, so we also have to drop pending tokens / org list / credentials
      // so the next pass actually re-authenticates against the new region.
      revert: (store) => {
        store.resetAuthForRegionChange();
      },
    },
    // 2a. Email capture — shown only during --signup flow before ToS.
    {
      screen: Screen.EmailCapture,
      show: (s) => s.accountCreationFlow && !s.emailCaptureComplete,
      isComplete: (s) => !s.accountCreationFlow || s.emailCaptureComplete,
      revert: (store) => {
        // No-op when signup is false (screen was never shown)
        if (!store.session.accountCreationFlow) return false;
        store.resetEmailCapture();
      },
    },
    // 2b. Terms of Service — shown only during --signup flow after email capture.
    {
      screen: Screen.ToS,
      show: (s) =>
        s.accountCreationFlow &&
        s.emailCaptureComplete &&
        s.tosAccepted !== true,
      isComplete: (s) => !s.accountCreationFlow || s.tosAccepted === true,
      revert: (store) => {
        // No-op when signup is false (screen was never shown)
        if (!store.session.accountCreationFlow) return false;
        store.resetToS();
      },
    },
    // 3. Authenticate (SUSI for new users, silent login check for returning users).
    //    Skipped on error so auth-failure runs route directly to Outro.
    //
    //    Auth is complete when we have credentials AND the org + project are
    //    resolved. Env name is bonus — it can't always be determined (e.g.,
    //    manual API key entry), and the header renders 2 or 3 segments
    //    gracefully depending on what's known.
    //
    //    IDs count as a resolved identity too. If ampli.json has OrgId /
    //    WorkspaceId but fetchAmplitudeUser fails to hydrate the names (e.g.,
    //    transient network error), we'd otherwise deadlock on the Auth
    //    spinner. Accepting IDs as an alternative degrades header text but
    //    lets the flow continue.
    //
    //    Skipped while the user is in the inline create-project flow.
    {
      screen: Screen.Auth,
      show: (s) => s.runPhase !== RunPhase.Error && !s.createProject.pending,
      isComplete: (s) =>
        s.credentials !== null &&
        (s.selectedOrgName !== null || s.selectedOrgId !== null) &&
        (s.selectedProjectName !== null || s.selectedProjectId !== null) &&
        // Returning-user account confirmation. Blocks the gate until the
        // user explicitly confirms (or changes) the org/project that was
        // resolved silently from disk. Set in bin.ts when resolveCredentials
        // populates the session without going through the SUSI picker.
        !s.requiresAccountConfirmation,
      // Back from DataSetup — drop the picked org/project/env so the
      // Auth screen re-renders the picker. Credentials stay so we don't
      // force a fresh OAuth round-trip.
      revert: (store) => {
        store.clearOrgAndProjectSelection();
      },
    },
    // 3b. Create-project interrupt. Shown when the user picks "Create new
    //     project…" from the Auth picker or runs /create-project. Sits
    //     between Auth and the data check so success routes directly to
    //     framework detection after `setCredentials()` fires.
    {
      screen: Screen.CreateProject,
      show: (s) => s.runPhase !== RunPhase.Error && s.createProject.pending,
      isComplete: (s) => !s.createProject.pending,
      // CreateProject is always "complete" for users who never entered it
      // (`!pending` is true by default), so we mark it transparent for
      // back-nav: revert returns false and the router walks past to the
      // previous *meaningful* step (Auth). Re-entering the creation form
      // mid-back is never useful — the user just wants to go further back.
      revert: () => false,
    },
    // 4. Data check — is the project already ingesting events?
    {
      screen: Screen.DataSetup,
      isComplete: (s) => s.projectHasData !== null,
      // Reset the activation result so the check re-runs after a back-nav.
      revert: (store) => {
        store.resetActivationCheck();
      },
    },
    // 3a. Activation options (SDK installed but few events — partial activation)
    {
      screen: Screen.ActivationOptions,
      show: (s) => s.activationLevel === 'partial',
      isComplete: (s) => s.activationOptionsComplete,
      revert: (store) => {
        store.resetActivationOptions();
      },
    },
    // 3b. Framework setup questions — skipped for full users (already have data)
    {
      screen: Screen.Setup,
      show: (s) => needsSetup(s) && s.activationLevel !== 'full',
      isComplete: (s) => !needsSetup(s),
      // Pop the most recently-answered framework question. Returns false
      // when there's nothing user-answered to pop (e.g. every question was
      // auto-detected) so the router keeps walking back.
      revert: (store) => store.popLastFrameworkContextAnswer(),
    },
    // (PR 313 removed the FeatureOptIn screen — SR + G&S + autocapture
    //  are auto-enabled inline now, so there's no longer a separate
    //  picklist to back-navigate through here.)
    // 3c. Agent run — skipped for full users (already instrumented)
    //
    //  (No FeatureOptIn step here: SR + G&S + autocapture are
    //   auto-enabled inline as part of the unified SDK init. Users tune
    //   individual features by commenting out lines in their generated
    //   init code rather than via a wizard prompt.)
    {
      screen: Screen.Run,
      show: (s) => s.activationLevel !== 'full',
      isComplete: (s) =>
        s.runPhase === RunPhase.Completed || s.runPhase === RunPhase.Error,
    },
    // 4. MCP server setup — skipped on error; full users go straight here
    {
      screen: Screen.Mcp,
      show: (s) => s.runPhase !== RunPhase.Error,
      isComplete: (s) => s.mcpComplete,
      revert: (store) => {
        store.resetMcp();
      },
    },
    // 5. Wait for events — polls activation API until events are flowing.
    //    Passes immediately for full users (already have data) UNLESS
    //    `localInstrumentationComplete` is set (meaning the wizard
    //    pre-flighted to 'full' purely from on-disk signals — the
    //    remote project may not have any events yet, and the user
    //    expects to land here to verify their re-deploy is flowing).
    //    Skipped on error.
    {
      screen: Screen.DataIngestionCheck,
      show: (s) =>
        s.runPhase !== RunPhase.Error &&
        (s.activationLevel !== 'full' || s.localInstrumentationComplete),
      isComplete: (s) => s.dataIngestionConfirmed,
      revert: (store) => {
        store.resetDataIngestion();
      },
    },
    // 6. Slack integration setup (skipped on error)
    {
      screen: Screen.Slack,
      show: (s) => s.runPhase !== RunPhase.Error,
      isComplete: (s) => s.slackComplete,
      revert: (store) => {
        store.resetSlack();
      },
    },
    { screen: Screen.Outro },
  ],

  [Flow.McpAdd]: [
    {
      screen: Screen.McpAdd,
      isComplete: (s) => s.mcpComplete,
    },
    { screen: Screen.Outro },
  ],

  [Flow.McpRemove]: [
    {
      screen: Screen.McpRemove,
      isComplete: (s) => s.mcpComplete,
    },
    { screen: Screen.Outro },
  ],

  [Flow.SlackSetup]: [
    {
      screen: Screen.SlackSetup,
      isComplete: (s) => s.slackComplete,
    },
    { screen: Screen.Outro },
  ],

  [Flow.RegionSelect]: [
    {
      screen: Screen.RegionSelect,
      isComplete: (s) => s.region !== null && !s.regionForced,
    },
  ],
};
