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

import {
  type WizardSession,
  isCreateAccountOnboarding,
} from '../../lib/wizard-session.js';
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
  SignupEmail = 'signup-email',
  SigningUp = 'signing-up',
  SignupFullName = 'signup-full-name',
  ToS = 'tos',
  DataSetup = 'data-setup',
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
  /**
   * State-driven hard wall. When true on a completed entry, back-nav
   * past this entry is blocked outright (`canGoBack` / `goBack` return
   * `false`). Checked BEFORE `revert` so a wall takes precedence over
   * a defined revert callback.
   *
   * Use for committed states the user cannot honestly undo — e.g. a
   * server account created during signup. Distinct from "no `revert`
   * defined" (a flow-definition-time wall): `isWall` is a runtime
   * decision based on session state, so the same entry can revert
   * normally in one state and be a hard wall in another.
   *
   * Today the only `isWall` user is the signup-ceremony entries, gated
   * on `signupCommittedWall` (BA-114). The browser-OAuth callback case
   * is tracked separately as BA-122.
   */
  isWall?: (session: WizardSession) => boolean;
}

/**
 * State-driven wall for the signup-ceremony entries.
 *
 * Once the user has committed to direct signup — either the POST is
 * mid-flight or it landed successfully — back-nav out of the ceremony
 * is a no-op trapdoor: the server-side account exists (success) or
 * could land any moment (in-flight) on a session that's been wiped.
 *
 * `signupAuth !== null` covers the "direct-signup success" case. The
 * `requires_redirect` arm (browser-OAuth fallback) is intentionally NOT
 * covered here — tracked separately as BA-122.
 *
 * `signupInFlight` covers the in-flight POST window, written
 * exclusively by `WizardStore.runSignupAttempt`'s try/finally.
 *
 * Scope: this wall applies to **back-nav only** (Esc / `goBack`). Slash
 * commands that funnel through `_resetCeremonyKeys` (e.g. `/region` →
 * `setRegionForced`, `switchToLogin`) are out of scope by design — they
 * represent explicit user intent ("I picked the wrong region; restart
 * from there") that should not be silently blocked while a brief POST
 * is in flight. If a slash command fires mid-POST, the ceremony state
 * is wiped atomically alongside `signupInFlight` and the response is
 * dropped on the floor — same outcome as user `/exit` mid-POST.
 */
function signupCommittedWall(s: WizardSession): boolean {
  return s.signupAuth !== null || s.signupInFlight;
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
      revert: (store) => {
        store.rewindIntro();
      },
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
    // 2a. Signup email — create-account path, first step. Always renders
    //     when the session has no email yet (initial entry, or after a
    //     back-nav from a collection screen cleared it).
    {
      screen: Screen.SignupEmail,
      show: (s) => isCreateAccountOnboarding(s) && s.signupEmail === null,
      isComplete: (s) =>
        !isCreateAccountOnboarding(s) || s.signupEmail !== null,
      revert: (store) => {
        if (!isCreateAccountOnboarding(store.session)) return false;
        store.setSignupEmail(null);
      },
      isWall: signupCommittedWall,
    },
    // 2b. Signing up — POSTs the agentic provisioning request and writes
    //     the response into session state. Show predicate gates on email
    //     present + ceremony unsettled + all required-fields satisfied
    //     (covers both the initial probe POST and the retry-after-collection
    //     POST). isComplete fires when signupAuth or signupAbandoned is set.
    //
    //     `revert` returns false on the sign-in path so the entry is
    //     transparent to back-nav — a sign-in user reaching Auth must be
    //     able to back-walk to RegionSelect / Intro without hitting a
    //     create-account-only wall. On the create-account path with the
    //     ceremony in flight, returning false keeps the wall semantics
    //     (no clean undo: a successful signup created a server account;
    //     an abandon already routed to OAuth).
    {
      screen: Screen.SigningUp,
      show: (s) =>
        isCreateAccountOnboarding(s) &&
        s.signupEmail !== null &&
        s.signupAuth === null &&
        !s.signupAbandoned &&
        // No required fields known yet, OR all known required fields are
        // filled. SigningUp re-shows after collection screens write back.
        (s.signupRequiredFields === null ||
          s.signupRequiredFields.every((field) =>
            field === 'full_name' ? s.signupFullName !== null : true,
          )) &&
        // ToS must be accepted before the second POST creates the account.
        // On the initial probe (`signupRequiredFields === null`) ToS is not
        // required yet — the server might redirect or error and we never
        // touch ToS at all.
        (s.signupRequiredFields === null || s.tosAccepted === true),
      isComplete: (s) =>
        !isCreateAccountOnboarding(s) ||
        s.signupAuth !== null ||
        s.signupAbandoned,
      // SigningUp has no in-band "undo": the in-flight POST to the
      // provisioning endpoint may have already created (or abandoned)
      // the account on the server. Returning false makes back-nav walk
      // past this entry transparently — back-nav lands on the screen
      // *before* SigningUp (typically SignupFullName or SignupEmail),
      // and clearing those inputs via their own revert handlers is what
      // resets the ceremony so the next forward pass fires a fresh
      // probe.
      revert: () => false,
      isWall: signupCommittedWall,
    },
    // 2c. Terms of Service — only renders AFTER the server confirmed
    //     agentic signup is happening (signupRequiredFields was set).
    //     Skipped entirely on the redirect / error / immediate-success
    //     arms — exactly the "don't ask for ToS unless we're going to
    //     create the account" behavior PR 234 motivated.
    {
      screen: Screen.ToS,
      show: (s) =>
        isCreateAccountOnboarding(s) &&
        s.signupRequiredFields !== null &&
        s.tosAccepted !== true,
      isComplete: (s) =>
        !isCreateAccountOnboarding(s) ||
        s.signupRequiredFields === null ||
        s.tosAccepted === true,
      // Returning false when the screen was *skipped* (server never asked,
      // or ToS was never accepted) is critical: `isComplete` returns true
      // via the "screen was skipped" arm too, and a blind `resetToS` would
      // be a no-op that nonetheless stops the back-nav walk — leaving the
      // user on Auth pressing Esc with nothing visibly happening.
      revert: (store) => {
        if (!isCreateAccountOnboarding(store.session)) return false;
        if (store.session.signupRequiredFields === null) return false;
        if (store.session.tosAccepted === null) return false;
        // Walk past on abandonment: clearing tosAccepted alone leaves
        // signupAbandoned=true, which still gates SigningUp.show off.
        // The user would re-accept ToS and land back on Auth without
        // any retry — a dead-end. Letting back-nav continue to
        // SignupEmail.revert clears the whole ceremony via
        // _resetCeremonyKeys (which resets signupAbandoned), giving
        // the user a clean restart.
        if (store.session.signupAbandoned) return false;
        store.resetToS();
      },
      isWall: signupCommittedWall,
    },
    // 2d. Signup full name — renders only when the server included
    //     'full_name' in `required` AND the session doesn't already have
    //     a name (e.g. from `--full-name`).
    {
      screen: Screen.SignupFullName,
      show: (s) =>
        isCreateAccountOnboarding(s) &&
        s.signupRequiredFields !== null &&
        s.signupRequiredFields.includes('full_name') &&
        s.signupFullName === null,
      isComplete: (s) =>
        !isCreateAccountOnboarding(s) ||
        s.signupRequiredFields === null ||
        !s.signupRequiredFields.includes('full_name') ||
        s.signupFullName !== null,
      // Same reasoning as ToS above: `isComplete` returns true via "I was
      // skipped" arms (no needs_information, server didn't ask for
      // full_name, or signupFullName never set). Calling
      // `setSignupFullName(null)` in those cases is a no-op that traps
      // back-nav. Return false so the walk continues to entries that can
      // actually do something.
      revert: (store) => {
        if (!isCreateAccountOnboarding(store.session)) return false;
        if (store.session.signupRequiredFields === null) return false;
        if (!store.session.signupRequiredFields.includes('full_name'))
          return false;
        if (store.session.signupFullName === null) return false;
        // Walk past on abandonment: clearing signupFullName alone
        // leaves signupAbandoned=true, so the next forward pass
        // skips SigningUp (its show predicate gates on
        // !signupAbandoned) and lands the user back on Auth without
        // re-firing the POST. Continue back-walking to SignupEmail's
        // revert, which clears the whole ceremony via
        // _resetCeremonyKeys (resetting signupAbandoned too).
        if (store.session.signupAbandoned) return false;
        store.setSignupFullName(null);
      },
      isWall: signupCommittedWall,
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
