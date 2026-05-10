import {
  DEFAULT_PACKAGE_INSTALLATION,
  SPINNER_MESSAGE,
  type FrameworkConfig,
} from './framework-config';
import {
  type WizardSession,
  OutroKind,
  type AdditionalFeature,
  ADDITIONAL_FEATURE_PROMPTS,
  ADDITIONAL_FEATURE_LABELS,
  INLINE_FEATURES,
  isCreateAccountOnboarding,
} from './wizard-session';
import {
  tryGetPackageJson,
  isUsingTypeScript,
  getOrAskForProjectData,
} from '../utils/setup-utils';
import type { PackageDotJson } from '../utils/package-json';
import type { WizardOptions } from '../utils/types';
import { analytics, captureWizardError } from '../utils/analytics';
import { getUI } from '../ui';
import {
  getAgent,
  AgentErrorType,
  buildWizardMetadata,
} from './agent-interface';
import { runAgentDispatch } from './agent/run-agent-dispatch.js';
import { getLlmGatewayUrlFromHost, getMcpUrlFromZone } from '../utils/urls';
import { DEFAULT_AMPLITUDE_ZONE, OUTBOUND_URLS } from './constants.js';
import { resolveZone } from './zone-resolution.js';
import { getVersionCheckInfo, getVersionWarning } from './version-check';
import { sanitizeErrorMessageForLog } from './agent-events';

import * as fsSync from 'fs';
import path from 'path';
import { saveCheckpoint } from './session-checkpoint.js';
import { getDashboardPlanFile, getEventsFile } from '../utils/storage-paths.js';
import {
  resolveDataIngestionMaxWaitMs,
  nextDataIngestionPollWaitMs,
  DATA_INGESTION_POLL_BACKOFF_START_MS,
} from './data-ingestion-agent-poll.js';
import { enableDebugLogs, logToFile } from '../utils/debug';
import { getLogFilePath } from './observability/index.js';
import { createObservabilityMiddleware } from './middleware/observability';
import { MiddlewarePipeline } from './middleware/pipeline';
import { createBenchmarkPipeline } from './middleware/benchmark';
import { createRetryMiddleware } from './middleware/retry';
import {
  wizardAbort,
  WizardError,
  getWizardAbortSignal,
} from '../utils/wizard-abort';
import { ExitCode } from './exit-codes';
import { GENERIC_AGENT_CONFIG } from '../frameworks/generic/generic-wizard-agent';
import { buildPreflightContext } from './agent/preflight-context';
import { createLogger } from './observability/logger';

/**
 * Structured logger for pre-flight gate diagnostics. CLAUDE.md mandates
 * `createLogger` for production source paths so logs land in the per-
 * project NDJSON sidecar with searchable ctx fields, not just the legacy
 * `log.txt` debug stream.
 */
const preflightLog = createLogger('preflight');

/** Single source of truth for the support address shown in error messages. */
const SUPPORT_EMAIL = 'wizard@amplitude.com';

/**
 * Stable ids for the post-agent step queue. Each id is used in two
 * places — `getUI().seedPostAgentSteps` to register the row, and
 * `getUI().setPostAgentStep(id, …)` from inside the step function to
 * update its status. Coupled by string but cheap to find-and-replace.
 *
 * Note: a `create-dashboard` step ran here in parallel with `commit-events`
 * until DEFER_DASHBOARD_PLAN PR 4 — chart and dashboard creation moved to
 * the deferred `amplitude-wizard dashboard` command. Only the events-commit
 * step still runs as part of the main wizard.
 */
export const POST_AGENT_STEP_COMMIT_EVENTS = 'commit-events';

/**
 * Build the "you can bypass the Amplitude gateway with a direct Anthropic
 * key" hint shown in upstream-failure error messages. Shared by the
 * GATEWAY_DOWN, terminated-400, rate-limit, and generic API_ERROR branches —
 * all four are the same class of upstream-side problem from the user's
 * perspective, so they should offer the same workaround.
 */
function buildGatewayBypassHint(): string {
  const usingDirectKey = !!process.env.ANTHROPIC_API_KEY;
  return usingDirectKey
    ? `You're already using a direct Anthropic API key, so this is likely an Anthropic-side issue. Wait a few minutes and re-run.`
    : `Workaround: re-run with a direct Anthropic API key to bypass the Amplitude gateway:\n  ANTHROPIC_API_KEY=sk-ant-... npx @amplitude/wizard\n\nOr wait a few minutes and try again — gateway incidents typically resolve quickly.`;
}

/**
 * Sentry subtype tags we attach to `API_ERROR` / `RATE_LIMIT` runs so we can
 * group and alert on each upstream-shape separately. See
 * {@link classifyApiErrorSubtype} for the rules.
 */
export type ApiErrorSubtype =
  | 'stream_closed'
  | 'terminated_400'
  | 'rate_limit'
  | 'other';

/**
 * Classify a surfaced API error into a Sentry-friendly subtype tag.
 *
 *   - `stream_closed`  — Hook bridge race during prior-attempt teardown
 *                        (issue #297). PR #298 drains the prior iterator
 *                        and treats this as transient inside the inner
 *                        retry loop, so seeing it surface here means
 *                        every retry exhausted with the same race —
 *                        strong signal that the drain isn't fully
 *                        effective and we need a deeper fix.
 *   - `terminated_400` — Vertex/Anthropic killed the request mid-flight.
 *                        Slipped past the GATEWAY_DOWN guard because
 *                        earlier attempts had succeeded. (Sentry #7442894144)
 *   - `rate_limit`     — Wizard exhausted retries against a 429 storm.
 *   - `other`          — Unclassified API error. Catch-all.
 *
 * Pure for unit testing — no side effects. Exported so the
 * agent-runner test can lock down the matching rules without standing up
 * the full agent runtime.
 */
export function classifyApiErrorSubtype(input: {
  errorType: AgentErrorType;
  message: string;
}): ApiErrorSubtype {
  // Order matters: `stream_closed` first so a rate-limit message that
  // happens to mention "stream closed" still classifies as the more
  // specific bridge-race signal. In practice these strings are mutually
  // exclusive on the rawMessage we receive, but the ordering makes the
  // intent explicit.
  if (/stream\s+closed/i.test(input.message)) return 'stream_closed';
  if (/400\s+terminated/i.test(input.message)) return 'terminated_400';
  if (input.errorType === AgentErrorType.RATE_LIMIT) return 'rate_limit';
  return 'other';
}

/**
 * Decide whether a late-stage API failure should be treated as a soft
 * error (continue to MCP / outro) or a hard abort (wizardAbort).
 *
 * The agent stream can throw `API_ERROR` / `RATE_LIMIT` AFTER it has
 * already done all the meaningful work — common shapes:
 *   - dashboard MCP create succeeded, then a final flush hits a 429
 *   - setup-report.md was written, then the stream closed mid-tear-down
 *   - hook bridge fired its last event after the agent yielded
 *
 * In those cases the user's project is in a fully-set-up state. We
 * shouldn't punish them with a network error code and skip the MCP /
 * Slack / Outro screens — the wizard's job is done.
 *
 * Heuristic: the dashboard URL on the session is the most reliable
 * "we got past the long pole" signal. The dashboard MCP call happens
 * last in the agent's conclude phase, after events have been
 * instrumented and the setup report has been drafted. If the URL is
 * present, everything else is too.
 */
export function agentArtifactsLookComplete(session: WizardSession): boolean {
  return Boolean(session.checklistDashboardUrl);
}

/**
 * Heuristic: did the agent at least install the SDK and instrument
 * events, even if it didn't reach the dashboard creation step?
 *
 * The wizard's `confirm_event_plan` MCP tool persists the approved
 * event plan to `<installDir>/.amplitude/events.json`. Legacy
 * `<installDir>/.amplitude-events.json` is still read when present. The
 * presence of either location with non-empty parseable content is a hard signal that:
 *
 *   - The user approved an instrumentation plan
 *   - The agent reached the post-confirmation phase
 *   - Track call insertion was attempted (whether or not every callsite
 *     landed cleanly — but typically by this point it has)
 *
 * Used as a complement to `agentArtifactsLookComplete` for failure modes
 * where the dashboard URL is NOT set but the project is still in a
 * usable instrumented state — most commonly: the Amplitude MCP server
 * (mcp.amplitude.com) is unreachable at the END of the run, after the
 * events were instrumented but before the dashboard could be created.
 *
 * Distinct from `agentArtifactsLookComplete` because that function's
 * "complete" includes dashboard. This one's "instrumented" stops at the
 * code-changes phase. Dashboard-failed-but-everything-else-worked is a
 * meaningfully different state — the user has working analytics; the
 * only loss is the auto-built dashboard. They can build one manually at
 * app.amplitude.com.
 */
export function agentEventsInstrumented(session: WizardSession): boolean {
  // Try canonical location first, then fall back to the legacy dotfile
  // for older runs (`readLocalEventPlan` uses the same ordering by mtime).
  const candidates = [
    getEventsFile(session.installDir),
    path.join(session.installDir, '.amplitude-events.json'),
  ];
  for (const eventsPath of candidates) {
    try {
      if (!fsSync.existsSync(eventsPath)) continue;
      const raw = fsSync.readFileSync(eventsPath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return true;
    } catch {
      // Try the next candidate; only return false once both miss.
    }
  }
  return false;
}

/**
 * Single decision point for whether a late-stage agent error should be
 * treated as a soft fall-through (continue to MCP / Slack / Outro) or a
 * hard abort. Was previously inlined twice in `runAgentWizardBody` with
 * subtly different rules between the MCP-error and API-error branches —
 * a rate limit during dashboard creation would hard-abort even when
 * events were instrumented, while the same situation under MCP_MISSING
 * fell through softly. This function is the single source of truth.
 *
 * Soft if EITHER the dashboard URL is set on the session OR the event
 * plan was persisted to disk (`.amplitude/events.json` or its legacy
 * mirror). Hard otherwise.
 */
export function classifyAgentOutcome(session: WizardSession): {
  severity: 'soft' | 'hard';
  dashboardComplete: boolean;
  eventsInstrumented: boolean;
} {
  const dashboardComplete = agentArtifactsLookComplete(session);
  const eventsInstrumented = agentEventsInstrumented(session);
  return {
    severity: dashboardComplete || eventsInstrumented ? 'soft' : 'hard',
    dashboardComplete,
    eventsInstrumented,
  };
}

/**
 * Build the "events instrumented; run `wizard dashboard` later" message
 * shown in the outro and live status ticker once the main run finishes.
 *
 * DEFER_DASHBOARD_PLAN PR 4: chart and dashboard creation moved out of
 * `wizard run` and into the deferred `amplitude-wizard dashboard`
 * command. The main run's success state is "events instrumented", and
 * we tell the user how (and when) to build the dashboard. Wording adapts
 * based on whether the agent persisted a `dashboard-plan.json` artifact
 * via `record_dashboard_plan` — when it did, we cite the plan path so
 * the user can inspect or hand-edit the chart strategy before the
 * deferred command runs.
 *
 * Pure for unit testing — no I/O, no UI calls.
 */
export function buildDashboardDeferredMessage(args: {
  /** Path to the persisted plan artifact, or null if none was written. */
  planPath: string | null;
  /** Whether the agent successfully wrote events.json. Defaults to true. */
  eventsInstrumented?: boolean;
}): string {
  const eventsInstrumented = args.eventsInstrumented ?? true;
  const lead = eventsInstrumented
    ? 'Events instrumented!'
    : 'Setup partially complete.';
  return args.planPath
    ? `${lead} Run \`npx @amplitude/wizard dashboard\` once your app has sent the new events to Amplitude (usually a few minutes) to build a starter dashboard from the plan saved at ${args.planPath}.`
    : `${lead} Run \`npx @amplitude/wizard dashboard\` once your app has sent the new events to Amplitude (usually a few minutes) to build a starter dashboard.`;
}

/**
 * Hard-error abort for `API_ERROR` / `RATE_LIMIT` agent failures.
 * Extracted from the runAgentWizardBody inline branch so the soft-error
 * path can early-return without duplicating this logic.
 */
async function abortOnApiError(
  errorType: AgentErrorType.API_ERROR | AgentErrorType.RATE_LIMIT,
  rawMessage: string,
  config: FrameworkConfig,
): Promise<never> {
  // Subtype within API_ERROR — these all share the "upstream dropped
  // something" root cause but reach this branch by different paths:
  //
  //   terminated_400  — Vertex/Anthropic killed the request mid-flight.
  //                     Slipped past the GATEWAY_DOWN guard because
  //                     earlier attempts had succeeded. (Sentry #7442894144)
  //   stream_closed   — Hook bridge race during prior-attempt teardown
  //                     (issue #297). #298 drains the prior iterator
  //                     and treats this as transient inside the inner
  //                     retry loop, so seeing it surface here means
  //                     every retry exhausted with the same bridge
  //                     race — strong signal that the drain isn't
  //                     fully effective and we need a deeper fix.
  //   rate_limit      — Wizard exhausted retries against a 429 storm.
  //   other           — Unclassified API error. Catch-all.
  // Classification runs against the raw form so the regex can still see
  // the canonical "API Error: 400 terminated" / "stream closed" markers
  // — they're tiny strings at the head of the message, never the SSE
  // body itself. Once classified, every downstream callsite that
  // INTERPOLATES the message into user-facing copy or Sentry context
  // must use the sanitized form so the gateway's mid-stream SSE body
  // doesn't leak as a wall of `event:` / `data:` lines. (Sentry
  // #7442894144 — the raw message had been getting embedded into
  // `userMessage` and surfaced verbatim in the TUI Outro screen.)
  const errorSubtype = classifyApiErrorSubtype({
    errorType,
    message: rawMessage,
  });
  const safeMessage = sanitizeErrorMessageForLog(rawMessage);

  captureWizardError(
    'Agent API',
    safeMessage || 'Unknown API error',
    'agent-runner',
    {
      integration: config.metadata.integration,
      'error type': errorType,
      'error subtype': errorSubtype,
      'using direct key': !!process.env.ANTHROPIC_API_KEY,
    },
  );

  let userMessage: string;
  switch (errorSubtype) {
    case 'stream_closed':
      userMessage = `LLM gateway connection lost\n\nThe wizard couldn't keep a stable connection to the Amplitude LLM gateway across retries (${safeMessage}). Re-running the wizard usually clears this up.\n\n${buildGatewayBypassHint()}\n\nIf this persists, please report it (with ${getLogFilePath()}) to: ${SUPPORT_EMAIL}`;
      break;
    case 'terminated_400':
      userMessage = `LLM gateway dropped the connection\n\nThe Amplitude LLM gateway terminated the request mid-flight (${safeMessage}). Some progress was made before this happened — re-running the wizard usually finishes the job.\n\n${buildGatewayBypassHint()}\n\nIf this persists, please report it (with ${getLogFilePath()}) to: ${SUPPORT_EMAIL}`;
      break;
    case 'rate_limit':
      userMessage = `Rate limit reached\n\nThe LLM gateway is rate-limiting requests (${
        safeMessage || 'API Error: 429'
      }). Wait a minute or two and re-run the wizard.\n\n${buildGatewayBypassHint()}`;
      break;
    case 'other':
      userMessage = `LLM gateway error\n\n${
        safeMessage || 'Unknown error'
      }\n\nThis is typically an upstream issue with the Amplitude LLM gateway, not your project. Re-running the wizard usually works.\n\n${buildGatewayBypassHint()}\n\nIf this persists, please report it (with ${getLogFilePath()}) to: ${SUPPORT_EMAIL}`;
      break;
  }

  await wizardAbort({
    message: userMessage,
    error: new WizardError(`API error: ${safeMessage || 'unknown'}`, {
      integration: config.metadata.integration,
      'error type': errorType,
      'error subtype': errorSubtype,
      // Preserves the structured `report_status` detail / underlying
      // agentResult.message that produced this branch — without it
      // Sentry only sees the boilerplate `userMessage` copy, which
      // doesn't disambiguate between subtypes for debugging. The
      // sanitized form keeps SSE protocol noise out of the Sentry
      // payload while preserving the head of the real error.
      'agent error detail': safeMessage || null,
    }),
    exitCode: ExitCode.NETWORK_ERROR,
  });
  // wizardAbort returns Promise<never>, but TypeScript can't always
  // narrow that through an async function — explicit throw keeps
  // downstream type checking happy.
  throw new Error('unreachable');
}

/**
 * Build a WizardOptions bag from a WizardSession (for code that still expects WizardOptions).
 */
function sessionToOptions(session: WizardSession): WizardOptions {
  return {
    installDir: session.installDir,
    debug: session.debug,
    forceInstall: session.forceInstall,
    default: false,
    authOnboardingPath: session.authOnboardingPath,
    localMcp: session.localMcp,
    ci: session.ci,
    menu: session.menu,
    benchmark: session.benchmark,
    appId: session.appId,
    apiKey: session.apiKey,
  };
}

/**
 * Read the freshest stored OAuth token, refreshing it from the stored
 * refresh token when it has expired (or is within the 5-minute pre-expiry
 * buffer). Returns the new access token on success, or `fallback` when no
 * stored token / refresh token / refresh-attempt success is available.
 *
 * This is the post-run-token-staleness fix:
 *
 * Pre-PR, agent-runner had this logic inline ONCE — at the top of the
 * run, before the agent started. After a 14-minute Excalidraw run the
 * 1-hour OAuth token was already past its `expiresAt` by the time
 * `commitPlannedEventsStep` / `createDashboardStep` / `pollForDataIngestion`
 * fired their MCP / data-API calls, surfacing the same
 * "Authentication failed while trying to fetch Amplitude user data"
 * cascade we already fixed for the in-run path in PR #348.
 *
 * Now extracted so the agent-runner can re-invoke it at the post-run
 * boundary, AND so the freshly-refreshed token gets mirrored back onto
 * `session.credentials.accessToken` — that way late-render screens
 * (SlackScreen, OutroScreen) automatically pick up the new value when
 * they read from session.
 *
 * Failure mode: returns `fallback` and logs an analytics breadcrumb. The
 * downstream API call will then fail loudly — better than swallowing the
 * auth error twice.
 */
export async function refreshTokenIfStale(
  fallback: string,
  label: string,
): Promise<string> {
  try {
    const { getStoredToken, getStoredUser, storeToken } = await import(
      '../utils/ampli-settings.js'
    );
    const { refreshAccessToken } = await import('../utils/oauth.js');
    const { EXPIRY_BUFFER_MS } = await import('../utils/token-refresh.js');
    const user = getStoredUser();
    const stored = getStoredToken(user?.id, user?.zone);
    if (!stored?.accessToken) return fallback;
    const needsRefresh =
      user &&
      Date.now() + EXPIRY_BUFFER_MS > new Date(stored.expiresAt).getTime();
    if (!needsRefresh) {
      // If the on-disk token differs from the caller's in-memory one,
      // a previous refresh rotated it — drop any MCP sessions bound to
      // the stale value before handing it back. Cheap & idempotent.
      if (stored.accessToken !== fallback) {
        const { invalidateMcpSessionsForToken } = await import(
          './mcp-with-fallback.js'
        );
        invalidateMcpSessionsForToken(fallback);
      }
      return stored.accessToken;
    }
    const startedAt = Date.now();
    try {
      // CRITICAL: pass the user's zone — without it `refreshAccessToken`
      // defaults to the US OAuth host and EU users' refresh tokens get
      // rejected. (Same root cause as PR #348's in-run fix.)
      const refreshed = await refreshAccessToken(
        stored.refreshToken,
        user.zone,
      );
      storeToken(user, {
        accessToken: refreshed.accessToken,
        idToken: refreshed.idToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
      });
      // Drop cached MCP sessions keyed on the now-stale token so the
      // next callAmplitudeMcp opens a fresh session with the rotated
      // bearer instead of 401-ing and falling through to the 12s agent
      // fallback.
      const { invalidateMcpSessionsForToken } = await import(
        './mcp-with-fallback.js'
      );
      invalidateMcpSessionsForToken(fallback);
      if (stored.accessToken !== fallback) {
        invalidateMcpSessionsForToken(stored.accessToken);
      }
      analytics.wizardCapture('auth refreshed silently', {
        label,
        'duration ms': Date.now() - startedAt,
      });
      return refreshed.accessToken;
    } catch (err) {
      analytics.wizardCapture('auth refresh failed', {
        label,
        reason: err instanceof Error ? err.message : 'unknown',
        'duration ms': Date.now() - startedAt,
      });
      // Even when refresh fails, return whatever non-refreshed token we
      // already pulled from disk — it might still be live (we may have
      // entered the buffer but not yet expired).
      return stored.accessToken;
    }
  } catch {
    return fallback;
  }
}

/**
 * Universal agent-powered wizard runner.
 * Handles the complete flow for any framework using Amplitude MCP integration.
 *
 * All user decisions come from the session — no UI prompts.
 */
export async function runAgentWizard(
  config: FrameworkConfig,
  session: WizardSession,
  getAdditionalFeatureQueue?: () => readonly AdditionalFeature[],
  featureProgress?: {
    onFeatureStart?: (feature: AdditionalFeature) => void;
    onFeatureComplete?: (feature: AdditionalFeature) => void;
  },
): Promise<void> {
  if (session.debug) {
    enableDebugLogs();
  }

  // Ensure the wizard's artifacts (event plan + the single-use integration
  // skill + the kept-on-disk instrumentation/taxonomy skills) are gitignored
  // before anything is installed. Idempotent — safe to call on every run.
  // Without this, `git status` after a run is full of wizard scaffolding
  // and `git add .` sweeps it into the user's commits.
  const {
    ensureWizardArtifactsIgnored,
    cleanupWizardArtifacts,
    writeFallbackReportIfMissing,
    archiveSetupReportFile,
    restoreSetupReportIfMissing,
    persistDraftEventPlan,
  } = await import('./wizard-tools.js');
  const { getLatestEventPlanDecision } = await import(
    './agent/event-plan-feedback-state.js'
  );

  // Initialise the file-change ledger BEFORE we touch ANY user file so
  // its preamble snapshot of the working tree (gitignore content,
  // presence of `.amplitude/`) reflects the truly-pre-wizard state.
  // ensureWizardArtifactsIgnored writes to `.gitignore`, so it MUST run
  // after the ledger has captured the original gitignore — otherwise
  // rollback would "restore" the wizard's own gitignore additions.
  const { initFileChangeLedger, executeRollbackWithStatus } = await import(
    './file-change-ledger.js'
  );
  initFileChangeLedger(session.installDir);

  // Idempotent — safe to call on every run. Without this, `git status`
  // after a run is full of wizard scaffolding and `git add .` sweeps it
  // into the user's commits. Runs AFTER the ledger preamble snapshot
  // above so rollback restores the user's original `.gitignore`.
  ensureWizardArtifactsIgnored(session.installDir);

  // Move any prior `amplitude-setup-report.md` to
  // `amplitude-setup-report.previous.md` BEFORE the run starts so the
  // outro never advertises a stale report from a previous run (e.g.
  // against a different workspace) as if it described THIS run. The
  // fresh report still lands at the canonical filename when the agent
  // reaches its conclude phase; if it never gets there (full activation,
  // cancel, etc.) the canonical filename stays absent and the outro
  // hides the "View setup report" option. We keep exactly one prior
  // report — not a growing timestamped pile — because the project root
  // shouldn't carry an audit trail. (PR 316.)
  archiveSetupReportFile(session.installDir);

  // Helper bound to this run's session. The fallback never overwrites
  // an agent-authored report (see writeFallbackReportIfMissing's
  // existsSync check), so it's safe to invoke from any teardown path.
  //
  // Before writing the report, check whether the run ended with an
  // unresolved `confirm_event_plan` feedback record (the agent gave
  // the user a plan, the user asked for changes, the agent never
  // circled back). When that's the case, persist the proposed events
  // as a DRAFT in `.amplitude/events.json` so the user doesn't lose
  // both the plan AND their feedback — re-running the wizard can
  // pick up where they left off, and the fallback report itself
  // surfaces the unresolved-feedback state.
  const tryWriteFallback = (): void => {
    const latest = getLatestEventPlanDecision();
    if (latest && latest.decision === 'feedback' && latest.events.length > 0) {
      persistDraftEventPlan(session.installDir, latest.events, latest.feedback);
    }
    writeFallbackReportIfMissing({
      installDir: session.installDir,
      integration: session.integration,
      dashboardUrl: session.checklistDashboardUrl,
      workspaceName: session.selectedProjectName,
      envName: session.selectedEnvName,
    });
  };

  // Wire report restoration into every teardown path.
  //
  // restoreSetupReportIfMissing — if the run never reaches the conclude
  // phase, restore the archived prior report so the user gets back what
  // they had before this run touched anything. Goes through
  // `registerPriorityCleanup` (unshifts onto the cleanup queue) so it
  // ALWAYS runs before any code that may write a fresh canonical
  // report, regardless of registration order.
  //
  // The fallback writer (writeFallbackReportIfMissing) is intentionally
  // NOT registered here. Cancel / failure paths must not pollute the
  // user's repo with a stub `amplitude-setup-report.md` when no prior
  // report existed and the agent never reached its conclude phase. The
  // success path below still calls the fallback as a safety net for the
  // rare case where a successful run skips the conclude-phase write.
  const { registerPriorityCleanup } = await import('../utils/wizard-abort.js');
  registerPriorityCleanup(() =>
    restoreSetupReportIfMissing(session.installDir),
  );

  // Hoisted so the rollback cleanup closure (registered below) can read
  // it. Set inside the try-block once the body returns truthy. Cleanup
  // hooks fire from `wizardAbort()` synchronously before this assignment
  // runs on the cancel path, so the gate evaluates to `false` exactly
  // when we want it to (= run the rollback).
  let success = false;

  // Reverse the file-change ledger on every non-success teardown.
  //
  // Fires from `wizardAbort()` (cancel / error / Ctrl+C) AND from the
  // agent-runner try/finally below (body returns false / throws). Both
  // call sites are guarded by the ledger's `rolledBack` flag — running
  // twice is a no-op the second time, so ordering doesn't matter.
  //
  // We deliberately do NOT clear the ledger on success: a successful
  // run leaves writes in place by definition, and `runRollbackIfNotSuccessful`
  // is gated on the `success` flag set later in this function.
  //
  // Closure references `success` (declared just below) so we can short-
  // circuit when the run reached the success branch — registering the
  // cleanup here keeps the wiring in one block, but the gate fires
  // whenever the cleanup runs.
  const runRollbackIfNotSuccessful = (): void => {
    if (success) return;
    // Carve-out for failure classes where the agent's writes are
    // demonstrably consistent and an automatic revert is more
    // destructive than the user wants. AUTH_ERROR is the canonical
    // example: the bearer token expired on the very last call but the
    // event plan was approved, the `track()` calls landed, and
    // validation passed. Reverting those 10 files because of a token
    // refresh bug is exactly the user-hostile behaviour the original
    // post-mortem flagged.
    //
    // The OutroScreen renders a `[K] Keep / [R] Revert` choice when
    // `preserveFiles` is set, so the user can still revert manually if
    // they want — this gate only suppresses the AUTOMATIC revert.
    if (session.outroData?.preserveFiles) {
      logToFile(
        '[ledger] rollback: skipped (outroData.preserveFiles set; user owns the revert decision via OutroScreen)',
      );
      return;
    }
    executeRollbackWithStatus((message) => {
      try {
        getUI().pushStatus(message);
      } catch {
        /* surfaced to log already */
      }
    }, logToFile);
  };
  registerPriorityCleanup(runRollbackIfNotSuccessful);

  // Cleanup runs ONLY on the success path. Cancel / error / Ctrl+C all
  // preserve the wizard's working artifacts (`.amplitude/` metadata,
  // installed integration skills) so a re-run can pick up where the user
  // left off without re-confirming the event plan or re-downloading
  // skills. The gitignore (`ensureWizardArtifactsIgnored` above) keeps
  // those files out of source control regardless, so leaving them on
  // disk is harmless.
  //
  // Background: #261 originally wired cleanup through both `try/finally`
  // and `registerCleanup` so it fired on every exit. That broke
  // resumability — every Ctrl+C / transient error / cancel forced the
  // user to re-confirm their entire instrumentation plan from scratch.
  // The gitignore made the cleanup redundant for its stated purpose
  // (preventing `git add .` pollution).
  try {
    success = await runAgentWizardBody(
      config,
      session,
      getAdditionalFeatureQueue,
      featureProgress,
    );
  } finally {
    // Cover the two failure paths that bypass wizardAbort's cleanup hook:
    //   - body returns false  (non-throwing early return, e.g. version check)
    //   - body throws         (uncaught exception propagates to caller)
    // Restore the archived prior report so a cancelled / errored run
    // leaves the user's previous setup report at the canonical filename.
    // The fallback writer is intentionally NOT called here: a stub
    // `amplitude-setup-report.md` synthesized on cancel pollutes the
    // user's working tree with a file they never asked for. If a prior
    // report existed, restore handles it; otherwise the canonical path
    // stays absent and the OutroScreen hides "View setup report".
    if (!success) {
      // Order matches `registerPriorityCleanup` (rollback unshifted last
      // so it fires first): rollback the ledger BEFORE restoring the
      // archived setup report. Otherwise, when the agent created
      // `amplitude-setup-report.md`, restore would see the agent's file
      // exists and skip restoration, then rollback would delete the
      // agent's file — leaving the user's prior report unrecovered.
      runRollbackIfNotSuccessful();
      restoreSetupReportIfMissing(session.installDir);
    }
  }
  // Cleanup runs only when the body explicitly signals success. Other
  // exit paths preserve artifacts:
  //   - body returns false  → non-success early return (e.g. version
  //     check failure surfaced via getUI().cancel, which does NOT exit
  //     the process). Skip cleanup so the user can re-run after
  //     upgrading without re-downloading the integration skill.
  //   - body throws         → propagates naturally; cleanup is skipped.
  //   - wizardAbort path    → calls process.exit(); this line is never
  //     reached, integration skills + events file stay on disk.
  if (success) {
    // Safety net for the rare case where the agent reaches a
    // successful conclusion without writing the report. The fallback
    // never overwrites an agent-authored report.
    tryWriteFallback();

    cleanupWizardArtifacts(session.installDir, { onSuccess: true });
  }
}

/**
 * Internal: the body of `runAgentWizard`, extracted so the public entry
 * point can run `cleanupWizardArtifacts({ onSuccess: true })` only on a
 * successful run. Returns `true` on a successful completion, `false` on
 * non-throwing early-exit paths (e.g. version-check failure where we
 * surface a cancel UI but don't throw or exit). Uncaught exceptions
 * propagate without running cleanup, preserving resumability on
 * cancel/error.
 */
async function runAgentWizardBody(
  config: FrameworkConfig,
  session: WizardSession,
  getAdditionalFeatureQueue?: () => readonly AdditionalFeature[],
  featureProgress?: {
    onFeatureStart?: (feature: AdditionalFeature) => void;
    onFeatureComplete?: (feature: AdditionalFeature) => void;
  },
): Promise<boolean> {
  // Version check
  if (
    config.detection.getInstalledVersion ||
    config.detection.getVersionCheckInfo
  ) {
    const versionCheckInfo = await getVersionCheckInfo(
      config.detection,
      sessionToOptions(session),
    );
    logToFile(`[runAgentWizard] detected version: ${versionCheckInfo.version}`);
    const versionWarning = getVersionWarning(versionCheckInfo, {
      coerceVersion: true,
    });
    if (versionWarning) {
      logToFile(`[runAgentWizard] ${versionWarning}`);
      const docsUrl =
        config.metadata.unsupportedVersionDocsUrl ?? config.metadata.docsUrl;
      logToFile(
        `[runAgentWizard] directing user to manual setup guide: ${docsUrl}`,
      );
      const minimumVersion =
        versionCheckInfo.minimumVersion ?? config.detection.minimumVersion;
      const packageDisplayName =
        versionCheckInfo.packageDisplayName ?? config.metadata.name;
      const version = versionCheckInfo.version ?? 'unknown';
      // Route through wizardAbort so the TUI Outro is shown, awaited,
      // *and* the process actually exits afterward. A previous version
      // called getUI().cancel() then `return false`, which left the
      // Ink event loop running indefinitely after the user dismissed
      // the outro because nothing called process.exit on this path.
      // wizardAbort handles cancel + analytics shutdown + exit as a
      // single atomic sequence; cancelOptions.docsUrl forwards the
      // manual-setup link into the Outro for recovery.
      await wizardAbort({
        message: `The wizard requires ${packageDisplayName} ${minimumVersion} or later, but found version ${version}. Upgrade your ${packageDisplayName} version to use the wizard, or follow the manual setup guide.`,
        exitCode: ExitCode.GENERAL_ERROR,
        cancelOptions: { docsUrl },
      });
      // Unreachable — wizardAbort returns Promise<never>. The earlier
      // `return false` documented "skip success-path cleanup so the
      // integration skill stays on disk for a clean re-run after the
      // user upgrades" — that's still preserved because process.exit
      // fires before any further work in this function runs.
      return false;
    }
  }

  // Setup phase — informational only, no prompts
  // Beta notice, pre-run notice, and welcome label are all derivable
  // from session.frameworkConfig — IntroScreen reads them directly.
  //
  // The wizard used to interrupt here with a SettingsOverrideScreen if
  // `.claude/settings.json` declared `ANTHROPIC_BASE_URL` or
  // `ANTHROPIC_AUTH_TOKEN` (e.g. for LiteLLM, corporate proxy, Claude
  // Pro/Max OAuth) — and offered to back the file up so the SDK wouldn't
  // load it. That was destructive (any non-graceful exit could lose the
  // file) and hostile to the typical Claude Code user. We now scope our
  // gateway env to `.claude/settings.local.json` instead, which the SDK
  // loads at higher precedence than the project file. The user's
  // checked-in settings.json is never touched. See
  // `claude-settings-scope.ts` and `agent-interface.ts:applyScopedSettings`.

  // Disclosure text is static — IntroScreen renders it directly.

  // Helper: append a single chip to the cold-start "discovery feed" the
  // TUI fades into the empty middle of RunScreen. Each fact has a stable
  // id so re-publishing on a retry path is a no-op; non-TUI UIs ignore
  // the call entirely. Wrapped in try/catch so a UI hiccup never blocks
  // the agent from starting — purely cosmetic.
  const publishDiscoveryFact = (
    id: string,
    body: { label: string; value: string },
  ): void => {
    try {
      getUI().pushDiscoveryFact({
        id,
        label: body.label,
        value: body.value,
        discoveredAt: Date.now(),
      });
    } catch (err) {
      logToFile(
        `[discovery-feed] pushDiscoveryFact(${id}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  const typeScriptDetected = isUsingTypeScript({
    installDir: session.installDir,
  });
  session.typescript = typeScriptDetected;

  // Cosmetic: surface each cold-start fact as it lands in the wizard's
  // "discovery feed" so RunScreen has *something* to fade in during the
  // 30-60s agent boot. The values themselves are already on the session
  // (used by the preflight context block); we just echo them to the TUI.
  // No-op for non-TUI implementations.
  publishDiscoveryFact('framework', {
    label: 'Framework',
    value:
      session.detectedFrameworkLabel ?? config.metadata.name ?? 'detecting…',
  });
  publishDiscoveryFact('typescript', {
    label: 'TypeScript',
    value: typeScriptDetected ? 'yes' : 'no',
  });

  // Framework detection and version
  const usesPackageJson = config.detection.usesPackageJson !== false;
  let packageJson: PackageDotJson | null;
  let frameworkVersion: string | undefined;

  if (usesPackageJson) {
    packageJson = await tryGetPackageJson({ installDir: session.installDir });
    if (packageJson) {
      frameworkVersion = config.detection.getVersion(packageJson);
      // Log warning if package not found, but continue (agent handles it).
      // Uses getVersion() rather than checking packageName directly so
      // frameworks that match multiple packages (e.g. React Router +
      // TanStack) don't trigger false "not installed" warnings.
      if (!frameworkVersion) {
        getUI().log.warn(
          `${config.detection.packageDisplayName} does not seem to be installed. Continuing anyway — the agent will handle it.`,
        );
      }
    } else {
      getUI().log.warn(
        'Could not find package.json. Continuing anyway — the agent will handle it.',
      );
    }
  } else {
    frameworkVersion = config.detection.getVersion(null);
  }

  // Refine the framework chip with the resolved version once known.
  if (frameworkVersion && frameworkVersion !== 'latest') {
    const baseLabel =
      session.detectedFrameworkLabel ?? config.metadata.name ?? 'framework';
    publishDiscoveryFact('framework-version', {
      label: 'Version',
      value: `${baseLabel} ${frameworkVersion}`,
    });
  }

  // Set analytics tags for framework version
  if (frameworkVersion && config.detection.getVersionBucket) {
    const versionBucket = config.detection.getVersionBucket(frameworkVersion);
    analytics.setSessionProperty(
      `${config.metadata.integration}-version`,
      versionBucket,
    );
  }

  analytics.wizardCapture('agent started', {
    integration: config.metadata.integration,
  });

  // Credentials are pre-set by bin.ts (TUI mode) via the AuthScreen SUSI flow.
  // Only fall back to getOrAskForProjectData for CI mode or non-TUI fallback.
  if (!session.credentials) {
    // Diagnostic: in TUI mode we should never reach the agent runner
    // with null credentials — the Auth flow gate (`isComplete` requires
    // `credentials !== null`) is the single source of truth. If we DO
    // reach here, the gate let the user past, which means a different
    // bug. Log loudly so the next "stalled session after `git reset
    // --hard`" report has an unambiguous breadcrumb instead of a
    // silent fallback into `getOrAskForProjectData` that may itself
    // stall on prompts.
    if (!session.ci && !session.agent) {
      logToFile(
        '[agent-runner] WARN: credentials null in TUI mode at runAgent entry — Auth flow gate let through an unconfirmed session. Falling back to getOrAskForProjectData; if this stalls, the AuthScreen never set credentials before the run kicked off.',
        {
          hasPendingOrgs: session.pendingOrgs !== null,
          pendingOrgsLength: session.pendingOrgs?.length ?? 0,
          selectedOrgId: session.selectedOrgId ?? null,
          selectedProjectId: session.selectedProjectId ?? null,
          selectedEnvName: session.selectedEnvName ?? null,
          requiresAccountConfirmation: session.requiresAccountConfirmation,
        },
      );
    }
    const authResult = await getOrAskForProjectData({
      authOnboardingPath: session.authOnboardingPath,
      ci: session.ci,
      apiKey: session.apiKey,
      appId: session.appId,
      installDir: session.installDir,
    });

    session.credentials = {
      accessToken: authResult.accessToken,
      projectApiKey: authResult.projectApiKey,
      host: authResult.host,
      appId: authResult.appId,
    };
    getUI().setCredentials({
      ...session.credentials,
      orgId: session.selectedOrgId,
      orgName: session.selectedOrgName,
      projectId: session.selectedProjectId,
      projectName: session.selectedProjectName,
      envName: session.selectedEnvName,
    });
    getUI().setRegion(authResult.cloudRegion);
    getUI().setProjectHasData(false);
  }

  const {
    accessToken: rawAccessToken,
    projectApiKey,
    host,
    appId,
  } = session.credentials;
  // The TUI's AuthScreen may have stored the id_token instead of the
  // OAuth access token (the field names were swapped historically).
  // Always prefer the real OAuth access token from the wizard session store for Hydra auth.
  let accessToken = await refreshTokenIfStale(rawAccessToken, 'pre-run');
  // Mirror the freshest token onto the session so SlackScreen / OutroScreen
  // and any other late screen that reads `session.credentials.accessToken`
  // pick it up. Without this, the screens still see the ~14m-old token from
  // before the agent run and fail with "Authentication failed".
  if (accessToken !== rawAccessToken && session.credentials) {
    session.credentials.accessToken = accessToken;
  }
  // Derive cloudRegion from session via the centralized resolver.
  // readDisk: true — the agent runner may be entered via paths (resumed
  // sessions, TUI fallback) where the RegionSelect invariant isn't guaranteed.
  const cloudRegion: import('../utils/types.js').CloudRegion = resolveZone(
    session,
    DEFAULT_AMPLITUDE_ZONE,
    { readDisk: true },
  );

  // Framework context was already gathered by SetupScreen + detection
  const frameworkContext = session.frameworkContext;

  // Set analytics tags from framework context
  const contextTags = config.analytics.getTags(frameworkContext);
  Object.entries(contextTags).forEach(([key, value]) => {
    analytics.setSessionProperty(key, value);
  });

  // Skip the Amplitude MCP when the framework provides its own prompt (no MCP needed)
  // OR when there is no valid access token (MCP would fail auth and the agent would get stuck).
  const skipAmplitudeMcp =
    config.prompts.buildPrompt !== undefined || !accessToken;

  // Cold-start phase 1: skill staging. The next few seconds is bundled-skill
  // copy + on-disk resolution; surface it on the activity line so the user
  // doesn't read the silence as a hung process. Cleared on the matching
  // setCurrentActivity(null) below once initialization completes. We split
  // cold start into three labeled phases (skills → project read → agent
  // init) so the user sees a status change every 5-15s instead of a single
  // 30-60s silent block. The total cold-start window stays the same; only
  // the perceived progress changes.
  const coldStartStartedAt = Date.now();
  try {
    getUI().setCurrentActivity({
      kind: 'cold-start',
      message: 'Loading skills...',
      startedAt: coldStartStartedAt,
      estimatedDurationSec: 45,
    });
  } catch (err) {
    logToFile('cold-start: setCurrentActivity (skills) failed', err);
  }

  // Pre-stage all bundled skills the agent will need into the user's
  // .claude/skills/ directory. The taxonomy / instrumentation / dashboard
  // skills are constants; the integration skill is resolved per framework
  // (with a sensible default fallback). When staging succeeds the prompt pins
  // that id; otherwise a deterministic on-disk resolver picks at most one
  // `integration-*` match so the model never chooses among several Glob hits.
  const { preStageSkills, bundledSkillExists } = await import(
    './wizard-tools.js'
  );
  const { listIntegrationSkillIdsOnDisk, resolveIntegrationSkillId } =
    await import('./integration-skill-resolve.js');
  const integrationSkillId = config.metadata.getIntegrationSkillId
    ? config.metadata.getIntegrationSkillId(frameworkContext)
    : (() => {
        const fallback = `integration-${config.metadata.integration}`;
        return bundledSkillExists(fallback) ? fallback : null;
      })();
  const { integrationStaged } = preStageSkills(
    session.installDir,
    integrationSkillId,
  );

  let integrationSkillIdForPrompt: string | null =
    integrationStaged && integrationSkillId ? integrationSkillId : null;
  if (!integrationSkillIdForPrompt) {
    const diskIds = listIntegrationSkillIdsOnDisk(session.installDir);
    const resolved = resolveIntegrationSkillId({
      integration: config.metadata.integration,
      primaryBundledId: integrationSkillId,
      frameworkContext,
      candidateSkillIds: diskIds,
    });
    if (resolved?.source === 'lexicographic_tiebreak') {
      logToFile(
        `[runAgentWizard] integration skill lexicographic tie-break: picked "${resolved.skillId}" (scoped pool had multiple matches; consider tightening framework hints).`,
      );
    }
    integrationSkillIdForPrompt = resolved?.skillId ?? null;
  }

  // Cold-start phase 2: project read. The next 1-5s is package-manager
  // detection + preflight context build (file walks). Update the activity
  // line so the user sees a fresh status before the silence resumes —
  // without this, "Loading skills..." sits stale through this whole
  // window even though we've moved on.
  try {
    getUI().setCurrentActivity({
      kind: 'cold-start',
      message: 'Reading your project...',
      startedAt: coldStartStartedAt,
      estimatedDurationSec: 45,
    });
  } catch (err) {
    logToFile('cold-start: setCurrentActivity (project read) failed', err);
  }

  // Pre-flight context block — gives the agent every piece of state the
  // wizard already discovered (cwd, framework, package manager, env files,
  // org/project, region, project-binding) so it doesn't reflexively burn
  // ~30s of cold-start probing for things we can hand it directly. The
  // discovery tools (`detect_package_manager`, `check_env_keys`, etc.)
  // remain registered for genuine mid-run verification — only the
  // start-of-run probe is suppressed (see commandments). Best-effort:
  // the package-manager scan is wrapped so a slow / failing detector
  // can't block the agent from starting.
  let packageManagerInfo: Awaited<
    ReturnType<typeof config.detection.detectPackageManager>
  > | null = null;
  try {
    packageManagerInfo = await config.detection.detectPackageManager(
      session.installDir,
    );
  } catch (err) {
    preflightLog.warn('detectPackageManager failed', {
      'error message': err instanceof Error ? err.message : String(err),
    });
  }

  if (packageManagerInfo?.primary) {
    publishDiscoveryFact('package-manager', {
      label: 'Package manager',
      value: packageManagerInfo.primary.label,
    });
  }
  if (session.selectedProjectName) {
    publishDiscoveryFact('project', {
      label: 'Project',
      value: session.selectedProjectName,
    });
  }
  publishDiscoveryFact('region', {
    label: 'Region',
    value: cloudRegion.toUpperCase(),
  });

  // Detect project size up-front and let `buildPreflightContext` make the
  // gate decision. Internal LLM-reliability research recommends a JIT-
  // context-loading posture for medium-and-up codebases; the full pre-
  // flight Markdown dump only pays off on small projects where it
  // eliminates the cold-start probe without crowding out attention budget.
  // Detection has a hard 5s wall-clock cap inside `detectProjectSize`;
  // large projects that hit the cap are treated as "use JIT" so we don't
  // pay a probe tax to figure out we're large. Logging happens AFTER the
  // gate so the diagnostic line reflects the authoritative decision the
  // gate emitted (no risk of divergence between two recomputations).
  const preflightCtx = await buildPreflightContext({
    installDir: session.installDir,
    integration: session.integration,
    detectedFrameworkLabel: session.detectedFrameworkLabel,
    frameworkVersion: frameworkVersion ?? null,
    typescript: typeScriptDetected,
    packageManagerInfo,
    userEmail: session.userEmail,
    selectedOrgId: session.selectedOrgId,
    selectedOrgName: session.selectedOrgName,
    selectedProjectId: session.selectedProjectId,
    selectedProjectName: session.selectedProjectName,
    selectedEnvName: session.selectedEnvName,
    cloudRegion,
    projectBound: fsSync.existsSync(
      path.join(session.installDir, '.amplitude', 'project-binding.json'),
    ),
    frameworkContext,
  });
  preflightLog.info('project size detected', {
    'file count': preflightCtx.projectSize.fileCount,
    'event count': preflightCtx.projectSize.eventCount,
    'timed out': preflightCtx.projectSize.timedOut,
    'cap hit': preflightCtx.projectSize.capHit,
    'file threshold': preflightCtx.thresholds.fileThreshold,
    'event threshold': preflightCtx.thresholds.eventThreshold,
    mode: preflightCtx.jitMode ? 'jit' : 'full',
  });

  const integrationPrompt =
    preflightCtx.prompt +
    '\n' +
    buildIntegrationPrompt(
      config,
      {
        frameworkVersion: frameworkVersion || 'latest',
        typescript: typeScriptDetected,
        projectApiKey,
        host,
        appId,
        cloudRegion,
      },
      frameworkContext,
      skipAmplitudeMcp,
      integrationSkillIdForPrompt,
    ) +
    buildInlineFeatureSection(session.additionalFeatureQueue);

  // Initialize and run agent
  const spinner = getUI().spinner();

  // Evaluate all feature flags at the start of the run so they can be sent to the LLM gateway
  const wizardFlags = await analytics.getAllFlagsForWizard();
  const wizardMetadata = buildWizardMetadata(wizardFlags);

  // Determine MCP URL.
  //
  // The MCP host has to match the bearer's issuer — `mcp.eu.amplitude.com`
  // 401s any US-issued token with `invalid_token`, and the inverse holds.
  // The bearer's zone is determined by which OAuth host minted it, NOT by
  // the env's data region. A US-account user picking an EU env still has a
  // US-issued bearer, so they need to talk to the US MCP regardless of
  // where the env's data lives. Routing MCP off resolveZone (the env's
  // zone) used to AUTH_ERROR every cross-region setup at agent init.
  //
  // Other regional URLs (api host for SDK init, app links for dashboards)
  // continue to use `cloudRegion` because they DO follow the env's data
  // zone — the wizard only conflates account/data zones for MCP.
  const { decodeJwtZone } = await import('../utils/jwt-exp.js');
  const accountZone = decodeJwtZone(accessToken) ?? cloudRegion;
  const mcpUrl = getMcpUrlFromZone(accountZone, { local: session.localMcp });
  if (accountZone !== cloudRegion) {
    logToFile('[mcp] account zone differs from env data zone', {
      accountZone,
      envZone: cloudRegion,
      mcpUrl,
    });
  }

  // Skills URL: derived from the same host as the LLM proxy.
  // Always tries remote first; falls back to bundled if fetch fails.
  // Override with SKILLS_URL env var for testing.
  const skillsBaseUrl =
    process.env.SKILLS_URL || getLlmGatewayUrlFromHost(host) + '/skills';

  // The previous restore-on-outro hook was paired with the destructive
  // `backupAndFixClaudeSettings` flow. The new scoping (writing our env
  // into `.claude/settings.local.json`) registers its own restore via
  // `registerCleanup` from inside `applyScopedSettings`, so the file
  // returns to its pre-wizard state on every exit path — no separate
  // outro hook needed.
  getUI().startRun();

  // Cold-start phase 3: agent SDK init (MCP server connect, model handshake,
  // system-prompt cache prime, first LLM round-trip). Frequently the longest
  // single block of pre-first-message silence on a fresh run. We reuse
  // `coldStartStartedAt` so the elapsed-time counter in the ActivityLine
  // climbs continuously across all three cold-start phases — the user sees
  // one continuous "we're working on it" timer instead of three separate
  // counters that each reset to 0s.
  try {
    getUI().setCurrentActivity({
      kind: 'cold-start',
      message: 'Starting the agent...',
      startedAt: coldStartStartedAt,
      estimatedDurationSec: 45,
    });
  } catch (err) {
    logToFile('cold-start: setCurrentActivity (init) failed', err);
  }

  const agent = await getAgent(
    {
      workingDirectory: session.installDir,
      amplitudeMcpUrl: mcpUrl,
      amplitudeApiKey: projectApiKey,
      amplitudeBearerToken: accessToken,
      amplitudeApiHost: host,
      additionalMcpServers: config.metadata.additionalMcpServers,
      detectPackageManager: config.detection.detectPackageManager,
      wizardFlags,
      wizardMetadata,
      skipAmplitudeMcp,
      skillsBaseUrl,
      agentSessionId: session.agentSessionId,
      targetsBrowser: config.metadata.targetsBrowser,
      mode: session.mode,
      // Forward orchestrator-supplied context (from `--context-file`
      // / `AMPLITUDE_WIZARD_CONTEXT`) so it lands in the cached
      // system-prompt block alongside the commandments. Undefined when
      // no context was provided — keeps the cached preset stable for
      // every "no context" run.
      orchestratorContext: session.orchestratorContext ?? undefined,
    },
    sessionToOptions(session),
  );

  // Always run observability middleware for structured logging + Sentry breadcrumbs.
  // Retry middleware surfaces transient gateway retries to the UI.
  // Benchmark middleware (token/cost tracking) is opt-in via --benchmark.
  const retryMiddleware = createRetryMiddleware((state) =>
    getUI().setRetryState(state),
  );
  const middleware = session.benchmark
    ? createBenchmarkPipeline(spinner, sessionToOptions(session), undefined, {
        extraMiddlewares: [retryMiddleware],
      })
    : new MiddlewarePipeline([
        createObservabilityMiddleware(),
        retryMiddleware,
      ]);

  // Dispatch through the AI-SDK runner shim — when
  // `AMPLITUDE_WIZARD_AI_SDK_INNER_LOOP=1` the new `runAiSdkAgent`
  // executes; otherwise the legacy Agent-SDK `runAgent` runs verbatim.
  // Phase D-3: foundation only, default-off. D-5 flips the default,
  // D-6 deletes the legacy path. See `src/lib/agent/run-agent.ts` for
  // the full parity matrix.
  const agentResult = await runAgentDispatch(
    agent,
    integrationPrompt,
    sessionToOptions(session),
    spinner,
    {
      estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
      spinnerMessage: SPINNER_MESSAGE,
      successMessage: config.ui.successMessage,
      errorMessage: 'Integration failed',
      additionalFeatureQueue:
        getAdditionalFeatureQueue ?? (() => session.additionalFeatureQueue),
      onFeatureStart: featureProgress?.onFeatureStart,
      onFeatureComplete: featureProgress?.onFeatureComplete,
      // Fires just before the SDK summarizes context. Refresh the on-disk
      // checkpoint so a compaction crash leaves the user with a resumable
      // state, capture an analytics breadcrumb for cost/quality analysis,
      // and surface a live activity-line so the user knows the 30-90s
      // silence is the SDK packing the conversation, not a hung process.
      // The matching `setCurrentActivity(null)` lives on the next
      // UserPromptSubmit / first-message branch in agent-interface.ts —
      // there's no PostCompact hook, but compaction always ends with a
      // user-prompt-submit + first model message, so clearing on the
      // first non-`requesting` message after PreCompact is enough.
      onPreCompact: ({ trigger }) => {
        try {
          saveCheckpoint(session, 'pre_compact');
        } catch (err) {
          logToFile('PreCompact: saveCheckpoint failed', err);
        }
        try {
          getUI().setCurrentActivity({
            kind: 'compaction',
            message:
              'Compacting context (this can take a few minutes) — keeping the relevant pieces, dropping the rest.',
            startedAt: Date.now(),
            estimatedDurationSec: 60,
          });
        } catch (err) {
          logToFile('PreCompact: setCurrentActivity failed', err);
        }
        analytics.wizardCapture('agent compaction triggered', {
          trigger,
          integration: session.integration ?? null,
          'detected framework': session.detectedFrameworkLabel ?? null,
        });
      },
      // Fires once when MAX_CONSECUTIVE_BASH_DENIES consecutive Bash denies
      // accumulate — the agent is thrashing on a command that will never
      // be allowed (real-world repro: 47-turn loop verifying env vars via
      // `node -e` / `printenv` / `cat .env`). Trigger graceful halt so the
      // remaining turn budget isn't burned on the same denied call.
      // Fire-and-forget: wizardAbort returns Promise<never> and exits the
      // process, but the hook callback can't await it. Subsequent denied
      // calls between this and process.exit re-hit the deny path and
      // return without further side effects (the breaker is one-shot).
      onCircuitBreakerTripped: ({ consecutiveDenies, lastCommand }) => {
        analytics.wizardCapture('bash deny circuit breaker tripped', {
          'consecutive denies': consecutiveDenies,
          'last command': lastCommand.slice(0, 200),
          integration: session.integration ?? null,
          'detected framework': session.detectedFrameworkLabel ?? null,
        });
        const abortMessage = `Setup halted: the agent kept trying Bash commands the wizard does not permit (${consecutiveDenies} in a row). This usually means the agent was looping on env-var verification or a similar denied operation. Re-run the wizard; if it happens again, file an issue with the log file path shown below.`;
        // Route through the UI layer so React subscribers (the OutroScreen)
        // observe the change. Direct `session.outroData = ...` mutates the
        // session object but never bumps `$version`, so the screen stays on
        // Run until a terminal resize forces an Ink redraw.
        getUI().setOutroData({
          kind: OutroKind.Error,
          message: abortMessage,
          canRestart: true,
        });
        // Fire and forget — wizardAbort tears down the process. We
        // intentionally don't await so we don't deadlock the hook return.
        void wizardAbort({
          message: abortMessage,
          error: new WizardError('Bash deny circuit breaker tripped', {
            'consecutive denies': consecutiveDenies,
            'last command': lastCommand,
            integration: session.integration,
          }),
          exitCode: ExitCode.AGENT_FAILED,
        });
      },
    },
    middleware,
  );

  // Handle error cases detected in agent output
  if (agentResult.error === AgentErrorType.AUTH_ERROR) {
    captureWizardError(
      'Agent Authentication',
      'Session expired or invalid during agent run',
      'agent-runner',
      {
        integration: config.metadata.integration,
        'auth subkind': agentResult.authSubkind ?? 'amplitude',
      },
    );
    // Two distinct AUTH_ERROR sources need distinct copy. The original
    // message ("account just created, isn't fully provisioned") was
    // written for the new-user signup failure mode and was being shown
    // verbatim when an existing user's LLM-gateway bearer expired mid-run
    // — actively misleading and the most enraging copy for that specific
    // failure. See AuthErrorSubkind for the source distinction.
    const isLlmGateway = agentResult.authSubkind === 'llm-gateway';
    const signupUrl = `${OUTBOUND_URLS.overview[cloudRegion]}/signup`;
    const authMessage = isLlmGateway
      ? `Authentication failed\n\n` +
        `Your wizard session token expired during a long-running task.\n\n` +
        `Re-run the wizard to refresh and resume — your in-progress files are preserved.`
      : `Authentication failed\n\n` +
        `We couldn't authenticate your Amplitude session with our service. ` +
        `This can happen if your account was just created and isn't fully provisioned yet.\n\n` +
        `Try one of the following:\n` +
        `  • Re-run the wizard in a minute and log in again\n` +
        `  • Sign up manually at ${signupUrl}, then re-run the wizard`;
    // Set outroData via the UI so the OutroScreen reliably re-renders before
    // wizardAbort awaits user dismissal. Direct mutation of session.outroData
    // doesn't notify nanostore subscribers and would make the outro miss the
    // updated state — the user would not see the auth-failure confirmation
    // before being routed back to login on the next run.
    getUI().setOutroData({
      kind: OutroKind.Error,
      message: authMessage,
      // Only steer the user back through the OAuth login wall when the
      // failure was on the Amplitude side. An LLM-gateway 401 is solved
      // by simply re-running — forcing /login here would just add friction.
      promptLogin: !isLlmGateway,
      canRestart: true,
      // The bearer token expired on the very last gateway call. The
      // event plan was approved, `track()` calls landed, validation
      // passed — automatically reverting that work would penalise the
      // user for what is fundamentally an internal token refresh bug.
      // The OutroScreen surfaces a `[K] Keep / [R] Revert` prompt so
      // the user owns the decision instead of the cleanup hook.
      preserveFiles: true,
    });
    // Also push a status so the failure is visibly announced even if the
    // OutroScreen hasn't taken focus yet (e.g. mid-Run-screen render).
    getUI().pushStatus('Authentication failed — see details below.');
    // Only clear credentials when Amplitude OAuth itself failed. LLM-gateway
    // expiry doesn't invalidate the user's Amplitude session, so wiping
    // credentials would force a needless re-login on the next run.
    if (!isLlmGateway) {
      session.credentials = null;
    }
    await wizardAbort({
      message: authMessage,
      error: new WizardError('Authentication failed during agent run', {
        integration: config.metadata.integration,
        'error type': AgentErrorType.AUTH_ERROR,
        'auth subkind': agentResult.authSubkind ?? 'amplitude',
      }),
      exitCode: ExitCode.AUTH_REQUIRED,
    });
  }

  if (
    agentResult.error === AgentErrorType.MCP_MISSING ||
    agentResult.error === AgentErrorType.RESOURCE_MISSING
  ) {
    // Soft-error path: if the agent has already instrumented events
    // (or completed everything including the dashboard), an MCP /
    // resource failure here is on a tail-end call — most commonly the
    // dashboard creation step at the end of the conclude phase. The
    // SDK is installed, events are instrumented, code is written.
    // Hard-aborting would throw away all that work and show the user a
    // "Setup cancelled" outro with no recap of what succeeded.
    //
    // Real-world example: ✓ Welcome ✓ Auth ✓ Setup ✓ Verify ● Done —
    // every step green-checked, but the wizard surfaced
    // "Setup cancelled" with the detail "Amplitude MCP not connected
    // — dashboard could not be created automatically. Visit
    // app.amplitude.com to build it manually using the chart plan
    // below." The agent itself reported the failure as partial and
    // suggested a recovery path; the wizard ignored that nuance.
    //
    // The MCP_MISSING signal can come from EITHER the in-process
    // `wizard-tools` MCP (skill loading, env vars) OR the remote
    // `amplitude-wizard` MCP (mcp.amplitude.com — event plans,
    // dashboards). The agent-reported detail is preserved on the
    // WizardError payload for Sentry / `agent error detail` analytics
    // so we can disambiguate which server failed.
    const errorType = agentResult.error;
    const detail = agentResult.message ?? null;
    const { severity, dashboardComplete, eventsInstrumented } =
      classifyAgentOutcome(session);

    if (severity === 'soft') {
      logToFile(
        `[agent-runner] Soft ${errorType} after agent did meaningful work (dashboard=${dashboardComplete}, events=${eventsInstrumented}): ${
          detail ?? '(no detail)'
        }. Continuing to MCP / outro.`,
      );
      analytics.wizardCapture('agent soft error', {
        integration: config.metadata.integration,
        'error type': errorType,
        'dashboard complete': dashboardComplete,
        'events instrumented': eventsInstrumented,
        'agent error detail': detail,
      });
      // Surface a plain-English warning so the user knows what's
      // recoverable. Copy stays jargon-free — same standard as PR #336.
      // Dashboard creation is deferred (PR 4 of DEFER_DASHBOARD_PLAN.md),
      // so a soft MCP failure here only matters if the agent was probing
      // the Amplitude MCP read-only — events are still instrumented.
      const softDetail = detail || errorType;
      getUI().pushStatus(
        eventsInstrumented
          ? `Note: a late tooling step couldn't reach Amplitude's setup service — your SDK + events are instrumented. Detail: ${softDetail}`
          : `Note: a late tooling step couldn't reach Amplitude's setup service — some progress was saved, but event instrumentation may be incomplete. Detail: ${softDetail}`,
      );
      // Fall through to env-var upload, MCP install, Slack, Outro —
      // they don't depend on agentResult.error being null.
    } else {
      // Hard-error path: agent didn't get far enough to leave the
      // project usable. Could be the in-process wizard-tools MCP
      // (skill loading) failing right at startup. Abort with the
      // jargon-free copy from PR #336.
      const isMcp = errorType === AgentErrorType.MCP_MISSING;
      await wizardAbort({
        message: isMcp
          ? `Couldn't reach Amplitude's setup service — this looks like a network or service issue.\n\nTry again in a moment, or set up ${config.metadata.name} manually:\n${config.metadata.docsUrl}`
          : `Couldn't load setup instructions for ${config.metadata.name} — this may be a temporary service issue or a version mismatch.\n\nTry again in a moment, or set up ${config.metadata.name} manually:\n${config.metadata.docsUrl}`,
        error: new WizardError(
          isMcp
            ? 'Agent could not access Amplitude MCP server'
            : 'Agent could not access setup resource',
          {
            integration: config.metadata.integration,
            'error type': errorType,
            'agent error detail': detail,
          },
        ),
        exitCode: ExitCode.AGENT_FAILED,
      });
    }
  }

  if (agentResult.error === AgentErrorType.GATEWAY_DOWN) {
    // Same SSE-suppression rationale as `abortOnApiError` below: the
    // raw gateway error string can include the entire failing SSE body.
    const safeAgentMessage = sanitizeErrorMessageForLog(
      agentResult.message ?? '',
    );
    captureWizardError(
      'Agent API',
      safeAgentMessage || 'LLM gateway unavailable',
      'agent-runner',
      {
        integration: config.metadata.integration,
        'error type': agentResult.error,
      },
    );

    const usingDirectKey = !!process.env.ANTHROPIC_API_KEY;
    await wizardAbort({
      message: `Amplitude LLM gateway unavailable\n\nEvery retry attempt failed with the same upstream error (${
        safeAgentMessage || 'API Error: 400 terminated'
      }). This is an issue with the Amplitude LLM gateway, not your project.\n\n${buildGatewayBypassHint()}\n\nIf this persists, please report it (with the log file at ${getLogFilePath()}) to: ${SUPPORT_EMAIL}`,
      error: new WizardError(
        `LLM gateway unavailable: ${safeAgentMessage || 'unknown'}`,
        {
          integration: config.metadata.integration,
          'error type': agentResult.error,
          'using direct key': usingDirectKey,
          'agent error detail': safeAgentMessage || null,
        },
      ),
      exitCode: ExitCode.NETWORK_ERROR,
    });
  }

  if (agentResult.error === AgentErrorType.GATEWAY_INVALID_REQUEST) {
    const safeAgentMessage = sanitizeErrorMessageForLog(
      agentResult.message ?? '',
    );
    captureWizardError(
      'Agent API',
      safeAgentMessage || 'Wizard request rejected by gateway',
      'agent-runner',
      {
        integration: config.metadata.integration,
        'error type': agentResult.error,
      },
    );

    const usingDirectKey = !!process.env.ANTHROPIC_API_KEY;
    await wizardAbort({
      message: `Wizard request rejected by Amplitude gateway\n\nThe gateway returned "Invalid request sent to model provider" — this build of the wizard is sending a request shape (e.g. an \`anthropic-beta\` header or tool schema field) that the upstream model provider does not accept. Retrying will not help because the next request will be identically rejected.\n\nFix: upgrade to the latest \`@amplitude/wizard\` (npm i -g @amplitude/wizard@latest) — this build addresses known schema/beta rejection cases.\n\n${buildGatewayBypassHint()}\n\nIf you are already on the latest build, please report it (with the log file at ${getLogFilePath()}) to: ${SUPPORT_EMAIL}`,
      error: new WizardError(
        `Wizard request rejected by gateway: ${safeAgentMessage || 'unknown'}`,
        {
          integration: config.metadata.integration,
          'error type': agentResult.error,
          'using direct key': usingDirectKey,
          'agent error detail': safeAgentMessage || null,
        },
      ),
      exitCode: ExitCode.NETWORK_ERROR,
    });
  }

  if (
    agentResult.error === AgentErrorType.RATE_LIMIT ||
    agentResult.error === AgentErrorType.API_ERROR
  ) {
    const rawMessage = agentResult.message ?? '';

    // Soft-error path: if the agent already left the project in a
    // usable state (dashboard URL set OR event plan persisted), the
    // API failure was on a tail-end call — often the last token flush,
    // an observability ping, or a hook closing the stream after the
    // agent already wrote the setup report. Hard-aborting here would
    // skip MCP / Slack / Outro and exit with a network error code,
    // even though the user's project is in a fully-set-up state.
    //
    // Aligned with the MCP_MISSING branch above via classifyAgentOutcome
    // so a rate-limit during dashboard creation doesn't hard-abort while
    // an MCP_MISSING in the same spot would have soft-fallen-through.
    const { severity, dashboardComplete, eventsInstrumented } =
      classifyAgentOutcome(session);
    if (severity === 'soft') {
      const errorSubtype = classifyApiErrorSubtype({
        errorType: agentResult.error,
        message: rawMessage,
      });
      // Sanitize before logging / surfacing — gateway 4xx error strings
      // sometimes contain the entire failing SSE response body. Using
      // the raw form here would dump hundreds of `event:` / `data:`
      // protocol frames into the user-visible status ticker.
      const safeMessage = sanitizeErrorMessageForLog(rawMessage);
      logToFile(
        `[agent-runner] Soft API error after work completed (${errorSubtype}, dashboard=${dashboardComplete}, events=${eventsInstrumented}): ${safeMessage}. Continuing to MCP / outro.`,
      );
      analytics.wizardCapture('agent soft error', {
        integration: config.metadata.integration,
        'error type': agentResult.error,
        'error subtype': errorSubtype,
        'dashboard complete': dashboardComplete,
        'events instrumented': eventsInstrumented,
      });
      // Surface a non-fatal warning in the status ticker so the user
      // sees something happened on the way out, but don't abort.
      getUI().pushStatus(
        `Note: a late API call failed (${
          safeMessage || agentResult.error
        }) but your project's setup is complete — continuing.`,
      );
      // Fall through to the post-agent steps (env upload, MCP, Slack,
      // DataIngestion, Outro). They don't depend on agentResult.error
      // being null, just on getting past this if/else.
    } else {
      // Hard-error path: artifacts missing, so the agent didn't get
      // far enough to leave the project in a usable state. Abort.
      await abortOnApiError(agentResult.error, rawMessage, config);
    }
  }

  // Build environment variables from OAuth credentials
  const envVars = config.environment.getEnvVars(projectApiKey, host);

  // Upload environment variables to hosting providers (auto-accept)
  let uploadedEnvVars: string[] = [];
  if (config.environment.uploadToHosting) {
    const { uploadEnvironmentVariablesStep } = await import(
      '../steps/index.js'
    );
    uploadedEnvVars = await uploadEnvironmentVariablesStep(envVars, {
      integration: config.metadata.integration,
      session,
    });
  }

  // Post-install restart reminder — the single most common failure mode is
  // a user whose dev server was already running when we wrote env vars and
  // who doesn't know to restart it for the new values to load. Emit this
  // once for human-operator modes (interactive TUI + CI-with-oversight),
  // and only when env vars were actually written (some frameworks set
  // getEnvVars to {} and manage config differently).
  // Suppressed for --agent/NDJSON mode: agent orchestrators run against
  // fresh processes or test apps, not a human-managed dev server.
  if (!session.agent && Object.keys(envVars).length > 0) {
    getUI().pushStatus(
      `Your Amplitude env vars are set. If your dev server or build was already running, restart it (with whatever command you started it with) so the new values load — then click around your app and we'll wait for events.`,
    );
  }

  // Refresh the access token AT the post-run boundary so the three
  // downstream consumers (commitPlannedEvents, createDashboard,
  // pollForDataIngestion) and any subsequent screens (SlackScreen,
  // OutroScreen) see a fresh bearer token. Long agent runs (~14m on a
  // big repo like Excalidraw) push past the 1-hour OAuth expiry, and
  // the pre-run refresh from runtime-start is no longer valid here.
  // Without this, the post-run paths surface "Authentication failed
  // while trying to fetch Amplitude user data" silently — the wizard
  // claims success but the events never register in the Data tab and
  // the dashboard never gets created.
  const postRunToken = await refreshTokenIfStale(accessToken, 'post-run');
  if (postRunToken !== accessToken) {
    accessToken = postRunToken;
    if (session.credentials) {
      session.credentials.accessToken = postRunToken;
    }
    logToFile('[agent-runner] post-run token refreshed');
  }

  // Surface the post-agent steps as a visible sub-list under the agent's
  // task list so the user sees forward motion through what was previously
  // a silent gap (4/4 agent tasks ✓ + a static footer for up to 90s reads
  // as a hung wizard). Each step transitions pending → in_progress →
  // completed | skipped from inside the step function itself
  // (commitPlannedEventsStep); the FinalizingPanel renders the queue with
  // per-step elapsed time.
  //
  // History: a `create-dashboard` step ran here in parallel with
  // commit-events until DEFER_DASHBOARD_PLAN PR 4 — chart and dashboard
  // creation moved to the deferred `amplitude-wizard dashboard` command.
  // The final-success message and (optionally) a `dashboard-plan.json`
  // hand-off replace the inline dashboard step.
  getUI().seedPostAgentSteps([
    {
      id: POST_AGENT_STEP_COMMIT_EVENTS,
      label: 'Save your event plan to Amplitude',
      activeForm: 'Saving your event plan to Amplitude',
      status: 'pending',
    },
  ]);

  // Mark `wire` complete now that the agent stream has terminated AND the
  // events.json artifact is on disk. Without dashboard as a downstream
  // step, the renderer's sequential cascade no longer rolls wire up to
  // completed automatically — we signal it here.
  if (agentEventsInstrumented(session)) {
    try {
      getUI().applyJourneyTransition('wire', 'completed');
    } catch (err) {
      logToFile(
        `[agent-runner] applyJourneyTransition('wire','completed') threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Commit the instrumented event plan to the Amplitude tracking plan as
  // planned events so the names show up in the Data tab immediately — even
  // before any track() call fires in the user's app.
  const plannedEventsSummary = await commitPlannedEventsStep(
    agentResult.plannedEvents ?? [],
    accessToken,
    appId,
    session,
    cloudRegion,
  );

  // Dashboard-deferred analytics breadcrumb. Lets us track which runs
  // would have built a dashboard inline pre-PR4 vs which actually
  // produce a dashboard-plan.json hand-off for the deferred command.
  // `record_dashboard_plan` (when the agent emits one) writes the plan
  // file directly — we don't synthesize one here from `plannedEvents`,
  // we just observe whether it landed.
  const dashboardPlanPath = getDashboardPlanFile(session.installDir);
  const dashboardPlanWritten = fsSync.existsSync(dashboardPlanPath);
  analytics.wizardCapture('dashboard deferred', {
    integration: config.metadata.integration,
    'plan written': dashboardPlanWritten,
    'plan path': dashboardPlanWritten ? dashboardPlanPath : '',
    'events instrumented': agentEventsInstrumented(session),
  });

  // MCP installation is handled by McpScreen — no prompt here

  // Data ingestion check — agent mode only (not CI).
  // Poll via MCP until events arrive, then emit a structured result event.
  if (session.agent) {
    await pollForDataIngestion(session, accessToken, cloudRegion);
  }

  // Build outro data and store it for OutroScreen
  const continueUrl = isCreateAccountOnboarding(session)
    ? session.signupMagicLinkUrl ?? OUTBOUND_URLS.products(cloudRegion)
    : undefined;

  if (session.agent && !session.ci && session.signupMagicLinkUrl) {
    const { default: opn } = await import('opn');
    void opn(session.signupMagicLinkUrl, { wait: false }).catch(() => {
      /* fire-and-forget */
    });
  }

  // Deferred-dashboard hand-off message. Always shown on success now that
  // the main run no longer creates a dashboard inline — `wire` is the
  // terminal step and chart/dashboard creation is owned by the
  // `amplitude-wizard dashboard` subcommand. Wording adapts based on
  // whether the agent persisted a chart plan via `record_dashboard_plan`.
  const dashboardDeferredMessage = buildDashboardDeferredMessage({
    planPath: dashboardPlanWritten ? dashboardPlanPath : null,
    eventsInstrumented: agentEventsInstrumented(session),
  });

  const changes = [
    ...config.ui.getOutroChanges(frameworkContext),
    Object.keys(envVars).length > 0
      ? `Added environment variables to .env file`
      : '',
    uploadedEnvVars.length > 0
      ? `Uploaded environment variables to your hosting provider`
      : '',
    plannedEventsSummary,
    dashboardDeferredMessage,
  ].filter(Boolean);

  // Surface the same line in the live status ticker so the user sees it
  // even before the OutroScreen renders (esp. in --agent / --ci modes
  // where the outro panel may not fully render).
  try {
    getUI().pushStatus(dashboardDeferredMessage);
  } catch (err) {
    logToFile(
      `[agent-runner] pushStatus(dashboardDeferred) threw: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // Route the rich success payload through the UI layer so React
  // subscribers (the OutroScreen) are notified. Direct
  // `session.outroData = ...` mutates the session object but never bumps
  // `$version`, so the screen stays on Run until a terminal resize forces
  // an Ink redraw. `getUI().outro()` below sees outroData is set and
  // skips its default; it still flips runPhase → Completed which emits a
  // second change event for the router to advance.
  getUI().setOutroData({
    kind: OutroKind.Success,
    changes,
    docsUrl: config.metadata.docsUrl,
    continueUrl,
  });

  // Wizard-artifact cleanup happens in `runAgentWizard` after this
  // function returns `true`. Cancel/error paths return `false` (or
  // throw / call wizardAbort) so artifacts are preserved for a clean
  // re-run.

  getUI().outro(`Successfully installed Amplitude!`);

  await analytics.shutdown('success');
  return true;
}

/**
 * Poll the Amplitude MCP server for event ingestion in agent mode.
 *
 * Timing: inter-poll delay uses exponential-ish backoff (see
 * `data-ingestion-agent-poll.ts`). Max wall time: `DATA_INGESTION_TIMEOUT_MS`
 * env override, else shorter defaults for CI / `--agent` than the legacy 30m.
 *
 * Emits structured NDJSON events via the AgentUI:
 *   - `status` events every poll cycle while waiting
 *   - `result` event when events are detected (includes event names)
 *   - `log` warning if the timeout is reached without detecting events
 *
 * Skipped silently if no project ID can be resolved (e.g. --api-key flow).
 *
 * @param session    - wizard session (must have session.agent === true)
 * @param accessToken - OAuth access token for MCP Bearer auth
 * @param cloudRegion - us | eu, used to resolve project ID lazily if needed
 */
async function pollForDataIngestion(
  session: WizardSession,
  accessToken: string,
  cloudRegion: string,
): Promise<void> {
  const { fetchHasAnyEventsMcp, fetchAmplitudeUser } = await import(
    '../lib/api.js'
  );
  const { logToFile } = await import('../utils/debug.js');

  const MAX_WAIT_MS = resolveDataIngestionMaxWaitMs(session);
  let interPollWaitMs = DATA_INGESTION_POLL_BACKOFF_START_MS;

  // Resolve the numeric Amplitude app ID.
  // It is set by resolveEnvironmentSelection for the environment-picker path,
  // and by the fire-and-forget in bin.ts for the TUI path.
  // If still missing, try a single fetchAmplitudeUser call.
  let appId = session.selectedAppId ?? null;
  if (!appId) {
    try {
      const userInfo = await fetchAmplitudeUser(
        accessToken,
        cloudRegion as 'us' | 'eu',
      );
      const org = session.selectedOrgId
        ? userInfo.orgs.find((o) => o.id === session.selectedOrgId)
        : userInfo.orgs[0];
      const project =
        org && session.selectedProjectId
          ? org.projects.find((p) => p.id === session.selectedProjectId)
          : org?.projects[0];
      appId =
        project?.environments
          ?.slice()
          .sort((a, b) => a.rank - b.rank)
          .find((e) => e.app?.id)?.app?.id ?? null;
      if (appId) session.selectedAppId = appId;
    } catch (err) {
      logToFile(
        `[pollForDataIngestion] could not resolve appId: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  if (!appId) {
    logToFile('[pollForDataIngestion] no appId — skipping ingestion check');
    return;
  }

  const ui = getUI();
  ui.pushStatus('Waiting for events — run your app and trigger some actions');

  const deadline = Date.now() + MAX_WAIT_MS;
  let pollCount = 0;
  // Bound each individual MCP poll. Without this, a single hung fetch would
  // never resolve and the poll loop would advance only once the surrounding
  // process tore down, leaving the request stuck in the background.
  const PER_POLL_TIMEOUT_MS = 25_000;
  // Bail out of the poll loop the moment the wizard is cancelled
  // (Ctrl+C / SIGINT → graceful-exit → abortWizard). Without this a long
  // inter-poll setTimeout would block the 2s grace window for nearly the
  // full wait duration, so the user would either see a hung exit or the kernel would
  // SIGKILL the process before the poll resolved.
  const wizardSignal = getWizardAbortSignal();

  while (Date.now() < deadline) {
    if (wizardSignal.aborted) {
      logToFile('[pollForDataIngestion] aborted via wizard signal');
      return;
    }
    pollCount++;
    logToFile(`[pollForDataIngestion] poll #${pollCount} appId=${appId}`);

    // Per-poll AbortController — wired through to fetchHasAnyEventsMcp so
    // the in-flight HTTP request unwinds when the poll deadline fires
    // (rather than running to completion in the background).
    const pollController = new AbortController();
    const pollTimer = setTimeout(
      () => pollController.abort(),
      PER_POLL_TIMEOUT_MS,
    );
    try {
      // Pass the per-poll signal so the explicit per-poll timeout aborts
      // the in-flight HTTP request. callAmplitudeMcp also defaults to the
      // wizard signal when no explicit signal is provided; here we use the
      // per-poll signal and rely on the loop-level wizardSignal checks
      // (above and in the inter-poll wait below) to honor Ctrl+C.
      const result = await fetchHasAnyEventsMcp(
        accessToken,
        appId,
        pollController.signal,
      );
      if (result.hasEvents) {
        logToFile(
          `[pollForDataIngestion] events detected: ${result.activeEventNames.join(
            ', ',
          )}`,
        );
        // Emit a structured result event so callers can act on it.
        ui.setEventIngestionDetected(result.activeEventNames);
        ui.log.success(
          `Events detected: ${
            result.activeEventNames.length > 0
              ? result.activeEventNames.join(', ')
              : '(events flowing)'
          }`,
        );
        // Route through the UI layer so React subscribers (the
        // DataIngestionCheckScreen → next-screen transition) observe the
        // change. Direct `session.dataIngestionConfirmed = true` mutates
        // the field but never bumps `$version`, so the TUI router stays
        // on verification until a terminal resize forces a re-render.
        ui.markDataIngestionConfirmed();
        return;
      }
    } catch (err) {
      logToFile(
        `[pollForDataIngestion] poll error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      // Always clear the per-poll timer so a fast success/failure doesn't
      // leak ~30 minutes' worth of stranded timers across the loop.
      clearTimeout(pollTimer);
    }

    // Wait before the next poll, but bail early if deadline passed
    // OR if the wizard is cancelled. Race the timer with the abort
    // signal so a Ctrl+C unblocks immediately instead of waiting up
    // to the inter-poll delay for the next iteration to see the flag.
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    if (wizardSignal.aborted) {
      logToFile('[pollForDataIngestion] aborted via wizard signal');
      return;
    }
    const waitMs = Math.min(interPollWaitMs, remaining);
    // Surface the inter-poll wait on the activity line — without this the
    // user sees nothing for the full backoff cycle (5-30s). Cleared after
    // the wait; the next poll tick refreshes the line.
    try {
      const waitSec = Math.max(1, Math.round(waitMs / 1000));
      ui.setCurrentActivity({
        kind: 'ingestion-poll',
        message: `Waiting for events to reach Amplitude (polling every ${waitSec}s). Trigger an action in your app to send an event.`,
        startedAt: Date.now(),
        estimatedDurationSec: waitSec,
      });
    } catch (err) {
      logToFile('[pollForDataIngestion] setCurrentActivity failed', err);
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wizardSignal.removeEventListener('abort', onAbort);
        resolve();
      }, waitMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      wizardSignal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      ui.setCurrentActivity(null);
    } catch (err) {
      logToFile('[pollForDataIngestion] clear activity failed', err);
    }
    interPollWaitMs = nextDataIngestionPollWaitMs(interPollWaitMs);
  }

  if (wizardSignal.aborted) {
    logToFile('[pollForDataIngestion] aborted via wizard signal');
    return;
  }

  logToFile('[pollForDataIngestion] timeout reached without detecting events');
  ui.log.warn(
    'No events detected within the timeout window. ' +
      'Run your app to send events, then check your Amplitude dashboard.',
  );
}

/**
 * Append per-feature instructions for any inline features the user opted into.
 * Returns an empty string when no inline features are queued.
 */
function buildInlineFeatureSection(
  queue: readonly AdditionalFeature[],
): string {
  const inline = queue.filter((f) => INLINE_FEATURES.has(f));
  if (inline.length === 0) return '';

  const items = inline
    .map(
      (f) =>
        `### ${ADDITIONAL_FEATURE_LABELS[f]}\n${ADDITIONAL_FEATURE_PROMPTS[f]}`,
    )
    .join('\n\n');

  return `

ADDITIONAL FEATURES (configure as part of SDK initialization):

The user has opted in to additional Amplitude features. Configure these as part of the SDK initialization step — in the same initAll() call where applicable — rather than as a separate task. Update the relevant TodoWrite task name to reflect what you're doing.

${items}
`;
}

/**
 * Build the integration prompt for the agent.
 *
 * `preStagedIntegrationSkillId` is the integration skill id chosen before the
 * agent runs: normally the bundled copy the runner pre-staged under
 * `.claude/skills/<id>/`, or — when staging missed — the same id picked by
 * `resolveIntegrationSkillId` (integration-skill-resolve) from on-disk `integration-*`
 * directories so STEP 1 is always a single deterministic path (never a Glob
 * disambiguation for the model). When null, no integration skill could be
 * resolved and the agent should halt with `report_status`.
 *
 * Taxonomy + instrumentation + dashboard skills are always pre-staged when
 * bundled, so the prompt loads them by ID without menu/install steps.
 */
function buildIntegrationPrompt(
  config: FrameworkConfig,
  context: {
    frameworkVersion: string;
    typescript: boolean;
    projectApiKey: string;
    host: string;
    appId: number;
    cloudRegion: 'us' | 'eu';
  },
  frameworkContext: Record<string, unknown>,
  skipAmplitudeMcp: boolean,
  preStagedIntegrationSkillId: string | null,
): string {
  if (config.prompts.buildPrompt) {
    return config.prompts.buildPrompt({
      ...context,
      frameworkContext,
    });
  }

  // No valid auth token → MCP will be skipped. Fall back to the generic direct prompt
  // so the agent has actionable instructions instead of getting stuck on ListMcpResourcesTool.
  if (skipAmplitudeMcp) {
    const genericBuildPrompt = GENERIC_AGENT_CONFIG.prompts.buildPrompt;
    if (!genericBuildPrompt) {
      throw new Error('Generic agent config is missing buildPrompt');
    }
    return genericBuildPrompt({ ...context, frameworkContext });
  }

  // Region-aware app URL — the dashboard / chart links the agent surfaces in
  // the setup report MUST use the user's data-center hostname. Without this,
  // EU users got dashboard URLs at `app.amplitude.com/...` (US) because the
  // skill examples are written against US hosts and the agent had nothing
  // telling it the run was EU.
  const appHost =
    context.cloudRegion === 'eu'
      ? 'https://app.eu.amplitude.com'
      : 'https://app.amplitude.com';

  // The wizard's appId is 0 when the env picker couldn't match an app to the
  // chosen API key (manual API-key entry, or backend_fetch returning a key
  // that's not in the picker's environments). When that happens, the agent
  // should look up the canonical project for the API key via the Amplitude
  // MCP's `get_context` and use ITS `defaultAppId` — never browse the
  // `appsByCategory` list and pick a different project. Pre-PR the agent
  // routinely picked the wizard team's own dev project (802868) and created
  // dashboards there; the user's setup report linked to a project they
  // don't own.
  // Note: this run no longer creates charts or dashboards — DEFER_DASHBOARD_PLAN
  // PR 4 moved that work to the deferred `amplitude-wizard dashboard` command.
  // The appId guidance is still load-bearing for the wizard's `record_dashboard_plan`
  // hand-off (which writes the orgId/projectId pair into the persisted plan) and
  // for any read-only Amplitude MCP probes the integration skill might do.
  const appIdGuidance =
    context.appId === 0
      ? `- Amplitude App ID: not set by the wizard (0). If you need the appId for any read-only Amplitude MCP probe or for the deferred-dashboard hand-off, get it from \`get_context().defaultAppId\` — that's the project tied to the API key above. NEVER pick a different appId from \`appsByCategory\` or any other listing in the get_context response. If \`defaultAppId\` is missing or null, halt with report_status kind="error", code="RESOURCE_MISSING", detail="Could not resolve project from API key" — do not guess. (Note: do not create charts or dashboards in this run — those are owned by the deferred \`amplitude-wizard dashboard\` command.)`
      : `- Amplitude App ID (shown in Amplitude UI as "Project ID"): ${context.appId}. Use this appId for any deferred-dashboard plan hand-off you persist. Do NOT call \`get_context\` to pick a different one — the wizard already resolved it and the API key above belongs to this project. (Note: do not create charts or dashboards in this run — those are owned by the deferred \`amplitude-wizard dashboard\` command.)`;

  const additionalLines = config.prompts.getAdditionalContextLines
    ? config.prompts.getAdditionalContextLines(frameworkContext)
    : [];

  const additionalContext =
    additionalLines.length > 0
      ? '\n' + additionalLines.map((line) => `- ${line}`).join('\n')
      : '';

  // Integration-skill block: single pinned id from staging + resolver, or halt.
  const integrationSkillStep = preStagedIntegrationSkillId
    ? `STEP 1: Load \`.claude/skills/${preStagedIntegrationSkillId}/SKILL.md\` via the Skill tool. The wizard already resolved a single integration skill id (\`${preStagedIntegrationSkillId}\`) for this ${config.metadata.name} run (bundled pre-stage when possible, otherwise a deterministic on-disk resolver — not Glob-based disambiguation). Do NOT call load_skill_menu or install_skill (they are not available on the wizard-tools server).`
    : `STEP 1: Integration workflow — wizard-tools \`load_skill_menu\` / \`install_skill\` are **not registered** in this CLI; do not call them (they will fail or be absent from the tool list).

   The taxonomy and instrumentation skills are already under \`.claude/skills/\` for this run, but the runner could not resolve any \`integration-*\` skill id for ${config.metadata.name} (nothing bundled/pre-staged and no matching \`.claude/skills/integration-*/SKILL.md\` on disk).

   Call \`report_status\` with kind="error", code="RESOURCE_MISSING", detail="No integration skill could be resolved for this framework." and halt.`;

  const skillsIntro = preStagedIntegrationSkillId
    ? `The wizard has pre-staged supporting skills into \`.claude/skills/\` and pinned one integration skill id for this run — load them with the Skill tool. Do NOT call load_skill_menu or install_skill (disabled).`
    : `The wizard has pre-staged taxonomy and instrumentation skills into \`.claude/skills/\` (load with the Skill tool). STEP 1 explains the integration workflow — do NOT call load_skill_menu or install_skill (disabled).`;

  return `You are setting up Amplitude analytics in this ${
    config.metadata.name
  } project. ${skillsIntro}

Early in the run (before env wiring and again before confirm_event_plan), load \`.claude/skills/wizard-prompt-supplement/SKILL.md\` via the Skill tool and \`Read\` the reference files it lists for your phase — they hold long-form contracts intentionally kept out of the static commandments (API keys, event-plan shape, setup report, lint scoping rationale, and browser SDK init tables when applicable).

Project context:
${appIdGuidance}
- Framework: ${config.metadata.name} ${context.frameworkVersion}
- TypeScript: ${context.typescript ? 'Yes' : 'No'}
- Amplitude public token: ${context.projectApiKey}
- Amplitude Host: ${context.host}
- Data region: ${context.cloudRegion.toUpperCase()} — every Amplitude UI link you write into the setup report (dashboard URL, chart URLs, project settings) MUST use \`${appHost}\` as the host. Do NOT use \`https://app.amplitude.com\` for an EU run, or vice versa; mismatched hosts redirect to the wrong data center and the user sees an empty project.
- Project type: ${config.prompts.projectTypeDetection}
- Package installation: ${
    config.prompts.packageInstallation ?? DEFAULT_PACKAGE_INSTALLATION
  }${additionalContext}

Instructions (follow in order — your **system prompt commandments** carry the cross-cutting rules: TodoWrite checklist labels, Bash/env policy, parallel discovery, \`confirm_event_plan\` + \`.amplitude/events.json\`, setup report + \`<wizard-report>\`, MCP \`reason\` on every wizard-tools call, and package-install background tasks. Do not contradict them):

${integrationSkillStep}

STEP 2: Run the integration skill's numbered workflow reference files in order (e.g. \`1.0-*\`, \`1.1-*\`, …). Never paste secrets into source — use env vars; details live in commandments + \`wizard-prompt-supplement/references/api-keys-and-env.md\`.

STEP 3–4 (env + instrumentation): After STEP 1–2, execute the phased work those skills describe. Load pre-staged skills by filesystem path with the Skill tool — \`.claude/skills/amplitude-quickstart-taxonomy-agent/SKILL.md\` and \`.claude/skills/add-analytics-instrumentation/SKILL.md\` — and follow each skill's workflow. Do **not** call \`load_skill_menu\` / \`install_skill\` for these IDs. Autocapture overlap and \`confirm_event_plan\` timing are specified in \`wizard-prompt-supplement/references/\` (see the supplement SKILL index).

Chart + dashboard creation are NOT part of this run — they happen in a separate \`amplitude-wizard dashboard\` command after event ingestion catches up. Do not load \`amplitude-chart-dashboard-plan\`, do not call \`record_dashboard\` / \`create_chart\` / \`create_dashboard\` / \`query_dataset\` / \`save_chart_edits\` / any Amplitude MCP chart or dashboard tool. If your taxonomy work surfaces a clear chart strategy, you MAY (optionally) call the wizard-tools \`record_dashboard_plan\` tool ONCE at the very end of the run to hand the plan off to the deferred command — but do not block instrumentation on it. STOP after the setup report is written; \`wire\` is the terminal step.

`;
}

/**
 * Push the agent's instrumented event plan into the Amplitude tracking plan as
 * planned events. Returns an outro-ready summary string (empty if nothing was
 * committed). Never throws — a failure here must not block the outro.
 *
 * Owns its post-agent step lifecycle: marks the `commit-events` step
 * `in_progress` on entry and `completed` / `skipped` (with reason) on
 * exit so the FinalizingPanel reflects real outcomes. Failures emit
 * `analytics.wizardCapture` breadcrumbs + `ui.log.warn` so silent
 * skips never go unaccounted for.
 *
 * Falls back to `session.selectedAppId` and finally a (single-retried)
 * `fetchAmplitudeUser` lookup when `session.credentials.appId` is 0 —
 * the env picker couldn't match an app to the chosen API key.
 */
async function commitPlannedEventsStep(
  plannedEvents: Array<{ name: string; description: string }>,
  accessToken: string,
  credentialsAppId: number | null | undefined,
  session: WizardSession,
  cloudRegion: string,
): Promise<string> {
  const ui = getUI();
  ui.setPostAgentStep(POST_AGENT_STEP_COMMIT_EVENTS, { status: 'in_progress' });

  // Pure local guard — `no events` is a benign skip (the agent
  // instrumented nothing this run), distinct from the appId-failure
  // skip below. Surface it as `skipped` with a soft reason so the user
  // sees ⊘ rather than ✓ — the wizard didn't commit anything to their
  // tracking plan.
  if (!plannedEvents || plannedEvents.length === 0) {
    logToFile('[commitPlannedEventsStep] no planned events — skipping');
    ui.setPostAgentStep(POST_AGENT_STEP_COMMIT_EVENTS, {
      status: 'skipped',
      reason: 'no events instrumented',
    });
    return '';
  }

  let appId: string | number | null | undefined = credentialsAppId;
  if (!appId) appId = session.selectedAppId;
  if (!appId) {
    appId = await resolveAppIdViaUserApi(session, accessToken, cloudRegion);
    if (appId) session.selectedAppId = String(appId);
  }

  if (!appId) {
    // Loud failure — the wizard otherwise reports success but the
    // tracking plan stays empty. Capture telemetry so we can size the
    // bug, and log a warn the user actually sees in the FinalizingPanel
    // / NDJSON / CI log.
    logToFile('[commitPlannedEventsStep] no appId — skipping');
    analytics.wizardCapture('planned events skipped', {
      reason: 'no app id',
      'planned events count': plannedEvents.length,
    });
    ui.log.warn(
      "Couldn't save your event plan to Amplitude — your tracked events still flow once they fire, but the planned-events list won't pre-populate the Data tab. Re-run the wizard if this is unexpected.",
    );
    ui.setPostAgentStep(POST_AGENT_STEP_COMMIT_EVENTS, {
      status: 'skipped',
      reason: "couldn't resolve project",
    });
    return '';
  }

  try {
    const { commitPlannedEvents } = await import('./planned-events.js');
    logToFile(
      `[commitPlannedEventsStep] committing ${plannedEvents.length} planned events to appId=${appId}`,
    );
    const result = await commitPlannedEvents({
      accessToken,
      appId: String(appId),
      events: plannedEvents,
      zone: cloudRegion === 'eu' ? 'eu' : 'us',
    });

    analytics.wizardCapture('planned events committed', {
      attempted: result.attempted,
      created: result.created,
      described: result.described,
      'error message': result.error ?? '',
    });

    logToFile(
      `[commitPlannedEventsStep] result attempted=${result.attempted} created=${
        result.created
      } described=${result.described} error=${result.error ?? ''}`,
    );

    if (result.created === 0) {
      ui.setPostAgentStep(POST_AGENT_STEP_COMMIT_EVENTS, {
        status: 'skipped',
        reason: result.error ?? 'tracking plan write unavailable',
      });
      return '';
    }
    ui.setPostAgentStep(POST_AGENT_STEP_COMMIT_EVENTS, { status: 'completed' });
    const eventWord = result.created === 1 ? 'event' : 'events';
    return `Added ${result.created} planned ${eventWord} to your tracking plan`;
  } catch (err) {
    logToFile(
      `[commitPlannedEventsStep] unexpected error: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    ui.setPostAgentStep(POST_AGENT_STEP_COMMIT_EVENTS, {
      status: 'skipped',
      reason: 'unexpected error',
    });
    return '';
  }
}

/**
 * Resolve the numeric app id via the Data API GraphQL endpoint, with a
 * single retry on transient network/auth failure. Returns null if the
 * call fails twice or the user's selected project has no environment
 * with an app yet.
 *
 * Pulled out of the inline appId-resolution chain so the failure
 * message logs a single line per attempt and the retry doesn't
 * duplicate the catch block. The retry covers the single most common
 * failure mode we see in practice — a stale OAuth token that the
 * post-run refresh just rotated, where the first call races the new
 * token's propagation.
 */
async function resolveAppIdViaUserApi(
  session: WizardSession,
  accessToken: string,
  cloudRegion: string,
): Promise<string | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { fetchAmplitudeUser } = await import('./api.js');
      const userInfo = await fetchAmplitudeUser(
        accessToken,
        cloudRegion as 'us' | 'eu',
      );
      const org = session.selectedOrgId
        ? userInfo.orgs.find((o) => o.id === session.selectedOrgId)
        : userInfo.orgs[0];
      const ws =
        org && session.selectedProjectId
          ? org.projects.find((w) => w.id === session.selectedProjectId)
          : org?.projects[0];
      const appId =
        ws?.environments
          ?.slice()
          .sort((a, b) => a.rank - b.rank)
          .find((e) => e.app?.id)?.app?.id ?? null;
      if (appId) return String(appId);
      // Got a valid response but no env had an app — re-trying won't help.
      return null;
    } catch (err) {
      logToFile(
        `[commitPlannedEventsStep] fetchAmplitudeUser attempt ${attempt} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      if (attempt === 2) return null;
      // Tiny backoff before the retry; transient failures we see in logs
      // resolve well within ~500ms.
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return null;
}
