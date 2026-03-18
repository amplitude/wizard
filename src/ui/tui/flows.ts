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

import { type WizardSession, RunPhase } from '../../lib/wizard-session.js';

// ── Screen + Flow enums ──────────────────────────────────────────────

/** Screens that participate in linear flows */
export enum Screen {
  Intro = 'intro',
  Setup = 'setup',
  Auth = 'auth',
  RegionSelect = 'region-select',
  DataSetup = 'data-setup',
  Options = 'options',
  ActivationOptions = 'activation-options',
  Run = 'run',
  Mcp = 'mcp',
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
    // 3. Authenticate (SUSI for new users, silent login check for returning users)
    {
      screen: Screen.Auth,
      isComplete: (s) => s.credentials !== null,
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
    // 3b. Options menu (when project already has significant data)
    {
      screen: Screen.Options,
      show: (s) => s.projectHasData === true,
      isComplete: (_s) => false, // terminal: user picks an action from here
    },
    // 4. Framework setup questions (if any unresolved)
    {
      screen: Screen.Setup,
      show: needsSetup,
      isComplete: (s) => !needsSetup(s),
    },
    // 5. Agent run
    {
      screen: Screen.Run,
      isComplete: (s) =>
        s.runPhase === RunPhase.Completed || s.runPhase === RunPhase.Error,
    },
    // 6. MCP server setup (skipped on error)
    {
      screen: Screen.Mcp,
      show: (s) => s.runPhase !== RunPhase.Error,
      isComplete: (s) => s.mcpComplete,
    },
    // 7. Slack integration setup (skipped on error)
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
};
