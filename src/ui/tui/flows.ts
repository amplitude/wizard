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
import { RunPhase } from './session-constants.js';

// ── Signup required-field helpers ────────────────────────────────────

/**
 * The set of `needs_information` field names the wizard knows how to
 * collect locally. Fields outside this set cause the signup flow to
 * abandon to browser OAuth — we can't prompt for something we don't
 * have a screen for.
 */
export const KNOWN_REQUIRED_FIELDS: ReadonlySet<string> = new Set([
  'full_name',
]);

/**
 * Returns true when the session already carries a value for `field`.
 * Used by SigningUpScreen to detect the "server asked for a field we
 * already sent" case — indicates the server rejected our value, so we
 * bail to browser OAuth instead of re-prompting in a loop.
 */
export function fieldPresentOnSession(
  s: { signupFullName: string | null },
  field: string,
): boolean {
  if (!KNOWN_REQUIRED_FIELDS.has(field)) return false;
  switch (field) {
    case 'full_name':
      return s.signupFullName !== null;
    default:
      return false;
  }
}

/**
 * Returns true when the session carries a value for every field the
 * server has (so far) asked for via `needs_information`. Gates the
 * SigningUpScreen POST — we only retry once all outstanding fields
 * have been collected.
 */
export function allRequiredFieldsCollected(s: {
  signupRequiredFields: string[];
  signupFullName: string | null;
}): boolean {
  return s.signupRequiredFields.every((field) =>
    fieldPresentOnSession(s, field),
  );
}

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
    //    Skipped for returning users (region pre-populated from ~/.ampli.json).
    //    Re-shown when /region slash command sets regionForced.
    {
      screen: Screen.RegionSelect,
      show: (s) => s.region === null || s.regionForced,
      isComplete: (s) => s.region !== null && !s.regionForced,
    },
    // 2b. Email collection for direct signup. Shown only when --signup is set
    //     and --email was not passed.
    {
      screen: Screen.SignupEmail,
      show: (s) => s.signup && s.signupEmail === null,
      isComplete: (s) => !s.signup || s.signupEmail !== null,
    },
    // 2c. Signup POST firing point. Mounts whenever we have an email,
    //     a region (so we know which provisioning host to hit), no
    //     tokens yet, haven't abandoned, and every field the server has
    //     asked for so far is present on the session. The region check
    //     is redundant in normal flow ordering (RegionSelect's
    //     isComplete already gates this) but making it local lets
    //     SigningUpScreen rely on `s.region !== null` without chasing
    //     the invariant across files.
    {
      screen: Screen.SigningUp,
      show: (s) =>
        s.signup &&
        s.signupEmail !== null &&
        s.region !== null &&
        s.signupAuth === null &&
        !s.signupAbandoned &&
        allRequiredFieldsCollected(s),
      isComplete: (s) =>
        !s.signup ||
        s.signupAuth !== null ||
        s.signupAbandoned ||
        !allRequiredFieldsCollected(s),
    },
    // 2d. Full-name collection. Shown only when the server's last response
    //     listed 'full_name' as required AND we don't already have it.
    {
      screen: Screen.SignupFullName,
      show: (s) =>
        s.signup &&
        s.signupRequiredFields.includes('full_name') &&
        s.signupFullName === null,
      isComplete: (s) =>
        !s.signup ||
        !s.signupRequiredFields.includes('full_name') ||
        s.signupFullName !== null,
    },
    // 3. Authenticate (SUSI for new users, silent login check for returning users).
    //    Skipped on error so auth-failure runs route directly to Outro.
    //
    //    Auth is complete when we have credentials AND the org + workspace
    //    (what users call the "project") are resolved. Env name is bonus —
    //    it can't always be determined (e.g., manual API key entry), and the
    //    header renders 2 or 3 segments gracefully depending on what's known.
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
        (s.selectedWorkspaceName !== null || s.selectedWorkspaceId !== null),
    },
    // 3b. Create-project interrupt. Shown when the user picks "Create new
    //     project…" from the Auth picker or runs /create-project. Sits
    //     between Auth and the data check so success routes directly to
    //     framework detection after `setCredentials()` fires.
    {
      screen: Screen.CreateProject,
      show: (s) => s.runPhase !== RunPhase.Error && s.createProject.pending,
      isComplete: (s) => !s.createProject.pending,
    },
    // 4. Data check — is the project already ingesting events?
    {
      screen: Screen.DataSetup,
      isComplete: (s) => s.projectHasData !== null,
    },
    // 3a. Activation options (SDK installed but few events — partial activation)
    {
      screen: Screen.ActivationOptions,
      show: (s) => s.activationLevel === 'partial',
      isComplete: (s) => s.activationOptionsComplete,
    },
    // 3b. Framework setup questions — skipped for full users (already have data)
    {
      screen: Screen.Setup,
      show: (s) => needsSetup(s) && s.activationLevel !== 'full',
      isComplete: (s) => !needsSetup(s),
    },
    // 3c. Agent run — skipped for full users (already instrumented)
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
    },
    // 5. Wait for events — polls activation API until events are flowing.
    //    Passes immediately for full users (already have data).
    //    Skipped on error.
    {
      screen: Screen.DataIngestionCheck,
      show: (s) =>
        s.runPhase !== RunPhase.Error && s.activationLevel !== 'full',
      isComplete: (s) => s.dataIngestionConfirmed,
    },
    // 6. Slack integration setup (skipped on error)
    {
      screen: Screen.Slack,
      show: (s) => s.runPhase !== RunPhase.Error,
      isComplete: (s) => s.slackComplete,
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
