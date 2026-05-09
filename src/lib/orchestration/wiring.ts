/**
 * wiring.ts — centralized helpers for mirroring user-choice and
 * manual-verification surfaces into the orchestration store.
 *
 * Part of v2 PR 4. PRs 2 and 3 introduced the `Choice` and `Verification`
 * primitives plus two beachhead wirings (env-selection, event-plan
 * approval, AUTH_ERROR resilience). PR 4 widens those primitives to
 * every major user-choice and manual-verification surface in the wizard:
 * MCP/Slack install prompts, the keep-or-revert files outro, dashboard
 * setup, OAuth browser login, region selection, and so on.
 *
 * **Design rules**
 *
 *   - Wirings are ADDITIVE — the existing TUI prompts, agent prompts,
 *     and screens still drive the user-facing flow. Each wiring writes
 *     a parallel signal into the orchestration store so outer agents
 *     inspecting `wizard status --json` see a typed record.
 *   - Mirror failures MUST NOT break the user-facing flow. Every helper
 *     swallows its own errors and logs to file.
 *   - `promptId` is deterministic per surface — re-entering the same
 *     prompt on a re-run finds the existing pending Choice via
 *     `findPendingChoice` and does not double-prompt.
 *   - Every helper is invoked from a callsite that already knows it's
 *     about to surface a prompt or just received the user's answer.
 *     The helper does not itself prompt.
 *
 * **Shape**
 *
 * Each callsite gets a `record*` helper that returns the recorded id
 * (string) on success and `null` on failure (or when the callsite
 * doesn't have an active orchestration session yet — common during
 * very early bootstrap, before `createSession` has fired). Callers
 * pair `record*Choice` with `answer*Choice` once the user picks.
 *
 * Tests live in `src/lib/orchestration/__tests__/wiring.test.ts`.
 */
import { logToFile } from '../../utils/debug';
import { getOrchestrationStore } from './store';
import type { Choice, ChoiceId, ChoiceKind } from './checkpoints/choices';
import { asChoiceId } from './checkpoints/choices';
import type { VerificationKind } from './checkpoints/verifications';

/**
 * Default resume command stamped on every wired record. Tests override
 * via the `resumeCommand` arg on the underlying store call.
 */
function defaultResume(installDir: string): string[] {
  return ['npx', '@amplitude/wizard', '--install-dir', installDir];
}

/**
 * Internal — wrap a store-mutating operation with a try/catch + log.
 * Returns the value on success, `null` on failure or no-active-session.
 */
function withMirror<T>(
  installDir: string,
  surface: string,
  fn: (store: ReturnType<typeof getOrchestrationStore>, sessionId: string) => T,
): T | null {
  try {
    const store = getOrchestrationStore(installDir);
    const sess = store.currentSession();
    if (!sess) return null;
    return fn(store, sess.id);
  } catch (err) {
    logToFile(
      `[orchestration] ${surface} mirror failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

// ── Choice surfaces ────────────────────────────────────────────────────

export interface AppConfirmationOptions {
  installDir: string;
  orgName: string;
  projectName: string;
  envName: string;
  appId: string | number;
}

/**
 * `--confirm-app` (or AMPLITUDE_WIZARD_CONFIRM_APP=1) — the wizard
 * detected stored credentials but is forcing an explicit
 * "is this the right project?" confirmation before continuing.
 *
 * This is also the surface a TUI Auth screen renders when
 * `requiresAccountConfirmation` is true.
 */
export function recordAppConfirmationChoice(
  opts: AppConfirmationOptions,
): ChoiceId | null {
  const { installDir, orgName, projectName, envName, appId } = opts;
  return withMirror(installDir, 'app_confirmation', (store, sessionId) => {
    const promptId = `app_confirmation:${appId}`;
    const existing = store.findPendingChoice(promptId);
    if (existing) return asChoiceId(existing.id);
    const created = store.addChoice({
      kind: 'other',
      promptId,
      message: `Continue with ${orgName} / ${projectName} / ${envName}?`,
      options: [
        {
          id: 'continue',
          label: `Continue with ${orgName} / ${projectName} / ${envName}`,
          description: 'Use the stored credentials and selected project.',
          isRecommended: true,
        },
        {
          id: 'switch',
          label: 'Pick a different project',
          description: 'Re-open the project picker to choose another env.',
        },
      ],
      recommendedOptionId: 'continue',
      safeDefaultOptionId: 'continue',
      requiresHuman: true,
      automationAllowed: false,
      timeoutBehavior: null,
      consequenceIfSkipped:
        'Default = continue. The wizard will write events to the stored project.',
      reversible: true,
      whyAsking:
        '--confirm-app is set: the wizard refuses to silently route to a stored project ' +
        'without an explicit human confirmation.',
      resumeCommand: defaultResume(installDir),
      linkedSessionId: sessionId as `session_${string}`,
    });
    return asChoiceId(created.id);
  });
}

export interface McpInstallPromptOptions {
  installDir: string;
  /** Which client the prompt is for (e.g. "Claude Code", "Cursor", "Codex"). */
  client: string;
  /** How many editor clients were detected — drives "skip" framing. */
  detectedCount: number;
}

/**
 * MCP-server install prompt — recorded once per detected client per
 * session. Outer agents see "user is being asked to install Claude
 * Code MCP" with full context.
 */
export function recordMcpInstallChoice(
  opts: McpInstallPromptOptions,
): ChoiceId | null {
  const { installDir, client, detectedCount } = opts;
  return withMirror(installDir, 'mcp_install', (store, sessionId) => {
    const promptId = `mcp_install:${client.toLowerCase().replace(/\s+/g, '_')}`;
    const existing = store.findPendingChoice(promptId);
    if (existing) return asChoiceId(existing.id);
    const created = store.addChoice({
      kind: 'mcp_install',
      promptId,
      message: `Install the Amplitude MCP server into ${client}?`,
      options: [
        {
          id: 'install',
          label: `Install in ${client}`,
          description:
            'Wires the Amplitude MCP into your AI tool so you can chat with your data.',
          isRecommended: true,
        },
        {
          id: 'skip',
          label: 'Skip MCP install',
          description: 'Keeps your editor unchanged.',
          isSafestSkip: true,
        },
      ],
      recommendedOptionId: 'install',
      safeDefaultOptionId: 'skip',
      requiresHuman: true,
      automationAllowed: false,
      timeoutBehavior: null,
      consequenceIfSkipped:
        'Skipping is safe. The wizard finishes the integration; you can install MCP later via `/mcp`.',
      reversible: true,
      whyAsking: `${detectedCount} compatible AI tool(s) detected on this machine.`,
      resumeCommand: defaultResume(installDir),
      linkedSessionId: sessionId as `session_${string}`,
    });
    return asChoiceId(created.id);
  });
}

export interface SlackSetupPromptOptions {
  installDir: string;
  /** EU vs US Slack app distinction — surfaces in the prompt label. */
  region: 'us' | 'eu';
}

export function recordSlackSetupChoice(
  opts: SlackSetupPromptOptions,
): ChoiceId | null {
  const { installDir, region } = opts;
  return withMirror(installDir, 'slack_setup', (store, sessionId) => {
    const promptId = `slack_setup:${region}`;
    const existing = store.findPendingChoice(promptId);
    if (existing) return asChoiceId(existing.id);
    const created = store.addChoice({
      kind: 'slack_setup',
      promptId,
      message:
        'Connect Slack so Amplitude can send alerts and notebook updates to your workspace?',
      options: [
        {
          id: 'connect',
          label: 'Open Amplitude Settings to connect Slack',
          description:
            'Opens your browser to the Amplitude Settings > Integrations page.',
          isRecommended: true,
        },
        {
          id: 'skip',
          label: 'Skip Slack setup',
          description: 'You can add Slack later from the Amplitude UI.',
          isSafestSkip: true,
        },
      ],
      recommendedOptionId: 'connect',
      safeDefaultOptionId: 'skip',
      requiresHuman: true,
      automationAllowed: false,
      timeoutBehavior: null,
      consequenceIfSkipped:
        'Skipping is safe. The wizard finishes; Slack can be wired up later.',
      reversible: true,
      whyAsking:
        region === 'eu'
          ? 'Connecting "Amplitude - EU" Slack app routes alerts through your EU workspace.'
          : 'Connecting Slack lets Amplitude push alerts and notebook updates without a context switch.',
      resumeCommand: [...defaultResume(installDir), '--slack'],
      linkedSessionId: sessionId as `session_${string}`,
    });
    return asChoiceId(created.id);
  });
}

export interface DashboardSetupPromptOptions {
  installDir: string;
  /** Whether the dashboard agent fired automatically or was manual. */
  trigger: 'auto' | 'manual';
}

export function recordDashboardSetupChoice(
  opts: DashboardSetupPromptOptions,
): ChoiceId | null {
  const { installDir, trigger } = opts;
  return withMirror(installDir, 'dashboard_setup', (store, sessionId) => {
    const promptId = `dashboard_setup:${trigger}`;
    const existing = store.findPendingChoice(promptId);
    if (existing) return asChoiceId(existing.id);
    const created = store.addChoice({
      kind: 'dashboard_setup',
      promptId,
      message:
        'Create your first dashboard from the events the wizard just instrumented?',
      options: [
        {
          id: 'create',
          label: 'Create a starter dashboard',
          description:
            'The wizard generates a chart for each event you approved, grouped on one dashboard.',
          isRecommended: true,
        },
        {
          id: 'skip',
          label: 'Skip — I will create dashboards later',
          isSafestSkip: true,
        },
      ],
      recommendedOptionId: 'create',
      safeDefaultOptionId: 'skip',
      requiresHuman: true,
      automationAllowed: false,
      timeoutBehavior: null,
      consequenceIfSkipped:
        'Skipping is safe. You can run `wizard dashboard` later to create one.',
      reversible: true,
      whyAsking:
        'Events are approved and ready — a starter dashboard makes it obvious where to verify them.',
      resumeCommand: [...defaultResume(installDir), 'dashboard'],
      linkedSessionId: sessionId as `session_${string}`,
    });
    return asChoiceId(created.id);
  });
}

export interface EventPlanRevisionPromptOptions {
  installDir: string;
  /** SHA-like fingerprint of the rejected plan — pins promptId. */
  rejectedPlanHash: string;
  /** Why the user rejected (free-form feedback string). */
  feedback: string;
}

export function recordEventPlanRevisionChoice(
  opts: EventPlanRevisionPromptOptions,
): ChoiceId | null {
  const { installDir, rejectedPlanHash, feedback } = opts;
  return withMirror(installDir, 'event_plan_revision', (store, sessionId) => {
    const promptId = `event_plan_revision:${rejectedPlanHash}`;
    const existing = store.findPendingChoice(promptId);
    if (existing) return asChoiceId(existing.id);
    const created = store.addChoice({
      kind: 'event_plan_revision',
      promptId,
      message: 'Revise the event plan based on user feedback?',
      options: [
        {
          id: 'revise',
          label: 'Send feedback back to the agent',
          description: 'Agent will regenerate the event plan and re-prompt.',
          isRecommended: true,
        },
        {
          id: 'cancel',
          label: 'Cancel revision and skip the agent',
          isSafestSkip: true,
        },
      ],
      recommendedOptionId: 'revise',
      safeDefaultOptionId: 'cancel',
      requiresHuman: true,
      automationAllowed: false,
      timeoutBehavior: null,
      consequenceIfSkipped:
        'No revision is sent. The agent stops without persisting an event plan.',
      reversible: true,
      whyAsking: `User rejected the previous plan with feedback: ${feedback.slice(
        0,
        200,
      )}`,
      resumeCommand: defaultResume(installDir),
      linkedSessionId: sessionId as `session_${string}`,
    });
    return asChoiceId(created.id);
  });
}

export interface RegionSelectionPromptOptions {
  installDir: string;
  /** Display labels (`US`, `EU`) — drives the option list. */
  candidates: Array<{ id: 'us' | 'eu'; label: string }>;
  /** Source — `cli`, `slash`, `screen`, `region_forced`, etc. */
  source: string;
}

export function recordRegionSelectionChoice(
  opts: RegionSelectionPromptOptions,
): ChoiceId | null {
  const { installDir, candidates, source } = opts;
  return withMirror(installDir, 'region_selection', (store, sessionId) => {
    const promptId = `region_selection:${source}`;
    const existing = store.findPendingChoice(promptId);
    if (existing) return asChoiceId(existing.id);
    const created = store.addChoice({
      kind: 'environment_selection', // closest existing kind
      promptId,
      message: 'Pick the Amplitude data center region to send events to.',
      options: candidates.map((c) => ({
        id: c.id,
        label: c.label,
        description:
          c.id === 'eu'
            ? 'Routes events to api.eu.amplitude.com.'
            : 'Routes events to api.amplitude.com (default).',
      })),
      recommendedOptionId: candidates[0]?.id ?? null,
      safeDefaultOptionId: 'us',
      requiresHuman: true,
      automationAllowed: false,
      timeoutBehavior: null,
      consequenceIfSkipped:
        'Default = US. EU customers MUST pick EU explicitly or events leave the EU.',
      reversible: true,
      whyAsking:
        'Region determines the data center your events land in. Cannot infer from the CLI alone.',
      resumeCommand: defaultResume(installDir),
      linkedSessionId: sessionId as `session_${string}`,
    });
    return asChoiceId(created.id);
  });
}

export interface ProjectCreationPromptOptions {
  installDir: string;
  /** Display name the wizard suggested or the user provided. */
  suggestedName: string | null;
  /** What surfaced the prompt — picker, slash-command, CLI flag. */
  source: string;
}

export function recordProjectCreationChoice(
  opts: ProjectCreationPromptOptions,
): ChoiceId | null {
  const { installDir, suggestedName, source } = opts;
  return withMirror(installDir, 'project_creation', (store, sessionId) => {
    const promptId = `project_creation:${source}`;
    const existing = store.findPendingChoice(promptId);
    if (existing) return asChoiceId(existing.id);
    const created = store.addChoice({
      kind: 'other',
      promptId,
      message: suggestedName
        ? `Create a new Amplitude project named "${suggestedName}"?`
        : 'Create a new Amplitude project?',
      options: [
        {
          id: 'create',
          label: suggestedName ? `Create "${suggestedName}"` : 'Create project',
          isRecommended: true,
        },
        {
          id: 'cancel',
          label: 'Cancel — pick an existing project',
          isSafestSkip: true,
        },
      ],
      recommendedOptionId: 'create',
      safeDefaultOptionId: 'cancel',
      requiresHuman: true,
      automationAllowed: false,
      timeoutBehavior: null,
      consequenceIfSkipped: 'No project is created. The picker remains open.',
      reversible: true,
      whyAsking:
        'No project is currently selected, and the user opted to create one.',
      resumeCommand: [...defaultResume(installDir), 'create-project'],
      linkedSessionId: sessionId as `session_${string}`,
    });
    return asChoiceId(created.id);
  });
}

export interface AuthRetryPromptOptions {
  installDir: string;
  /** "logout" or "login" or "reauth". */
  reason: 'logout' | 'login' | 'reauth';
}

export function recordAuthRetryChoice(
  opts: AuthRetryPromptOptions,
): ChoiceId | null {
  const { installDir, reason } = opts;
  return withMirror(installDir, 'auth_retry', (store, sessionId) => {
    const promptId = `auth_retry:${reason}`;
    const existing = store.findPendingChoice(promptId);
    if (existing) return asChoiceId(existing.id);
    const message =
      reason === 'logout'
        ? 'Log out and clear stored Amplitude credentials?'
        : reason === 'login'
        ? 'Open the browser to log in to Amplitude?'
        : 'Re-authenticate with Amplitude?';
    const created = store.addChoice({
      kind: 'auth_retry',
      promptId,
      message,
      options: [
        {
          id: 'confirm',
          label:
            reason === 'logout'
              ? 'Yes, log out'
              : reason === 'login'
              ? 'Yes, open browser'
              : 'Yes, re-authenticate',
          isRecommended: reason !== 'logout',
        },
        {
          id: 'cancel',
          label: 'Cancel',
          isSafestSkip: true,
        },
      ],
      recommendedOptionId: reason === 'logout' ? 'cancel' : 'confirm',
      safeDefaultOptionId: 'cancel',
      requiresHuman: true,
      automationAllowed: false,
      timeoutBehavior: null,
      consequenceIfSkipped:
        reason === 'logout'
          ? 'No-op — you stay logged in.'
          : 'Browser does not open. Wizard cannot proceed without credentials.',
      reversible: true,
      whyAsking:
        reason === 'logout'
          ? 'Log-out clears stored OAuth tokens. The next run requires a fresh sign-in.'
          : 'Wizard needs valid Amplitude credentials to continue.',
      resumeCommand: [
        ...defaultResume(installDir),
        reason === 'logout' ? 'logout' : 'login',
      ],
      linkedSessionId: sessionId as `session_${string}`,
    });
    return asChoiceId(created.id);
  });
}

// ── Verification surfaces ──────────────────────────────────────────────

export interface DataIngestionVerificationOptions {
  installDir: string;
  /** Number of events the user approved on the event-plan screen. */
  approvedEventCount: number;
}

export function recordDataIngestionVerification(
  opts: DataIngestionVerificationOptions,
): string | null {
  const { installDir, approvedEventCount } = opts;
  return withMirror(installDir, 'data_ingestion', (store, sessionId) => {
    const verification = store.addVerification({
      kind: 'events_arriving_in_amplitude',
      whatToVerify: `Confirm Amplitude is receiving the ${approvedEventCount} approved event(s).`,
      expectedBehavior:
        'Events show up in Amplitude Live Event Stream within ~1 minute of being fired.',
      blockingSessionId: sessionId as `session_${string}`,
      unblockerHint:
        'If events do not arrive, run `wizard verify` and inspect the Live Event Stream filter chips.',
      resumeCommand: [
        'wizard',
        'verification',
        'mark',
        '<id>',
        '--status',
        'passed',
      ],
    });
    return verification.id;
  });
}

export interface DashboardCorrectnessVerificationOptions {
  installDir: string;
  dashboardUrl: string;
}

export function recordDashboardCorrectnessVerification(
  opts: DashboardCorrectnessVerificationOptions,
): string | null {
  const { installDir, dashboardUrl } = opts;
  return withMirror(installDir, 'dashboard_correctness', (store, sessionId) => {
    const verification = store.addVerification({
      kind: 'dashboard_correctness',
      whatToVerify:
        'Open the wizard-created dashboard and confirm each chart shows your events.',
      expectedBehavior:
        'Every chart on the dashboard renders a recent data point matching the event you fired.',
      commandToRun: ['open', dashboardUrl],
      blockingSessionId: sessionId as `session_${string}`,
      unblockerHint:
        'If charts are empty, fire a fresh event from your app and refresh the dashboard.',
      resumeCommand: [
        'wizard',
        'verification',
        'mark',
        '<id>',
        '--status',
        'passed',
      ],
    });
    return verification.id;
  });
}

export interface OauthBrowserLoginVerificationOptions {
  installDir: string;
  loginUrl: string;
}

export function recordOauthBrowserLoginVerification(
  opts: OauthBrowserLoginVerificationOptions,
): string | null {
  const { installDir, loginUrl } = opts;
  return withMirror(installDir, 'oauth_browser_login', (store, sessionId) => {
    const verification = store.addVerification({
      kind: 'oauth_browser_login',
      whatToVerify:
        'Complete the Amplitude OAuth flow in your browser and return to the wizard.',
      expectedBehavior:
        'After approving the consent screen, the browser shows "You can return to your terminal".',
      commandToRun: ['open', loginUrl],
      blockingSessionId: sessionId as `session_${string}`,
      unblockerHint:
        'If the browser did not open, copy the URL printed by the wizard and paste it manually.',
      resumeCommand: defaultResume(installDir),
    });
    return verification.id;
  });
}

export interface ExcalidrawFlowVerificationOptions {
  installDir: string;
  /** Free-form description of what the user should sanity-check. */
  whatToVerify: string;
}

export function recordExcalidrawFlowVerification(
  opts: ExcalidrawFlowVerificationOptions,
): string | null {
  const { installDir, whatToVerify } = opts;
  return withMirror(installDir, 'excalidraw_flow', (store, sessionId) => {
    const verification = store.addVerification({
      kind: 'excalidraw_flow',
      whatToVerify,
      expectedBehavior:
        'Manual smoke check completes without surfacing unexpected errors in the framework integration.',
      blockingSessionId: sessionId as `session_${string}`,
      unblockerHint:
        'If the smoke check surfaces an error, capture the steps and run `wizard verification mark <id> --status failed`.',
      resumeCommand: defaultResume(installDir),
    });
    return verification.id;
  });
}

export interface ManualPrTestVerificationOptions {
  installDir: string;
  prNumber?: number;
}

export function recordManualPrTestVerification(
  opts: ManualPrTestVerificationOptions,
): string | null {
  const { installDir, prNumber } = opts;
  return withMirror(installDir, 'manual_pr_test', (store, sessionId) => {
    const verification = store.addVerification({
      kind: 'manual_pr_test',
      whatToVerify:
        'Run the wizard-generated PR (or local diff) end-to-end and confirm events ingest.',
      expectedBehavior:
        'After deploying the PR / running the dev server, events show up in Amplitude.',
      blockingSessionId: sessionId as `session_${string}`,
      blockingPRNumber: prNumber ?? null,
      unblockerHint:
        'After testing, run `wizard verification mark <id> --status passed`.',
      resumeCommand: defaultResume(installDir),
    });
    return verification.id;
  });
}

// ── Answering helpers ─────────────────────────────────────────────────

export type AnsweredBy = 'human' | 'automation';

export function answerChoice(
  installDir: string,
  choiceId: string,
  optionId: string,
  by: AnsweredBy = 'human',
): Choice | null {
  return withMirror(installDir, 'answer_choice', (store) => {
    return store.answerChoice(asChoiceId(String(choiceId)), optionId, by);
  });
}

/**
 * Resolve a Choice by promptId — used by callsites that need to
 * "answer the most recent pending mcp_install:cursor".
 */
export function answerChoiceByPromptId(
  installDir: string,
  promptId: string,
  optionId: string,
  by: AnsweredBy = 'human',
): Choice | null {
  return withMirror(installDir, 'answer_choice_by_prompt', (store) => {
    const existing = store.findPendingChoice(promptId);
    if (!existing) return null;
    return store.answerChoice(asChoiceId(existing.id), optionId, by);
  });
}

/**
 * Re-export of the underlying types so callers can satisfy TS without
 * reaching into the orchestration tree.
 */
export type { ChoiceKind, VerificationKind };
