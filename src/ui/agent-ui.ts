/**
 * AgentUI — NDJSON implementation of WizardUI for --agent mode.
 * Every method emits one JSON line to stdout for machine consumption.
 * Prompts auto-approve; no interactivity.
 */

import type { WizardUI, SpinnerHandle, EventPlanDecision } from './wizard-ui';
import type {
  RetryState,
  PostAgentStep,
  WizardActivity,
} from '../lib/wizard-session';
import type {
  AgentEventType,
  NeedsInputChoice,
  NeedsInputData,
  NeedsInputWireData,
  InnerAgentStartedData,
  ToolCallData,
  ToolResponseData,
  FileChangePlannedData,
  FileChangeAppliedData,
  EventPlanProposedData,
  EventPlanConfirmedData,
  VerificationStartedData,
  VerificationResultData,
  SetupContextData,
  SetupCompleteData,
  FileChangeErrorClass,
  ColdStartPhase,
  MCPStatusServer,
  MCPStatusState,
} from '../lib/agent-events';
import {
  EVENT_DATA_VERSIONS,
  TOOL_RESPONSE_CONTENT_HEAD_MAX_BYTES,
  TOOL_RESPONSE_ERROR_MESSAGE_MAX_BYTES,
  TOOL_RESPONSE_SUMMARY_MAX_CHARS,
  buildColdStartBreakdown,
  buildProgressEstimate,
  classifyModel,
  classifyRunError,
  nextDecisionId,
  ToolCallStats,
  truncateLogMessage,
  truncateToBytes,
  type RecoverableHint,
  type SuggestedAction,
  type ToolCallOutcome,
} from '../lib/agent-events';
import { registerSetupComplete } from '../lib/setup-complete-registry';
import { createInterface } from 'readline';
import { z } from 'zod';
import { installPipeErrorHandlers, safePipeWrite } from '../utils/pipe-errors';
import { toWizardDashboardOpenUrl } from '../utils/dashboard-open-url';

// Belt-and-suspenders: bin.ts also installs these. Idempotent, so a
// second call from this module covers test harnesses and any other
// entry point that imports AgentUI without going through bin.ts.
installPipeErrorHandlers();

/**
 * Stdin response schema for `promptEnvironmentSelection`.
 *
 * External input (from AI orchestrators) — parse with zod rather than an
 * `as` cast so bad shapes get rejected instead of silently falling through
 * to auto-select.
 *
 * Canonical shape: `{ appId }`.
 */
const EnvSelectionStdinSchema = z.object({
  appId: z.string().optional(),
});
type EnvSelectionStdin = z.infer<typeof EnvSelectionStdinSchema>;

/** Flat choice shape exposed in the prompt event and matched against stdin. */
export interface EnvSelectionChoice {
  orgId: string;
  orgName: string;
  projectId: string;
  projectName: string;
  appId: string | null;
  envName: string;
  rank: number;
  label: string;
}

/** Resolved selection returned from the env-selection prompt. */
export interface EnvSelection {
  orgId: string;
  projectId: string;
  env: string;
}

/**
 * Structured outcome of interpreting a parsed stdin payload against the
 * available choices. Pulled out as a pure function so the matching /
 * rejection logic can be unit-tested without stdin or readline mocks.
 *
 * - `kind: 'selected'` — a valid matching selector was provided.
 * - `kind: 'auto'` — no selector (empty object / missing fields); caller
 *   should auto-select the first environment.
 * - `kind: 'mismatch'` — a selector was provided but didn't match any
 *   choice; caller MUST NOT silently auto-select (throw / error).
 * - `warnings` — deprecation notices the caller should surface as log events.
 */
export type EnvSelectionResolution =
  | {
      kind: 'selected';
      selection: EnvSelection;
      warnings: string[];
    }
  | {
      kind: 'auto';
      warnings: string[];
    }
  | {
      kind: 'mismatch';
      reason: string;
      warnings: string[];
    };

export function resolveEnvSelectionFromStdin(
  parsed: EnvSelectionStdin | null,
  choices: EnvSelectionChoice[],
): EnvSelectionResolution {
  const warnings: string[] = [];
  if (!parsed) return { kind: 'auto', warnings };

  const selectedAppId = parsed.appId;
  if (selectedAppId) {
    const match = choices.find(
      (c) => String(c.appId) === String(selectedAppId),
    );
    if (match) {
      return {
        kind: 'selected',
        selection: {
          orgId: match.orgId,
          projectId: match.projectId,
          env: match.envName,
        },
        warnings,
      };
    }
    return {
      kind: 'mismatch',
      reason: `Environment selection appId=${selectedAppId} did not match any of the ${choices.length} available environments.`,
      warnings,
    };
  }

  // Parsed an object with no usable selector — treat like no input.
  return { kind: 'auto', warnings };
}

/**
 * Parse one JSON line from the agent orchestrator. Returns a structured
 * result with any zod rejection issues so the caller can surface them as
 * warning logs. Exported for unit tests.
 */
export function parseEnvSelectionStdinLine(line: string | null | undefined): {
  parsed: EnvSelectionStdin | null;
  rejectionMessage: string | null;
} {
  if (!line) return { parsed: null, rejectionMessage: null };
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return {
      parsed: null,
      rejectionMessage:
        'Environment-selection stdin response is not valid JSON.',
    };
  }
  const result = EnvSelectionStdinSchema.safeParse(raw);
  if (!result.success) {
    return {
      parsed: null,
      rejectionMessage: `Environment-selection stdin response rejected: ${result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    };
  }
  return { parsed: result.data, rejectionMessage: null };
}

/**
 * Wire-level cap on the number of environment choices we ship to an
 * orchestrator on a single `needs_input: environment_selection` /
 * `prompt: environment_selection` event. Dogfood accounts can carry
 * 300+ environments — including all of them in the NDJSON envelope
 * inflated a single line to ~600 KB and made the picker UX brittle in
 * orchestrators that use a fixed-size buffer. 50 is comfortably
 * larger than the 95th-percentile org's env count and small enough
 * to render in a searchable picker without scrolling.
 *
 * Above-cap accounts get `pagination.total > pagination.returned`
 * plus the `manualEntry` hint so an orchestrator can prompt the user
 * for `--app-id <id>` directly.
 */
export const MAX_ENV_SELECTION_CHOICES = 50;

// ── NDJSON event types ──────────────────────────────────────────────

interface NDJSONEvent {
  v: 1;
  '@timestamp': string;
  type: AgentEventType;
  message: string;
  session_id?: string;
  run_id?: string;
  /**
   * Per-event-type data-shape version. See `EVENT_DATA_VERSIONS` in
   * `src/lib/agent-events.ts` — orchestrators branch on this to
   * handle breaking changes to `data` without forcing a global
   * envelope-version bump on every change.
   */
  data_version?: number;
  data?: unknown;
  level?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

// Lazy imports to avoid circular dependencies at module load time.
let _getSessionId: (() => string) | null = null;
let _getRunId: (() => string) | null = null;
function getCorrelationIds(): { session_id: string; run_id: string } {
  if (!_getSessionId) {
    try {
      const mod = require('../lib/observability/correlation') as {
        getSessionId: () => string;
        getRunId: () => string;
      };
      _getSessionId = mod.getSessionId;
      _getRunId = mod.getRunId;
    } catch {
      _getSessionId = () => 'unknown';
      _getRunId = () => 'unknown';
    }
  }
  return { session_id: _getSessionId(), run_id: _getRunId!() };
}

/**
 * Look up the per-event-type data-shape version from the registry,
 * keyed off the `data.event` discriminator. Returns `undefined` for
 * events whose `data` shape isn't part of the orchestrator-facing
 * contract (free-form `log`, `status`, `progress` payloads). Caller
 * can override by passing `dataVersion` explicitly via `extra`.
 */
function lookupDataVersion(
  data: unknown,
  explicit: number | undefined,
): number | undefined {
  if (explicit !== undefined) return explicit;
  if (typeof data !== 'object' || data === null) return undefined;
  const eventKey = (data as { event?: unknown }).event;
  if (typeof eventKey !== 'string') return undefined;
  const registry = EVENT_DATA_VERSIONS as Readonly<Record<string, number>>;
  return registry[eventKey];
}

/**
 * Emit a `decision_auto` companion event after a `needs_input` whose
 * caller auto-resolved the prompt. Lets orchestrators distinguish
 * "this awaits a human answer" (needs_input alone) from "the wizard
 * already picked one for you" (needs_input + decision_auto).
 *
 * The `reason` field is forward-looking: today we always emit
 * `auto_approve` because every prompt path auto-resolves. Future
 * wiring (when we honor `--auto-approve` strictly) will add
 * `back_compat` (the `--agent` implies-autoApprove path) so
 * orchestrators can detect and migrate away from the implicit grant.
 *
 * `decisionId` MUST be the value returned by the matching
 * `emitNeedsInput` call. Callers obtain it from `emitNeedsInput`'s
 * return value rather than minting their own — this is the
 * single-writer invariant that keeps ids monotonic and unique.
 */
function emitDecisionAuto(data: {
  code: string;
  decisionId: string;
  value: unknown;
  reason: 'auto_approve' | 'back_compat';
}): void {
  emit(
    'lifecycle',
    `decision_auto: ${data.code}=${String(data.value)} (${data.decisionId})`,
    {
      data: {
        event: 'decision_auto',
        code: data.code,
        decisionId: data.decisionId,
        value: data.value,
        reason: data.reason,
      },
    },
  );
}

/**
 * Lazily-resolved string redactor. Pulled lazily because the observability
 * module imports `process.env` at load time to capture redaction values, and
 * we don't want to force that load order at module init.
 *
 * Used as a final wire-boundary scrub: every emitted NDJSON line gets a pass
 * through `redactString` so a misbehaving caller that put `WIZARD_OAUTH_TOKEN`
 * (or any other tracked env-value secret) into a free-form `message` field
 * can't leak it to stdout. Redaction is idempotent and safe on already-clean
 * lines.
 */
let _ndjsonRedactor: ((s: string) => string) | null = null;
function getNdjsonRedactor(): (s: string) => string {
  if (_ndjsonRedactor) return _ndjsonRedactor;
  try {
    const mod = require('../lib/observability/redact') as {
      redactString: (s: string) => string;
    };
    _ndjsonRedactor = mod.redactString;
  } catch {
    // Fallback identity — never crash the emitter on a missing redactor.
    _ndjsonRedactor = (s: string) => s;
  }
  return _ndjsonRedactor;
}

/**
 * Zod schema validating the wire-boundary envelope shape. Intentionally
 * structural (not a per-event-type discriminated union) so we get
 * defense-in-depth on the framing layer without locking the validation
 * cost to O(N) discriminator branches. Per-event-type shapes are
 * documented in `agent-events.ts`; the registry-vs-discriminator
 * coherence check happens below in `validateEnvelopeOrLog`.
 *
 * Permissive shape: every event MUST have `v=1`, an ISO timestamp,
 * the typed `type`, and a string `message`. `data` is unknown — we
 * narrow further only when it carries an `event` discriminator.
 */
const agentEventSchema = z.object({
  v: z.literal(1),
  '@timestamp': z.string(),
  type: z.enum([
    'lifecycle',
    'log',
    'status',
    'progress',
    'session_state',
    'prompt',
    'needs_input',
    'diagnostic',
    'result',
    'error',
  ]),
  message: z.string(),
  session_id: z.string().optional(),
  run_id: z.string().optional(),
  level: z.enum(['info', 'warn', 'error', 'success', 'step']).optional(),
  data_version: z.number().optional(),
  data: z.unknown().optional(),
});

/**
 * Per-event Zod schema for `mcp_status` `data` payloads. The
 * envelope-level `agentEventSchema` checks the outer frame only; this
 * adds defense-in-depth to the MCP lifecycle event so a misbehaving
 * caller that ships an invalid `(server, state)` pair gets caught at
 * the emit boundary rather than poisoning the orchestrator's parser.
 *
 * Kept in the AgentUI file (not in `agent-events.ts`) because the
 * shared types module is import-cycle-sensitive — adding zod usage
 * there pulls the SDK dependency into every consumer of the agent-
 * events type bag, including the lightweight TUI screens that don't
 * need it.
 */
const mcpStatusDataSchema = z.object({
  server: z.enum(['wizard_tools', 'editor_install']),
  state: z.enum([
    'unavailable',
    'available',
    'needs_auth',
    'needs_install',
    'needs_user_choice',
    'install_skipped',
    'installed',
    'failed',
    'not_applicable',
  ]),
  transition_ts: z.number().int().nonnegative(),
  detail: z.string().optional(),
});

/**
 * Per-event Zod schema for `tool_response` `data` payloads. The
 * envelope-level `agentEventSchema` checks the outer frame only;
 * this adds defense-in-depth on the tool-outcome event so a
 * misbehaving caller (negative durations, invalid outcome literals,
 * over-cap strings) gets caught at the emit boundary rather than
 * poisoning the orchestrator's parser. Caps mirror the registry
 * constants in `agent-events.ts` so the wire contract and the test
 * suite share one source of truth.
 */
const toolResponseDataSchema = z.object({
  tool: z.string(),
  id: z.string().optional(),
  outcome: z.enum(['success', 'error', 'denied']),
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().optional(),
  contentHead: z.string().optional(),
  isError: z.boolean(),
  errorMessage: z.string().optional(),
  summary: z.string().optional(),
});

/**
 * Validate the envelope just before it lands on stdout. Failures
 * route to the on-disk log (`logToFile`) — NEVER to stderr (Ink owns
 * stdout in TUI mode and stderr would interleave with NDJSON), NEVER
 * throwing (a bad envelope must not crash the wizard mid-run).
 *
 * In addition to the structural shape, this also asserts:
 *  - When `data.event` is set, the `data_version` matches the
 *    registry entry — catches "I added a new event but forgot to
 *    register its version" regressions.
 *  - The `event` discriminator on `data` is a string (some failure
 *    modes set it to numbers / booleans).
 *
 * Returns the validated event (or the original envelope when
 * validation fails — we still EMIT, just with a log trail of the
 * defect so the bug is fixable without losing data on the wire).
 */
function validateEnvelopeOrLog(event: NDJSONEvent): NDJSONEvent {
  const parsed = agentEventSchema.safeParse(event);
  if (!parsed.success) {
    try {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      logToFileLazy(
        `[agent-ui] NDJSON envelope failed schema validation — wire format invariant breached. issues=${issues}; event.type=${
          event.type
        }; event.message=${event.message.slice(0, 80)}`,
      );
    } catch {
      // Logger may not be available; never throw from emit.
    }
    return event;
  }

  // Coherence check: registry value must match data_version when
  // the event has a discriminator. A v1 schema bump that lands on
  // disk without a corresponding registry update shows up as an
  // assertion log here. Single source of truth: EVENT_DATA_VERSIONS.
  if (
    typeof event.data === 'object' &&
    event.data !== null &&
    typeof (event.data as { event?: unknown }).event === 'string'
  ) {
    const discriminator = (event.data as { event: string }).event;
    const registry = EVENT_DATA_VERSIONS as Readonly<Record<string, number>>;
    const expected = registry[discriminator];
    if (expected !== undefined && event.data_version !== expected) {
      try {
        logToFileLazy(
          `[agent-ui] data_version mismatch on '${discriminator}': expected ${expected} from EVENT_DATA_VERSIONS, got ${event.data_version}. Bump EVENT_DATA_VERSIONS or update the emitter.`,
        );
      } catch {
        // never throw from emit
      }
    }
  }

  return event;
}

/**
 * Lazy debug logger. Pulled lazily because eager imports of
 * `../utils/debug` in this module pull in the full debug log machinery
 * (file rotation, redaction, mtime checks) at module init — slow on a
 * cold start. We only need the helper when an envelope is bad.
 */
let _logToFile: ((msg: string) => void) | null = null;
function logToFileLazy(msg: string): void {
  if (!_logToFile) {
    try {
      const mod = require('../utils/debug') as {
        logToFile: (msg: string) => void;
      };
      _logToFile = mod.logToFile;
    } catch {
      _logToFile = () => undefined;
    }
  }
  _logToFile(msg);
}

function emit(
  type: AgentEventType,
  message: string,
  extra?: Omit<NDJSONEvent, 'v' | '@timestamp' | 'type' | 'message'>,
): void {
  const { session_id, run_id } = getCorrelationIds();
  const data_version = lookupDataVersion(extra?.data, extra?.data_version);
  // Truncate `log` and `error` messages so a misbehaving caller can't
  // blow up orchestrator parsers with a multi-KB SSE-body dump. Both
  // types can carry exception text from the inner Claude SDK (whose
  // failure paths sometimes serialize the entire failing SSE stream
  // into a single string). Other event types (lifecycle / status /
  // progress / result / etc.) carry bounded human-readable summaries
  // by construction; capping them would risk losing semantic content.
  // The cap is generous (2KB) to preserve readable error context while
  // preventing the worst-case 50KB+ inner-agent error payloads observed
  // in agent transcripts.
  const shouldTruncate = type === 'log' || type === 'error';
  const safeMessage = shouldTruncate ? truncateLogMessage(message) : message;
  const event: NDJSONEvent = {
    v: 1,
    '@timestamp': new Date().toISOString(),
    type,
    message: safeMessage,
    session_id,
    run_id,
    ...extra,
    // Stamp data_version AFTER spreading `extra` so the lookup result
    // wins over any (unintentional) undefined in `extra`. Drop the
    // key entirely when undefined so events without a registered
    // shape don't ship `"data_version": undefined` (which JSON.stringify
    // omits anyway, but keeping the key absent is clearer in tests).
    ...(data_version !== undefined ? { data_version } : {}),
  };
  // Zod-validate the envelope at the wire boundary. Failures land in
  // the on-disk log (never throw, never stderr — Ink owns stdout) so
  // schema regressions surface as a fixable defect on the next run
  // rather than a silent data corruption on the wire.
  validateEnvelopeOrLog(event);
  // Final wire-boundary scrub: redact env-value secrets (notably
  // WIZARD_OAUTH_TOKEN, supplied as a CI org secret) from anywhere in
  // the serialized line. Cheap on clean lines (a single `includes`
  // check per tracked value), idempotent, and the last line of defense
  // before stdout. Per-callsite redaction in the structured logger
  // already handles most cases; this catches free-form `message`
  // strings and ad-hoc `data` payloads that don't go through the
  // logger.
  const line = getNdjsonRedactor()(JSON.stringify(event)) + '\n';
  // safePipeWrite swallows EPIPE-class errors so a closed receiver
  // doesn't crash the wizard mid-run. The data is silently dropped —
  // there's nothing on the other end to receive it. See pipe-errors.ts.
  safePipeWrite(process.stdout, line);
}

// ── Implementation ──────────────────────────────────────────────────

export class AgentUI implements WizardUI {
  // ── Lifecycle ───────────────────────────────────────────────────────

  intro(message: string): void {
    emit('lifecycle', message, { data: { event: 'intro' } });
  }

  outro(message: string): void {
    emit('lifecycle', message, { data: { event: 'outro' } });
  }

  cancel(message: string, options?: { docsUrl?: string }): Promise<void> {
    emit('lifecycle', message, {
      data: { event: 'cancel', docsUrl: options?.docsUrl },
    });
    // Agent / NDJSON mode has no TUI to render Outro, no human to
    // dismiss anything. Resolve immediately so wizardAbort can proceed
    // straight to its analytics shutdown + process.exit without an
    // artificial wait.
    return Promise.resolve();
  }

  setOutroData(data: import('../lib/wizard-session.js').OutroData): void {
    emit('lifecycle', data.message ?? '', {
      data: { event: 'outro_data', kind: data.kind },
    });
  }

  /**
   * Emit a structured auth_required lifecycle event when the wizard is invoked
   * in --agent mode without valid credentials. Agent orchestrators (Claude
   * Code, Cursor, etc.) can parse the payload, surface the login URL and
   * resume command to the human, and restart the wizard once auth completes.
   *
   * Always paired with process.exit(ExitCode.AUTH_REQUIRED) by the caller.
   */
  emitAuthRequired(data: {
    reason:
      | 'no_stored_credentials'
      | 'token_expired'
      | 'refresh_failed'
      | 'env_selection_failed'
      | 'amplitude_token_expired'
      | 'gateway_token_expired';
    instruction: string;
    loginCommand: string[];
    resumeCommand?: string[];
    /**
     * When `reason === 'env_selection_failed'` and the failure was
     * caused by a scope flag (`--app-id`, `--project-id`, `--env`,
     * `--org`) that didn't match any known environment, this echoes
     * the bad value back so the orchestrator can render a useful
     * "you passed X, here are valid options" prompt without parsing
     * the human-readable `instruction` string.
     */
    previousAttempt?: {
      flag: '--app-id' | '--project-id' | '--env' | '--org';
      value: string;
      reason: string;
    };
    /**
     * Candidate environments to retry against. Identical shape to
     * the `choices` array in the `needs_input: environment_selection`
     * event — orchestrators that already render that picker can reuse
     * the same widget here without re-discovery. Empty / omitted when
     * the failure isn't selection-related.
     *
     * MUST stay in sync with `EnvSelectionChoice` (above). When that
     * canonical shape gains a field, mirror it here so orchestrators
     * that reuse their env-selection widget don't see `undefined` on
     * what should be a present property.
     */
    choices?: Array<{
      orgId: string;
      orgName: string;
      projectId: string;
      projectName: string;
      appId: string | null;
      envName: string;
      rank: number;
      label: string;
    }>;
    /**
     * `true` when the auth failure happened DURING an in-flight agent
     * run (vs the pre-run credential resolution path). Distinct because
     * mid-run failures often have partial side effects (files written,
     * events instrumented) and the orchestrator should advertise
     * `--resume` instead of suggesting a clean restart.
     */
    midRun?: boolean;
    /**
     * `true` when the wizard has decided to preserve any files written
     * before the auth failure. Mirrors the OutroScreen's "Keep" choice
     * in the TUI — an orchestrator should communicate the same intent
     * to the human ("your changes were kept; re-run to resume").
     */
    preserveFiles?: boolean;
    /**
     * Coarse-grained partial-progress flags so the orchestrator can
     * render an honest "X done, Y partial" status to the human without
     * shelling out to inspect the filesystem.
     */
    partialProgress?: {
      eventsInstrumented?: boolean;
      dashboardComplete?: boolean;
    };
    /**
     * Distinguishes the upstream that surfaced the failure: `amplitude`
     * (Amplitude OAuth bearer) vs `llm-gateway` (the Amplitude-hosted
     * LLM gateway's session token). Both manifest as a 401 but their
     * remediation differs — re-running the wizard refreshes the
     * gateway token automatically, while an Amplitude OAuth failure
     * requires `amplitude-wizard login`.
     */
    authSubkind?: 'amplitude' | 'llm-gateway';
  }): void {
    emit('lifecycle', data.instruction, {
      level: 'error',
      data: {
        event: 'auth_required',
        reason: data.reason,
        loginCommand: data.loginCommand,
        resumeCommand: data.resumeCommand,
        ...(data.previousAttempt
          ? { previousAttempt: data.previousAttempt }
          : {}),
        ...(data.choices ? { choices: data.choices } : {}),
        ...(data.midRun ? { midRun: true } : {}),
        ...(data.preserveFiles ? { preserveFiles: true } : {}),
        ...(data.partialProgress
          ? { partialProgress: data.partialProgress }
          : {}),
        ...(data.authSubkind ? { authSubkind: data.authSubkind } : {}),
      },
    });
  }

  /**
   * Emit a structured `error` envelope with a machine-readable `code`
   * discriminator. Used by the explicit AgentErrorType branches in
   * `agent-runner.ts` (GATEWAY_DOWN, RATE_LIMIT, MCP_MISSING, etc.) to
   * give the orchestrator a precise next-step hint without parsing the
   * sanitized message string. Pairs with the subsequent `run_completed`
   * envelope from `wizardAbort`. Wire shape mirrors `setRunError` plus
   * the typed `code` + optional `mcpServer` discriminator.
   */
  emitRunError(data: {
    message: string;
    code:
      | 'GATEWAY_DOWN'
      | 'GATEWAY_INVALID_REQUEST'
      | 'RATE_LIMIT'
      | 'API_ERROR'
      | 'MCP_MISSING'
      | 'RESOURCE_MISSING';
    mcpServer?: 'wizard-tools' | 'amplitude-wizard';
    recoverable?: RecoverableHint;
    suggestedAction?: SuggestedAction;
  }): void {
    emit('error', data.message, {
      level: 'error',
      data: {
        event: 'run_error',
        code: data.code,
        ...(data.mcpServer ? { mcpServer: data.mcpServer } : {}),
        recoverable: data.recoverable ?? 'fatal',
        ...(data.suggestedAction
          ? { suggestedAction: data.suggestedAction }
          : {}),
      },
    });
  }

  /**
   * Emit a `lifecycle: auth_retry_exhausted` event at the SDK
   * retry-loop boundary. Pairs with the eventual AUTH_ERROR /
   * `auth_required` follow-on — sees that exhaustion happened BEFORE
   * the abort lands. See `AuthRetryExhaustedData` in
   * `agent-events.ts`.
   */
  emitAuthRetryExhausted(data: {
    attempts: number;
    subkind?: 'amplitude' | 'llm-gateway';
  }): void {
    emit(
      'lifecycle',
      `auth_retry_exhausted: attempts=${data.attempts}${
        data.subkind ? ` subkind=${data.subkind}` : ''
      }`,
      {
        level: 'warn',
        data: {
          event: 'auth_retry_exhausted',
          attempts: data.attempts,
          ...(data.subkind ? { subkind: data.subkind } : {}),
        },
      },
    );
  }

  /**
   * NDJSON events for the inline create-project flow. Emitted at each phase
   * so orchestrators can track progress. The `apiKey` is intentionally
   * REDACTED from the success payload — only `appId` and `name` are emitted.
   */
  emitProjectCreateStart(data: { orgId: string; name: string }): void {
    emit('lifecycle', `Creating Amplitude project "${data.name}"`, {
      data: {
        event: 'project_create_start',
        orgId: data.orgId,
        name: data.name,
      },
    });
  }

  emitProjectCreateSuccess(data: {
    appId: string;
    name: string;
    orgId: string;
  }): void {
    // SECURITY: apiKey intentionally omitted from NDJSON. The orchestrator
    // can read it from .env.local / the per-user credentials cache if needed.
    emit('result', `project_created: ${data.name}`, {
      data: {
        event: 'project_create_success',
        appId: data.appId,
        name: data.name,
        orgId: data.orgId,
      },
    });
  }

  emitProjectCreateError(data: {
    code:
      | 'NAME_TAKEN'
      | 'QUOTA_REACHED'
      | 'FORBIDDEN'
      | 'INVALID_REQUEST'
      | 'IDEMPOTENCY_CONFLICT'
      | 'INTERNAL'
      | 'MISSING_NAME'
      | 'MISSING_ORG';
    message: string;
    name?: string;
  }): void {
    // Map each code to the canonical remediation. Lets a consuming
    // agent (Claude Code, Cursor, etc.) build a user-facing prompt
    // without writing its own switch statement on top of ours.
    const hint = ((): {
      recoverable: RecoverableHint;
      suggestedAction?: SuggestedAction;
    } => {
      switch (data.code) {
        case 'NAME_TAKEN':
        case 'INVALID_REQUEST':
          return {
            recoverable: 'reinvoke_with_flag',
            suggestedAction: {
              command: ['amplitude-wizard', '--app-name', '<different-name>'],
            },
          };
        case 'MISSING_NAME':
          return {
            recoverable: 'reinvoke_with_flag',
            suggestedAction: {
              command: ['amplitude-wizard', '--app-name', '<your-name>'],
            },
          };
        case 'MISSING_ORG':
          return {
            recoverable: 'reinvoke_with_flag',
            suggestedAction: {
              command: ['amplitude-wizard', '--org', '<org-id>'],
            },
          };
        case 'QUOTA_REACHED':
        case 'FORBIDDEN':
          return { recoverable: 'human_required' };
        case 'IDEMPOTENCY_CONFLICT':
          // Transient — a concurrent create with the same key is in
          // flight. Orchestrators should retry shortly; the proxy
          // resolves the conflict within seconds.
          return { recoverable: 'retry' };
        case 'INTERNAL':
        default:
          return { recoverable: 'retry' };
      }
    })();
    emit('error', data.message, {
      level: 'error',
      data: {
        event: 'project_create_error',
        code: data.code,
        name: data.name,
        recoverable: hint.recoverable,
        ...(hint.suggestedAction
          ? { suggestedAction: hint.suggestedAction }
          : {}),
      },
    });
  }

  /**
   * Emit a structured `signup_input_required` lifecycle event when the
   * wizard is invoked with `--agent --auth-onboarding create-account` but one or more required
   * inputs are missing (region, email, full-name, accept-tos). The
   * orchestrator inspects `missing[]`, prompts the human for the
   * missing values, and re-invokes the wizard with `resumeCommand` plus
   * the gathered flags.
   *
   * Always paired with process.exit(ExitCode.INPUT_REQUIRED) by the caller.
   */
  emitSignupInputsRequired(data: {
    missing: Array<{
      flag: string;
      description: string;
      url?: string;
      pattern?: string;
    }>;
    resumeCommand: string[];
  }): void {
    const flagList = data.missing.map((m) => m.flag).join(', ');
    emit('lifecycle', `Signup requires additional input: ${flagList}`, {
      level: 'error',
      data: {
        event: 'signup_input_required',
        missing: data.missing,
        resumeCommand: data.resumeCommand,
      },
    });
  }

  /**
   * Emit a structured nested_agent lifecycle event when the wizard is
   * invoked from inside another Claude Code / Claude Agent SDK session.
   * The wizard sanitizes inherited Claude env vars before spawning its
   * own SDK subprocess, so nesting is supported — this event is a
   * diagnostic breadcrumb for outer orchestrators, not a failure.
   */
  emitNestedAgent(data: {
    signal: 'claude_code_cli' | 'claude_agent_sdk';
    envVar: string;
    instruction: string;
    bypassEnv: string;
  }): void {
    emit('lifecycle', data.instruction, {
      level: 'info',
      data: {
        event: 'nested_agent',
        signal: data.signal,
        detectedEnvVar: data.envVar,
        bypassEnv: data.bypassEnv,
      },
    });
  }

  /**
   * Emit a structured `needs_input` event whenever the wizard would otherwise
   * make a silent default choice. Outer agents inspect `choices` +
   * `recommended`, surface the decision to a human, and resume with one of
   * the `resumeFlags` argv arrays — or pipe a JSON line to stdin matching
   * `responseSchema` when supported.
   *
   * This is the canonical replacement for any `silent auto-select`. When
   * `--auto-approve` is set, callers should still emit this event (for
   * audit) before proceeding with `recommended`. When neither
   * `--auto-approve` nor `--yes` is set in agent mode, the caller should
   * emit + exit `ExitCode.INPUT_REQUIRED` (12).
   *
   * Returns the freshly-minted `decisionId` (e.g. `dec_001`). Callers
   * MUST thread this id through to the matching `decision_auto`
   * (or other resolution envelope) so orchestrators can pair the
   * request with the response. If the caller supplies a `decisionId`
   * on `data`, it is honored verbatim (used by test fixtures and the
   * paged env-picker that wants a stable id across pages); otherwise
   * a fresh id is minted from the process-local counter.
   */
  emitNeedsInput<V = string>(data: NeedsInputData<V>): string {
    const decisionId = data.decisionId ?? nextDecisionId();
    const wireData: NeedsInputWireData<V> = {
      event: 'needs_input',
      code: data.code,
      decisionId,
      ui: data.ui,
      choices: data.choices,
      recommended: data.recommended,
      recommendedReason: data.recommendedReason,
      resumeFlags: data.resumeFlags,
      responseSchema: data.responseSchema,
      pagination: data.pagination,
      allowManualEntry: data.allowManualEntry,
      manualEntry: data.manualEntry,
    };
    emit('needs_input', data.message, { data: wireData });
    return decisionId;
  }

  // ── Inner-agent lifecycle ───────────────────────────────────────────
  //
  // Emitted from agent-interface hooks (PreToolUse / PostToolUse /
  // SessionStart / Stop) so outer agents can mirror what the inner Claude
  // SDK is doing. Each emitter is a thin wrapper over `emit()` so the
  // wire format stays consistent with the rest of agent-mode output.

  /**
   * Inner Claude SDK has booted and is about to start its first turn.
   * Carries the structured `ModelDescriptor` block (vendor / family /
   * alias / tier / displayName) and the wizard phase (plan / apply /
   * verify / wizard) so the outer agent can attribute downstream events
   * and branch on the model tier without string-matching.
   *
   * Accepts the raw SDK alias as a `string` for caller convenience —
   * `classifyModel()` does the structuring at the emit boundary so
   * every callsite ships a v2-shaped envelope without each one having
   * to know the classification rules.
   */
  emitInnerAgentStarted(args: {
    model: string;
    phase: InnerAgentStartedData['phase'];
    planId?: string;
  }): void {
    const descriptor = classifyModel(args.model);
    const data: InnerAgentStartedData = {
      event: 'inner_agent_started',
      model: descriptor,
      phase: args.phase,
      ...(args.planId ? { planId: args.planId } : {}),
    };
    // Log-line summary uses the displayName when classify produced one
    // (e.g. `'Sonnet 4.6'`) so the human-readable wire matches the
    // structured payload. Falls back to the raw alias for unknown
    // models so logs stay informative.
    const label = descriptor.displayName ?? descriptor.alias;
    emit('lifecycle', `inner_agent_started: ${label}`, {
      data,
    });
  }

  /**
   * Cumulative tool-call telemetry across the run. Populated on every
   * `emitToolCall` (PreToolUse boundary) and `recordToolOutcome`
   * (PostToolUse boundary, called from `inner-lifecycle.ts`). Read at
   * phase / terminal boundaries by `emitToolCallSummary` to build the
   * rollup envelope. Private — outer callers go through the
   * `emitToolCall` / `recordToolOutcome` / `emitToolCallSummary` API.
   */
  private _toolCallStats: ToolCallStats = new ToolCallStats();

  /**
   * Last-emitted `tool_call_summary` signature. Used to dedup
   * back-to-back emissions at the same boundary (phase finalize then
   * terminal exit with no intervening tool calls) so an orchestrator
   * doesn't see an identical payload twice on the wire. Comparing
   * the signature string is sufficient because the payload is fully
   * value-typed.
   */
  private _lastToolCallSummarySignature: string | null = null;

  /**
   * The inner agent is about to call a tool. Use the helper
   * `summarizeToolInput` from `agent-events` to build a privacy-safe
   * `summary` rather than passing the raw input through.
   *
   * Side effect: increments the run-level `ToolCallStats` accumulator
   * so `emitToolCallSummary` can build a rollup at phase / terminal
   * boundaries. The increment happens here (rather than in the
   * inner-lifecycle hook) so any path that calls `emitToolCall`
   * directly (today: none; tomorrow: future probe-call shims) is
   * counted automatically.
   */
  emitToolCall(data: Omit<ToolCallData, 'event'>): void {
    this._toolCallStats.recordCall(data.tool);
    emit(
      'progress',
      data.summary
        ? `tool: ${data.tool} — ${data.summary}`
        : `tool: ${data.tool}`,
      { data: { event: 'tool_call', ...data } },
    );
  }

  /**
   * Record the outcome of the most recent tool call for the given
   * tool. Called from the PostToolUse hook in `inner-lifecycle.ts`
   * — kept on the AgentUI surface (rather than on the
   * `ToolCallStats` directly) so the inner-lifecycle hook has a
   * stable seam for future telemetry without reaching into the
   * accumulator's internals.
   *
   * `denied` is reserved for the rare path where the SDK refuses a
   * tool call pre-execution (permission gate, allowlist miss). The
   * common case is `success` / `error` keyed off PostToolUse
   * `is_error`.
   */
  recordToolOutcome(tool: string, outcome: ToolCallOutcome): void {
    this._toolCallStats.recordOutcome(tool, outcome);
  }

  /**
   * Emit the aggregated `tool_call_summary` rollup. See
   * `EVENT_DATA_VERSIONS.tool_call_summary` for the full contract.
   *
   *   - No-op when `totalCalls === 0` — orchestrators key off
   *     absence of this event to render "no tools were called".
   *   - No-op when the current payload signature matches the last
   *     emitted one (duplicate boundary call, or a terminal
   *     emission with no new tool calls since finalize). Keeps the
   *     wire free of identical back-to-back rollups.
   */
  emitToolCallSummary(): void {
    const payload = this._toolCallStats.build();
    if (!payload) return;
    // Stable signature — JSON.stringify gives a deterministic
    // ordering on the value-typed payload because the keys are
    // inserted in a fixed order by `build()`. Cheap and explicit.
    const signature = JSON.stringify(payload);
    if (signature === this._lastToolCallSummarySignature) return;
    this._lastToolCallSummarySignature = signature;
    emit(
      'progress',
      `tool_call_summary: ${payload.totalCalls} calls (${payload.durationMsTotal}ms)`,
      { data: payload },
    );
  }

  /**
   * Read-only accessor for the live `ToolCallStats` accumulator.
   * Exposed so the inner-lifecycle PostToolUse hook can record
   * outcomes without going through a per-tool method, and so the
   * regression suite can assert intermediate state. Returns the
   * actual instance, not a copy — callers must not mutate it
   * directly (use `recordToolOutcome` instead).
   */
  getToolCallStats(): ToolCallStats {
    return this._toolCallStats;
  }

  /**
   * A write tool has been requested. Emitted from PreToolUse before any
   * file change happens, so outer agents can preview and (optionally)
   * abort. Pairs with `emitFileChangeApplied` on success.
   */
  emitFileChangePlanned(data: Omit<FileChangePlannedData, 'event'>): void {
    emit('progress', `file_change_planned: ${data.operation} ${data.path}`, {
      data: { event: 'file_change_planned', ...data },
    });
  }

  /**
   * A write tool has succeeded. Emitted from PostToolUse with the same
   * path as the preceding `file_change_planned`. Outer agents pair these
   * to build an audit trail of what the wizard wrote.
   */
  emitFileChangeApplied(data: Omit<FileChangeAppliedData, 'event'>): void {
    emit('result', `file_change_applied: ${data.operation} ${data.path}`, {
      data: { event: 'file_change_applied', ...data },
    });
    // Mirror into the setup_complete registry so the terminal
    // event lists every file the wizard touched. `create` lands
    // in `written`, `modify` in `modified`, `delete` is dropped
    // (deletes don't produce a follow-up artifact). Path is the
    // raw absolute path the inner agent passed; the orchestrator
    // can relativize against `installDir` if it cares about
    // shorter labels.
    if (data.operation === 'create') {
      registerSetupComplete({ files: { written: [data.path], modified: [] } });
    } else if (data.operation === 'modify') {
      registerSetupComplete({ files: { written: [], modified: [data.path] } });
    }
  }

  // WizardUI-shaped aliases (see wizard-ui.ts). Inner-lifecycle calls these
  // via the abstract interface so InkUI can also receive file_change events
  // for the TUI panel; AgentUI just delegates to its existing NDJSON
  // emitters above. The schema-v:1 envelope on stdout is unchanged so outer
  // agents that already parse `file_change_planned` / `file_change_applied`
  // keep working.
  recordFileChangePlanned(data: Omit<FileChangePlannedData, 'event'>): void {
    this.emitFileChangePlanned(data);
  }
  recordFileChangeApplied(data: Omit<FileChangeAppliedData, 'event'>): void {
    this.emitFileChangeApplied(data);
  }

  /**
   * The inner agent has called `confirm_event_plan` with a proposed plan.
   * Outer agents see the events list before any `track()` call is written.
   */
  emitEventPlanProposed(data: Omit<EventPlanProposedData, 'event'>): void {
    emit('progress', `event_plan_proposed: ${data.events.length} events`, {
      data: { event: 'event_plan_proposed', ...data },
    });
  }

  /**
   * The event plan has been resolved. `source` records who decided
   * (auto / human / flag) so outer agents can audit decisions later.
   */
  emitEventPlanConfirmed(data: Omit<EventPlanConfirmedData, 'event'>): void {
    emit('result', `event_plan_confirmed: ${data.decision} (${data.source})`, {
      data: { event: 'event_plan_confirmed', ...data },
    });
  }

  /** Verification phase has started — paired with `emitVerificationResult`. */
  emitVerificationStarted(data: Omit<VerificationStartedData, 'event'>): void {
    emit('progress', `verification_started: ${data.phase}`, {
      data: { event: 'verification_started', ...data },
    });
  }

  /** Verification phase has completed (success or failure with reasons). */
  emitVerificationResult(data: Omit<VerificationResultData, 'event'>): void {
    emit(
      data.success ? 'result' : 'error',
      `verification_result: ${data.phase} ${data.success ? 'pass' : 'fail'}`,
      {
        level: data.success ? 'success' : 'error',
        data: { event: 'verification_result', ...data },
      },
    );
  }

  // ── Logging ─────────────────────────────────────────────────────────

  log = {
    info(message: string): void {
      emit('log', message, { level: 'info' });
    },
    warn(message: string): void {
      emit('log', message, { level: 'warn' });
    },
    error(message: string): void {
      emit('log', message, { level: 'error' });
    },
    success(message: string): void {
      emit('log', message, { level: 'success' });
    },
    step(message: string): void {
      emit('log', message, { level: 'step' });
    },
  };

  note(message: string): void {
    emit('status', message, { data: { kind: 'note' } });
  }

  pushStatus(message: string): void {
    emit('status', message, { data: { kind: 'push' } });
  }

  heartbeat(data: {
    statuses: string[];
    elapsedMs: number;
    attempt?: number;
  }): void {
    // Always fire — orchestrators rely on the cadence to detect a
    // stalled wizard ("no heartbeat in 30s + no result event = the
    // process hung"). Drops the prior empty-statuses gate which made
    // long, quiet tool calls (Bash, MCP, file edit chains) look
    // indistinguishable from a hang.
    const seconds = Math.round(data.elapsedMs / 1000);
    const summary =
      data.statuses.length > 0
        ? `heartbeat (${seconds}s, ${data.statuses.length} recent)`
        : `heartbeat (${seconds}s, idle)`;
    emit('progress', summary, {
      data: {
        event: 'heartbeat',
        statuses: data.statuses,
        elapsedMs: data.elapsedMs,
        ...(data.attempt !== undefined ? { attempt: data.attempt } : {}),
      },
    });
  }

  // ── Spinner ─────────────────────────────────────────────────────────

  spinner(): SpinnerHandle {
    return {
      start(message?: string) {
        if (message) {
          emit('status', message, {
            data: { kind: 'spinner', state: 'start' },
          });
        }
      },
      stop(message?: string) {
        if (message) {
          emit('status', message, { data: { kind: 'spinner', state: 'stop' } });
        }
      },
      message(msg?: string) {
        if (msg) {
          emit('status', msg, { data: { kind: 'spinner', state: 'update' } });
        }
      },
    };
  }

  // ── Post-agent step lifecycle ───────────────────────────────────────

  // PR B4: track the post-agent step queue locally so `setPostAgentStep`
  // can emit a `progress_estimate` rollup at each terminal-state
  // transition (`completed` / `skipped`). Without the seeded total we
  // couldn't compute the percent — orchestrators would see fine-grained
  // `post_agent_step` events but no canonical progress bar to render.
  private _postAgentStepIds: string[] = [];
  private _postAgentStepDone = new Set<string>();

  seedPostAgentSteps(steps: PostAgentStep[]): void {
    // Reset the per-run tracking. A second `seedPostAgentSteps` call
    // is rare but supported (e.g. agent run + verify run on the same
    // session); the prior queue's progress shouldn't bleed into the
    // new one.
    this._postAgentStepIds = steps.map((s) => s.id);
    this._postAgentStepDone = new Set<string>();
    emit('progress', `post_agent_seeded: ${steps.length} step(s)`, {
      data: {
        event: 'post_agent_seeded',
        steps: steps.map((s) => ({
          id: s.id,
          label: s.label,
          status: s.status,
        })),
      },
    });
  }

  setPostAgentStep(
    id: string,
    patch: { status: PostAgentStep['status']; reason?: string },
  ): void {
    emit('progress', `post_agent_step: ${id} ${patch.status}`, {
      data: {
        event: 'post_agent_step',
        id,
        status: patch.status,
        reason: patch.reason,
      },
    });
    // PR B4: emit the orchestrator-facing rollup on terminal-state
    // transitions. `in_progress` / `pending` aren't terminal — we
    // don't bump `current` for them (a step bouncing back to
    // `pending` from `in_progress` shouldn't lower the percent on
    // the wire).
    if (
      (patch.status === 'completed' || patch.status === 'skipped') &&
      this._postAgentStepIds.includes(id) &&
      !this._postAgentStepDone.has(id)
    ) {
      this._postAgentStepDone.add(id);
      this.emitProgressEstimate({
        stage: 'post_agent_steps',
        current: this._postAgentStepDone.size,
        total: this._postAgentStepIds.length,
      });
    }
  }

  // ── PR B4: progress_estimate (orchestrator rollup) ──────────────────
  //
  // Multi-item operations (post-agent step queue, MCP install across
  // editors, event-plan write) advertise a single canonical
  // `(stage, current, total, percent)` envelope at every meaningful
  // boundary. Orchestrators that want to render a progress bar
  // subscribe to `progress_estimate` and ignore the fine-grained
  // per-item events.

  emitProgressEstimate(args: {
    stage: string;
    current: number;
    total: number;
  }): void {
    const payload = buildProgressEstimate(args.stage, args.current, args.total);
    if (payload === null) {
      // total < 1 — no-op. Orchestrators must not see a
      // `progress_estimate` for a zero-item operation.
      return;
    }
    emit(
      'progress',
      `progress_estimate: ${payload.stage} ${payload.current}/${payload.total} (${payload.percent}%)`,
      {
        data: payload,
      },
    );
  }

  // ── PR B5: cold_start_breakdown (per-phase timing) ──────────────────
  //
  // The coarse `run_phase: cold_start` envelope tells a parent agent
  // "the wizard is cold-starting". `cold_start_breakdown` tells them
  // WHICH of the five cold-start phases consumed the time. Emitted at
  // the END of each phase boundary by the runner (skill staging,
  // package-manager detection, framework preflight, MCP bootstrap,
  // gateway probe). See `EVENT_DATA_VERSIONS.cold_start_breakdown` for
  // the full contract.

  emitColdStartBreakdown(args: {
    phase: ColdStartPhase;
    startedAt: number;
    finishedAt: number;
  }): void {
    const payload = buildColdStartBreakdown(
      args.phase,
      args.startedAt,
      args.finishedAt,
    );
    emit(
      'progress',
      `cold_start_breakdown: ${payload.phase} (${payload.durationMs}ms)`,
      {
        data: payload,
      },
    );
  }

  // ── PR B7: mcp_status (MCP server lifecycle observability) ─────────
  //
  // Today parent agents have no visibility into the wizard's MCP
  // server state — the in-process `wizard_tools` server boots
  // silently during cold start, and the `editor_install` flow
  // silently detects (or doesn't) supported editors and silently
  // installs (or skips) the editor MCP config. `mcp_status` fires
  // at every state transition with a `{ server, state,
  // transition_ts, detail? }` payload so an orchestrator can render
  // both lifecycles in real time. See `EVENT_DATA_VERSIONS.mcp_status`
  // and `MCPStatusData` for the full contract.

  emitMcpStatus(data: {
    server: MCPStatusServer;
    state: MCPStatusState;
    transition_ts: number;
    detail?: string;
  }): void {
    // Defense-in-depth: validate the payload before it leaves the
    // wizard. The envelope-level `agentEventSchema` only checks the
    // outer frame; this Zod check catches a misbehaving caller that
    // would otherwise ship a malformed `(server, state)` pair the
    // orchestrator can't branch on. Failures land in the on-disk
    // log (same routing as `validateEnvelopeOrLog`); the emit still
    // proceeds so we don't drop the signal on a typo in `detail`.
    const parsed = mcpStatusDataSchema.safeParse(data);
    if (!parsed.success) {
      try {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        logToFileLazy(
          `[agent-ui] mcp_status payload failed schema validation — ${issues}; server=${data.server}; state=${data.state}`,
        );
      } catch {
        // never throw from emit
      }
      return;
    }
    emit('lifecycle', `mcp_status: ${data.server} -> ${data.state}`, {
      data: { event: 'mcp_status', ...data },
    });
  }

  /**
   * Emit a `tool_response` envelope at PostToolUse for every tool
   * the inner agent calls. Pairs with the preceding `tool_call`
   * via the SDK `tool_use_id` correlation field (carried in
   * `data.id`). See `EVENT_DATA_VERSIONS.tool_response` for the
   * full contract.
   *
   * Truncation + sanitization happen at this boundary (not at the
   * caller) so every emit site benefits from the same caps:
   *   - `contentHead` → first `TOOL_RESPONSE_CONTENT_HEAD_MAX_BYTES`
   *     bytes, then `redactString`
   *   - `errorMessage` → first `TOOL_RESPONSE_ERROR_MESSAGE_MAX_BYTES`
   *     bytes, then `redactString`
   *   - `summary` → first `TOOL_RESPONSE_SUMMARY_MAX_CHARS` chars
   *     (chars not bytes — matches the existing `tool_call.summary`
   *     contract from `summarizeToolInput`)
   *
   * Validation: an out-of-bounds `outcome` literal or a negative
   * `durationMs` is dropped at the boundary (logged to disk) so the
   * orchestrator never sees a malformed envelope. Mirrors the
   * `emitMcpStatus` defense-in-depth pattern above.
   */
  emitToolResponse(data: Omit<ToolResponseData, 'event'>): void {
    // Truncate + redact free-form text BEFORE Zod validation so the
    // schema sees the bounded, sanitized payload — and so a caller
    // that passes a 50KB Bash stdout doesn't make the validator
    // chew on the entire blob before we trim it.
    const redactor = getNdjsonRedactor();
    const contentHead =
      typeof data.contentHead === 'string'
        ? redactor(
            truncateToBytes(
              data.contentHead,
              TOOL_RESPONSE_CONTENT_HEAD_MAX_BYTES,
            ),
          )
        : undefined;
    const errorMessage =
      typeof data.errorMessage === 'string'
        ? redactor(
            truncateToBytes(
              data.errorMessage,
              TOOL_RESPONSE_ERROR_MESSAGE_MAX_BYTES,
            ),
          )
        : undefined;
    const summary =
      typeof data.summary === 'string' &&
      data.summary.length > TOOL_RESPONSE_SUMMARY_MAX_CHARS
        ? data.summary.slice(0, TOOL_RESPONSE_SUMMARY_MAX_CHARS)
        : data.summary;
    const payload: Omit<ToolResponseData, 'event'> = {
      tool: data.tool,
      ...(data.id !== undefined ? { id: data.id } : {}),
      outcome: data.outcome,
      // Floor durationMs at 0 so a clock-skew / non-monotonic input
      // doesn't trip the schema's nonnegative() guard.
      durationMs: Math.max(0, Math.floor(data.durationMs)),
      ...(typeof data.exitCode === 'number' && Number.isFinite(data.exitCode)
        ? { exitCode: Math.floor(data.exitCode) }
        : {}),
      ...(contentHead !== undefined ? { contentHead } : {}),
      isError: data.isError,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
      ...(summary !== undefined ? { summary } : {}),
    };
    const parsed = toolResponseDataSchema.safeParse(payload);
    if (!parsed.success) {
      try {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        logToFileLazy(
          `[agent-ui] tool_response payload failed schema validation — ${issues}; tool=${data.tool}; outcome=${data.outcome}`,
        );
      } catch {
        // never throw from emit
      }
      return;
    }
    emit(
      'progress',
      `tool_response: ${payload.tool} -> ${payload.outcome} (${payload.durationMs}ms)`,
      { data: { event: 'tool_response', ...payload } },
    );
  }

  // ── Session state ───────────────────────────────────────────────────

  /**
   * Run-start timestamp (epoch ms). Captured by `startRun()` — read by
   * `emitRunCompleted` to compute `durationMs`. `null` until the run
   * actually begins so duration is reported accurately even when the
   * wizard exits before reaching the inner agent (e.g.
   * `auth_required`, `INPUT_REQUIRED`). In those early-exit cases
   * `emitRunCompleted` reports `durationMs: 0` — orchestrators
   * shouldn't read significance into a zero duration; the structured
   * `outcome` + `exitCode` are the contract.
   */
  private _runStartedAtMs: number | null = null;
  // Run-phase deduplication. We emit `run_phase` at coarse boundaries
  // (cold_start / agent_running / finalizing / completed / error)
  // and the agent-runner is the lone caller — but agent_running fires
  // from every tool call's preToolUse hook, so dedup at the wire
  // boundary keeps a noisy hook chain from spamming the stream.
  private _lastRunPhase: string | null = null;

  startRun(): void {
    this._runStartedAtMs = Date.now();
    emit('lifecycle', 'run_started', { data: { event: 'start_run' } });
  }

  /**
   * Emit a `lifecycle: run_phase` event when the wizard transits
   * between coarse phase boundaries. Idempotent — repeated calls
   * with the same phase no-op. See `RunPhase` in `agent-events.ts`.
   */
  emitRunPhase(
    phase:
      | 'cold_start'
      | 'agent_running'
      | 'finalizing'
      | 'completed'
      | 'error',
  ): void {
    if (this._lastRunPhase === phase) return;
    this._lastRunPhase = phase;
    emit('lifecycle', `run_phase: ${phase}`, {
      data: { event: 'run_phase', phase },
    });
  }

  /**
   * Terminal lifecycle event. Emitted exactly once per run, immediately
   * before the process exits via `wizardSuccessExit` / `wizardAbort`.
   * See `RunCompletedData` in `agent-events.ts` for the contract.
   */
  emitRunCompleted(data: {
    outcome: 'success' | 'error' | 'cancelled';
    exitCode: number;
    durationMs: number;
    reason?: string;
  }): void {
    // Caller (`wizard-abort.ts`) computes durationMs from
    // `_runStartedAtMs`. Pass-through with no transformation — keeps
    // the AgentUI side a thin emitter.
    emit('lifecycle', `run_completed: ${data.outcome}`, {
      level:
        data.outcome === 'error'
          ? 'error'
          : data.outcome === 'cancelled'
          ? 'warn'
          : 'success',
      data: {
        event: 'run_completed',
        outcome: data.outcome,
        exitCode: data.exitCode,
        durationMs: data.durationMs,
        ...(data.reason ? { reason: data.reason } : {}),
      },
    });
  }

  /**
   * Read-only accessor for the run-start timestamp. Used by
   * `wizard-abort.ts` to compute `durationMs` without exposing the
   * private field. Returns `null` if `startRun()` was never called
   * (early-exit paths like `auth_required` / `INPUT_REQUIRED`).
   */
  getRunStartedAtMs(): number | null {
    return this._runStartedAtMs;
  }

  /**
   * Emit aggregated agent-run metrics at finalize time. See
   * `WizardUI.emitAgentMetrics` for the contract.
   *
   * Lands on the `progress` event type (not `lifecycle` /
   * `result`) because metrics are observability data — orchestrators
   * subscribing to operational telemetry will key on `progress`-type
   * events; subscribers caring only about run outcomes (success /
   * failure) won't be flooded with one-off cost data.
   */
  emitAgentMetrics(data: {
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    costUsd?: number;
    numTurns?: number;
    totalToolCalls?: number;
    totalMessages?: number;
    isError?: boolean;
    toolCallsByTool?: Record<string, number>;
  }): void {
    // Drop undefined fields rather than ship `"costUsd": undefined`,
    // which JSON.stringify omits but leaves the schema unclear in
    // tests / docs. Output is a tight, dense object with only what
    // the SDK actually reported.
    const entries: Array<[string, unknown]> = Object.entries(data).filter(
      ([, v]) => v !== undefined,
    );
    const payload = Object.fromEntries(entries);
    emit('progress', `agent_metrics: ${data.durationMs}ms`, {
      data: { event: 'agent_metrics', ...payload },
    });
  }

  emitCheckpointSaved(data: {
    path: string;
    bytes: number;
    phase: string;
  }): void {
    emit('progress', `checkpoint_saved (${data.phase}, ${data.bytes}B)`, {
      data: { event: 'checkpoint_saved', ...data },
    });
  }

  emitCheckpointLoaded(data: { path: string; ageSeconds: number }): void {
    emit('progress', `checkpoint_loaded (${data.ageSeconds}s old)`, {
      data: { event: 'checkpoint_loaded', ...data },
    });
  }

  emitCheckpointCleared(data: {
    path: string;
    reason: 'success' | 'manual' | 'logout';
  }): void {
    emit('progress', `checkpoint_cleared (${data.reason})`, {
      data: { event: 'checkpoint_cleared', ...data },
    });
  }

  emitTransientRetry(data: {
    attempt: number;
    totalAttempts: number;
    nextRetryInMs: number;
    reason: 'stall' | 'transient_api' | 'sdk_thrown';
    retryAfterMs: number | null;
  }): void {
    emit(
      'progress',
      `transient_retry: attempt ${data.attempt}/${data.totalAttempts} in ${data.nextRetryInMs}ms (${data.reason})`,
      {
        data: { event: 'transient_retry', ...data },
      },
    );
  }

  // ── PR B4: attempt_started ──────────────────────────────────────────
  //
  // `transient_retry` answers "the wizard decided to retry; sleeping Ns".
  // `attempt_started` answers "attempt N is now actually running" —
  // emitted at the top of each outer-loop iteration AFTER the backoff
  // sleep has elapsed and a fresh AbortController has been wired up.
  // The two together let orchestrators render a faithful retry-lifecycle
  // banner without timing inference.

  emitAttemptStarted(data: {
    attemptNumber: number;
    totalBudget: number;
    reason: 'cold_start' | 'stall_retry' | 'auth_refresh' | 'network_retry';
    backoffMs?: number;
  }): void {
    const suffix =
      data.backoffMs !== undefined && data.backoffMs > 0
        ? ` after ${data.backoffMs}ms backoff`
        : '';
    emit(
      'progress',
      `attempt_started: ${data.attemptNumber}/${data.totalBudget} (${data.reason})${suffix}`,
      {
        data: {
          event: 'attempt_started',
          attemptNumber: data.attemptNumber,
          totalBudget: data.totalBudget,
          reason: data.reason,
          // Only include backoffMs when explicitly provided — omitting
          // it on the wire keeps the cold-start envelope minimal
          // (orchestrators read absence as "no backoff preceded").
          ...(data.backoffMs !== undefined
            ? { backoffMs: data.backoffMs }
            : {}),
        },
      },
    );
  }

  emitCompactionStarted(data: { trigger: 'manual' | 'auto' }): void {
    emit('progress', `compaction_started (${data.trigger})`, {
      data: { event: 'compaction_started', ...data },
    });
  }

  emitCompactionCompleted(data: {
    trigger: 'manual' | 'auto';
    preTokens: number;
    postTokens?: number;
    durationMs?: number;
  }): void {
    const post = data.postTokens !== undefined ? `→${data.postTokens}` : '';
    emit(
      'progress',
      `compaction_completed (${data.trigger} ${data.preTokens}${post} tokens)`,
      {
        data: { event: 'compaction_completed', ...data },
      },
    );
  }

  // ── v2 protocol: current_file rollup ────────────────────────────────
  //
  // Today every Edit / Write tool call emits its own fine-grained
  // `tool_call` + `file_change_planned` / `file_change_applied`. That's
  // great for an audit log but noisy for an orchestrator that just wants
  // a "now editing X" header. `current_file` is the coarse rollup —
  // debounced so repeated edits to the same file inside a 250ms window
  // collapse into a single event. Pinning a per-(path, op) tuple at the
  // emitter rather than wire-side gives parent agents a stable signal
  // they can subscribe to without bookkeeping.

  private _lastCurrentFile: {
    path: string;
    operation: 'create' | 'modify' | 'delete';
    at: number;
  } | null = null;
  /** Debounce window — same (path, operation) inside this window no-ops. */
  private static readonly CURRENT_FILE_DEBOUNCE_MS = 250;

  emitCurrentFile(data: {
    path: string;
    relativePath: string;
    operation: 'create' | 'modify' | 'delete';
  }): void {
    const now = Date.now();
    const last = this._lastCurrentFile;
    if (
      last &&
      last.path === data.path &&
      last.operation === data.operation &&
      now - last.at < AgentUI.CURRENT_FILE_DEBOUNCE_MS
    ) {
      // Same file + op inside the debounce window — drop. The
      // orchestrator already has a chip for this file; the duplicate
      // would just churn rendering.
      return;
    }
    this._lastCurrentFile = {
      path: data.path,
      operation: data.operation,
      at: now,
    };
    emit('progress', `current_file: ${data.operation} ${data.relativePath}`, {
      data: {
        event: 'current_file',
        path: data.path,
        relativePath: data.relativePath,
        operation: data.operation,
      },
    });
  }

  // ── v2 protocol: stall_status coaching tiers ────────────────────────
  //
  // The wizard's stall detector fires at 10s / 30s / 60s of silence.
  // Mirror that escalation onto NDJSON so parent agents can render the
  // same coaching tier ("the wizard's been quiet for 10s" → "concerning"
  // → "critical, consider retrying") in lockstep with the TUI. Per-tier
  // dedup at the wire boundary so a runaway emitter can't spam
  // orchestrators — a tier fires at most once per stall window, reset
  // by `resetStallStatus()` when activity resumes.

  private _lastStallTier: 'noticed' | 'concerning' | 'critical' | null = null;

  emitStallStatus(data: {
    tier: 'noticed' | 'concerning' | 'critical';
    durationMs: number;
    lastActivity: number;
    hint?: string;
  }): void {
    if (this._lastStallTier === data.tier) {
      // Same tier already emitted this window. Caller should invoke
      // `resetStallStatus()` when activity resumes.
      return;
    }
    this._lastStallTier = data.tier;
    emit('progress', `stall_status: ${data.tier} (${data.durationMs}ms)`, {
      data: {
        event: 'stall_status',
        tier: data.tier,
        durationMs: data.durationMs,
        lastActivity: data.lastActivity,
        ...(data.hint ? { hint: data.hint } : {}),
      },
    });
  }

  /**
   * Reset the per-window stall-tier guard. Callers invoke this when
   * the inner agent resumes producing tool calls / status updates —
   * the next stall window starts fresh and the 'noticed' tier can
   * fire again.
   */
  resetStallStatus(): void {
    this._lastStallTier = null;
  }

  // ── v2 protocol: run_resumed checkpoint signal ──────────────────────
  //
  // When the wizard restarts from a checkpoint (post-crash, post-SIGINT,
  // post-token-expiry), the first envelope after `run_started` should be
  // `run_resumed` so an orchestrator can render "continuing from where
  // we left off" instead of "fresh run". Distinct from
  // `checkpoint_loaded` (which fires only when `--resume` finds a fresh
  // file): `run_resumed` carries the orchestrator-facing summary needed
  // to drive UX, not just the load event.

  emitRunResumed(data: {
    fromCheckpointAt: string;
    lastPhase:
      | 'cold_start'
      | 'agent_running'
      | 'finalizing'
      | 'completed'
      | 'error'
      | 'unknown';
    restoredStateSummary: string;
  }): void {
    emit(
      'lifecycle',
      `run_resumed (last_phase=${data.lastPhase}, from=${data.fromCheckpointAt})`,
      {
        data: {
          event: 'run_resumed',
          from_checkpoint_at: data.fromCheckpointAt,
          last_phase: data.lastPhase,
          restored_state_summary: data.restoredStateSummary,
        },
      },
    );
  }

  // ── v2 protocol: file_change_failed (write-tool error) ──────────────
  //
  // PostToolUse hooks see `is_error: true` on the tool_response object.
  // Today the generic `tool_call` event captures the input but not the
  // outcome. `file_change_failed` pairs with the preceding
  // `file_change_planned` so an orchestrator can label "tried to edit
  // X, failed because Y" on the already-rendered preview without
  // parsing tool_result text.

  emitFileChangeFailed(data: {
    path: string;
    operation: 'create' | 'modify' | 'delete';
    errorClass: FileChangeErrorClass;
    errorMessage: string;
  }): void {
    emit(
      'error',
      `file_change_failed: ${data.operation} ${data.path} (${data.errorClass})`,
      {
        level: 'error',
        data: {
          event: 'file_change_failed',
          path: data.path,
          operation: data.operation,
          errorClass: data.errorClass,
          errorMessage: data.errorMessage,
        },
      },
    );
  }

  // Security: stack traces redacted from NDJSON output to prevent path/secret leakage
  setRunError(error: Error): Promise<boolean> {
    let sanitized: string;
    try {
      const { redactString } = require('../lib/observability/redact') as {
        redactString: (s: string) => string;
      };
      sanitized = redactString(error.message);
    } catch {
      // Fallback to inline redaction if observability module not available
      sanitized = error.message
        .replace(/https?:\/\/[^\s]+/g, '[URL redacted]')
        .replace(/\/(?:Users|home|var|tmp)\/[^\s:]+/g, '[path redacted]');
    }
    // Classify so consuming agents know whether to retry, re-invoke
    // with flags, ask the human, or treat as fatal — without parsing
    // the message string. Pure helper, see agent-events.ts for the
    // pattern → hint mapping.
    const hint = classifyRunError(error);
    emit('error', sanitized, {
      data: {
        // `event: 'run_error'` discriminator brings this envelope in
        // line with every other event family. Without it, an
        // orchestrator filtering on `data.event` saw nothing here and
        // had to special-case `type === 'error'`. data_version
        // registry keys off this discriminator.
        event: 'run_error',
        name: error.name,
        recoverable: hint.recoverable,
        ...(hint.suggestedAction
          ? { suggestedAction: hint.suggestedAction }
          : {}),
      },
    });
    return Promise.resolve(false);
  }

  // Security: accessToken and projectApiKey intentionally redacted from NDJSON output
  setCredentials(credentials: {
    accessToken: string;
    projectApiKey: string;
    host: string;
    appId: number;
    orgId?: string | null;
    orgName?: string | null;
    projectId?: string | null;
    projectName?: string | null;
    envName?: string | null;
  }): void {
    emit('session_state', 'credentials_set', {
      data: {
        field: 'credentials',
        host: credentials.host,
        // appId is the canonical Amplitude app ID. envName is the env label
        // (Production/Dev/etc). Project is the Amplitude hierarchy level
        // between org and app (formerly "workspace" in the GraphQL API).
        appId: credentials.appId,
        orgId: credentials.orgId ?? null,
        orgName: credentials.orgName ?? null,
        projectId: credentials.projectId ?? null,
        projectName: credentials.projectName ?? null,
        envName: credentials.envName ?? null,
      },
    });
    // Mirror the Amplitude scope into the setup_complete registry
    // so the terminal `setup_complete` event carries the right
    // appId / orgId / projectId without forcing the agent-runner
    // to plumb session state through a second channel. `appId` of
    // 0 is a sentinel for "not yet resolved" — skip it so the
    // orchestrator doesn't see `appId: "0"` (a real-looking value
    // that would mis-route follow-up MCP queries).
    registerSetupComplete({
      amplitude: {
        ...(credentials.appId && credentials.appId !== 0
          ? { appId: String(credentials.appId) }
          : {}),
        ...(credentials.orgId ? { orgId: credentials.orgId } : {}),
        ...(credentials.orgName ? { orgName: credentials.orgName } : {}),
        ...(credentials.projectId ? { projectId: credentials.projectId } : {}),
        ...(credentials.projectName
          ? { projectName: credentials.projectName }
          : {}),
        ...(credentials.envName ? { envName: credentials.envName } : {}),
      },
    });
  }

  setRegion(region: string): void {
    emit('session_state', `region: ${region}`, {
      data: { field: 'region', value: region },
    });
    if (region === 'us' || region === 'eu') {
      registerSetupComplete({ amplitude: { region } });
    }
  }

  setProjectHasData(value: boolean): void {
    emit('session_state', `project_has_data: ${value}`, {
      data: { field: 'projectHasData', value },
    });
  }

  setDetectedFramework(label: string): void {
    emit('session_state', `framework: ${label}`, {
      data: { field: 'detectedFramework', value: label },
    });
  }

  setLoginUrl(url: string | null): void {
    emit('session_state', url ? `login_url: ${url}` : 'login_url_cleared', {
      data: { field: 'loginUrl', value: url },
    });
  }

  // ── Display state ───────────────────────────────────────────────────

  onEnterScreen(_screen: string, _fn: () => void): void {
    // No screens in agent mode
  }

  // ── Service status ──────────────────────────────────────────────────

  showServiceStatus(data: {
    description: string;
    statusPageUrl: string;
  }): void {
    emit('diagnostic', data.description, {
      data: { statusPageUrl: data.statusPageUrl },
    });
  }

  setRetryState(state: RetryState | null): void {
    if (state) {
      emit('diagnostic', `retry attempt ${state.attempt}/${state.maxRetries}`, {
        data: {
          kind: 'retry',
          attempt: state.attempt,
          maxRetries: state.maxRetries,
          errorStatus: state.errorStatus,
          reason: state.reason,
          nextRetryAtMs: state.nextRetryAtMs,
        },
      });
    } else {
      emit('diagnostic', 'retry cleared', { data: { kind: 'retry_cleared' } });
    }
  }

  /**
   * Surface a long-running activity to NDJSON consumers. Emits a
   * `progress: current_activity` line with the full payload (kind, message,
   * elapsed-time anchor, optional duration estimate). Clearing fires with
   * `kind: 'idle'` so consumers can detect transitions without bookkeeping.
   *
   * Additive — existing NDJSON consumers ignore unknown event types and
   * the underlying lib-layer behavior is unchanged whether activities are
   * emitted or omitted.
   */
  setCurrentActivity(activity: WizardActivity | null): void {
    if (activity) {
      emit('progress', activity.message, {
        data: {
          kind: 'current_activity',
          activityKind: activity.kind,
          message: activity.message,
          startedAt: activity.startedAt,
          estimatedDurationSec: activity.estimatedDurationSec,
        },
      });
    } else {
      emit('progress', 'activity cleared', {
        data: {
          kind: 'current_activity',
          activityKind: 'idle',
          message: '',
          startedAt: Date.now(),
        },
      });
    }
  }

  /**
   * Emit a `progress: discovery_fact` event mirroring the TUI's
   * cold-start "discovery feed" chip. Lets parent agents render the
   * same vertical / app-type / framework / package-manager / region
   * facts the wizard surfaces in Ink. Idempotent on the receiving
   * end via the stable `id` — orchestrators upsert chips keyed off
   * it. Cosmetic only; the values are already on the wire via the
   * preflight context block and session_state events.
   */
  pushDiscoveryFact(
    fact: import('../lib/wizard-session.js').DiscoveryFact,
  ): void {
    emit('progress', `discovery_fact: ${fact.label} = ${fact.value}`, {
      data: {
        event: 'discovery_fact',
        id: fact.id,
        label: fact.label,
        value: fact.value,
        discoveredAt: fact.discoveredAt,
      },
    });
  }

  // ── Prompts (auto-approve) ──────────────────────────────────────────

  promptConfirm(message: string): Promise<boolean> {
    // Back-compat: keep the legacy `prompt` event so existing orchestrators
    // that key off promptType: 'confirm' keep working.
    emit('prompt', message, {
      data: { promptType: 'confirm', autoResult: true },
    });
    // Also emit the structured `needs_input` so new orchestrators can
    // inspect choices + resume flags. Default-yes preserves today's
    // auto-approve semantics.
    const decisionId = this.emitNeedsInput({
      code: 'confirm',
      message,
      ui: {
        component: 'confirmation',
        priority: 'required',
        title: message,
      },
      choices: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
      recommended: 'yes',
    });
    // Then emit a `decision_auto` companion so orchestrators that
    // subscribe to `needs_input` can tell "this was auto-resolved"
    // from "this is awaiting an answer". Order matters: needs_input
    // first, decision_auto after, both before the promise resolves
    // (and before any subsequent control flow advances). The
    // `decisionId` returned above ties the two envelopes together
    // so a `code: 'confirm'` reuse later in the same run can't be
    // mis-paired with this resolution.
    emitDecisionAuto({
      code: 'confirm',
      decisionId,
      value: 'yes',
      reason: 'auto_approve',
    });
    return Promise.resolve(true);
  }

  promptChoice(message: string, options: string[]): Promise<string> {
    const selected = options[0] ?? '';
    emit('prompt', message, {
      data: { promptType: 'choice', options, autoResult: selected },
    });
    // Pick widget by list size: ≥10 options → searchable, else plain select.
    const component = options.length >= 10 ? 'searchable_select' : 'select';
    const decisionId = this.emitNeedsInput({
      code: 'choice',
      message,
      ui: {
        component,
        priority: 'required',
        title: message,
        ...(component === 'searchable_select' && {
          searchPlaceholder: 'Filter options…',
        }),
      },
      choices: options.map((opt) => ({ value: opt, label: opt })),
      recommended: selected,
    });
    emitDecisionAuto({
      code: 'choice',
      decisionId,
      value: selected,
      reason: 'auto_approve',
    });
    return Promise.resolve(selected);
  }

  /**
   * Agent / CI mode: there is no human in the loop, so this path **always**
   * ends in an approved plan for the inner agent — either from
   * `AMPLITUDE_WIZARD_EVENT_PLAN_DECISION` (apply resume flags) or by emitting
   * `needs_input` + `decision_auto` with the recommended **approved** choice.
   *
   * Orchestrators should treat `event_plan` / `event_plan_set` on the NDJSON
   * stream as the canonical payloads; the `result` line `event_plan auto-approved`
   * records that the wizard did not block on stdin (distinct from env-flag
   * resolutions, which emit `event_plan <decision> (via flag)` and skip
   * `decision_auto`).
   */
  promptEventPlan(
    events: Array<{ name: string; description: string }>,
  ): Promise<EventPlanDecision> {
    // Honor a pre-resolved decision injected by the parent `apply`
    // process via env vars BEFORE we emit `needs_input`. The parent
    // command (`bin.ts apply`) forwards `--approve-events` /
    // `--skip-events` / `--revise-events` as
    // `AMPLITUDE_WIZARD_EVENT_PLAN_DECISION` on the spawned child's
    // env. If we emitted `needs_input` first, an outer skill watching
    // the stream would (correctly) STOP and re-prompt the user — even
    // though the user's answer was already passed in via the resume
    // flag. The skill would re-prompt for an answer it already has,
    // and the wizard would block forever on stdin. Short-circuit here
    // so the contract is: "needs_input fires only when we actually
    // need input; flag-driven decisions skip the prompt entirely."
    const preResolved = process.env.AMPLITUDE_WIZARD_EVENT_PLAN_DECISION;
    const preFeedback = process.env.AMPLITUDE_WIZARD_EVENT_PLAN_FEEDBACK ?? '';
    if (
      preResolved === 'approved' ||
      preResolved === 'skipped' ||
      preResolved === 'revised'
    ) {
      // Back-compat: keep the legacy `result` emit so existing
      // orchestrators that key off `event: event_plan` continue to
      // work unchanged. Tag the message with the decision instead
      // of "auto-approved" so a transcript is honest.
      emit('result', `event_plan ${preResolved} (via flag)`, {
        data: { event: 'event_plan', events, decision: preResolved },
      });
      // No `needs_input` and no `decision_auto` — the decision came
      // from a user-driven flag, not the wizard's recommended pick.
      // The contract that lets orchestrators distinguish
      // "auto-resolved" from "user told me what to do" is the
      // ABSENCE of `needs_input + decision_auto` for the same code.
      if (preResolved === 'revised') {
        return Promise.resolve({ decision: 'revised', feedback: preFeedback });
      }
      return Promise.resolve({ decision: preResolved });
    }

    // No pre-resolution — emit a structured `needs_input` so the
    // contract holds: every `decision_auto` MUST follow a
    // `needs_input` for the same `code`. Bugbot flagged that the
    // previous shape emitted `decision_auto` orphaned (after a
    // `result` event, with no preceding needs_input), which
    // contradicted the docstring on `EVENT_DATA_VERSIONS.decision_auto`.
    // Choices are flat strings so orchestrators can `resumeFlags`
    // their way into a different decision if a human is in the loop.
    const decisionId = this.emitNeedsInput<'approved' | 'skipped' | 'revised'>({
      code: 'event_plan',
      message: `Approve ${events.length} proposed events?`,
      ui: {
        component: 'confirmation',
        priority: 'required',
        title: 'Approve instrumentation plan',
        description: `${events.length} events proposed. Review the list and approve, skip, or send revision feedback.`,
      },
      choices: [
        {
          value: 'approved',
          label: 'Approve and instrument',
          resumeFlags: [
            'apply',
            '--plan-id',
            '<id>',
            '--approve-events',
            '--yes',
          ],
        },
        {
          value: 'skipped',
          label: 'Skip event tracking for this run',
          resumeFlags: ['apply', '--plan-id', '<id>', '--skip-events', '--yes'],
        },
        {
          value: 'revised',
          label: 'Send revision feedback',
          resumeFlags: [
            'apply',
            '--plan-id',
            '<id>',
            '--revise-events',
            '<feedback>',
            '--yes',
          ],
        },
      ],
      recommended: 'approved',
    });

    // The full event list is carried on the legacy `result` emit
    // below — orchestrators rendering the plan inline read it from
    // there. We don't shadow the events on `needs_input.metadata`
    // because that field is constrained to primitives.

    // Back-compat: keep the legacy `result` emit so existing
    // orchestrators that key off `event: event_plan` continue to
    // work unchanged.
    emit('result', 'event_plan auto-approved', {
      data: { event: 'event_plan', events },
    });

    // Companion `decision_auto` for the needs_input above. Orchestrators
    // subscribed to needs_input → decision_auto pairs can tell that
    // the wizard auto-resolved this prompt rather than awaiting a
    // human answer. `decisionId` carried through from the matching
    // `emitNeedsInput` call so the pairing is exact even if a second
    // event_plan prompt fires later in the same run.
    emitDecisionAuto({
      code: 'event_plan',
      decisionId,
      value: 'approved',
      reason: 'auto_approve',
    });
    return Promise.resolve({ decision: 'approved' });
  }

  // ── Todos ───────────────────────────────────────────────────────────

  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void {
    emit('progress', `todos: ${todos.length} total`, {
      data: { todos },
    });
  }

  applyJourneyTransition(
    stepId: import('../lib/journey-state.js').JourneyStepId,
    status: import('../lib/journey-state.js').JourneyStatus,
  ): void {
    emit('progress', `journey: ${stepId} -> ${status}`, {
      data: { event: 'journey_transition', stepId, status },
    });
  }

  // ── Event plan ──────────────────────────────────────────────────────

  setEventPlan(events: Array<{ name: string; description: string }>): void {
    emit('result', `event_plan: ${events.length} events`, {
      data: { event: 'event_plan_set', events },
    });
    // Capture the final approved event plan for `setup_complete`.
    // Last writer wins — the canonical `event_plan_set` lands at
    // confirmation time, after any feedback-loop revisions.
    registerSetupComplete({
      events: events.map((e) => ({
        name: e.name,
        description: e.description,
      })),
    });
  }

  setEventIngestionDetected(eventNames: string[]): void {
    emit('result', `events_detected: ${eventNames.length} event types`, {
      data: { event: 'events_detected', eventNames },
    });
  }

  markDataIngestionConfirmed(): void {
    // No-op in --agent mode — there's no flow router to advance, and the
    // ingestion-confirmed signal is already on the wire via the
    // `events_detected` result event emitted from setEventIngestionDetected.
  }

  setDashboardUrl(url: string): void {
    const openUrl = toWizardDashboardOpenUrl(url);
    emit('result', `dashboard_created: ${openUrl}`, {
      data: { event: 'dashboard_created', dashboardUrl: openUrl },
    });
    registerSetupComplete({ amplitude: { dashboardUrl: url } });
  }

  /**
   * Emit a `setup_context` event so the outer agent can show the user
   * exactly which Amplitude scope is about to be modified BEFORE any
   * writes happen. Drops keys with `undefined` values from the wire
   * payload so the orchestrator doesn't have to filter them.
   *
   * Called from:
   *   - `wizard plan` (phase: 'plan') — initial detection
   *   - `wizard apply` (phase: 'apply_started') — after env resolution
   *   - `wizard whoami` (phase: 'whoami') — auth probe
   */
  emitSetupContext(data: {
    phase: SetupContextData['phase'];
    amplitude: SetupContextData['amplitude'];
    sources?: SetupContextData['sources'];
    requiresConfirmation?: boolean;
    resumeFlags?: SetupContextData['resumeFlags'];
  }): void {
    // Build the scope object dropping any undefined fields. JSON.stringify
    // would already omit them, but keeping the wire object lean makes
    // schema tests + orchestrator parsers easier to reason about.
    const amplitude: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data.amplitude)) {
      if (v !== undefined && v !== null && v !== '') {
        amplitude[k] = v;
      }
    }
    const wire: SetupContextData = {
      event: 'setup_context',
      phase: data.phase,
      amplitude: amplitude as SetupContextData['amplitude'],
      ...(data.sources ? { sources: data.sources } : {}),
      ...(data.requiresConfirmation !== undefined
        ? { requiresConfirmation: data.requiresConfirmation }
        : {}),
      ...(data.resumeFlags ? { resumeFlags: data.resumeFlags } : {}),
    };
    // Re-narrow for the summary builder so optional-property reads land
    // on the typed surface (the loop above used a string-keyed record
    // to silence the dynamic-assignment warning). Pure cast — no
    // runtime cost.
    const a = amplitude as SetupContextData['amplitude'];
    const summary = [a.orgName, a.projectName, a.appName ?? a.appId, a.envName]
      .filter(Boolean)
      .join(' / ');
    emit(
      'lifecycle',
      summary
        ? `setup_context (${data.phase}): ${summary}`
        : `setup_context (${data.phase})`,
      { data: wire },
    );
  }

  /**
   * Emit the terminal `setup_complete` event. Called exactly once per
   * successful `apply` run, immediately before `run_completed`. The
   * outer agent reads this to lock its project context on `appId` for
   * any follow-up MCP queries. Routed through the `result` event type
   * so orchestrators subscribed to outcome streams pick it up
   * naturally.
   */
  emitSetupComplete(data: Omit<SetupCompleteData, 'event'>): void {
    // Drop empty optional sub-objects to keep the wire shape tight.
    const cleanAmplitudeRecord: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data.amplitude)) {
      if (v !== undefined && v !== null && v !== '') {
        cleanAmplitudeRecord[k] = v;
      }
    }
    const cleanAmplitude =
      cleanAmplitudeRecord as SetupCompleteData['amplitude'];
    const wire: SetupCompleteData = {
      event: 'setup_complete',
      amplitude: cleanAmplitude,
      ...(data.files ? { files: data.files } : {}),
      ...(data.envVars ? { envVars: data.envVars } : {}),
      ...(data.events ? { events: data.events } : {}),
      ...(data.durationMs !== undefined ? { durationMs: data.durationMs } : {}),
      ...(data.followups ? { followups: data.followups } : {}),
    };
    const appLabel = cleanAmplitude.appName
      ? `${cleanAmplitude.appName}${
          cleanAmplitude.appId ? ` (${cleanAmplitude.appId})` : ''
        }`
      : cleanAmplitude.appId ?? 'unknown';
    emit('result', `setup_complete: app ${appLabel}`, {
      level: 'success',
      data: wire,
    });
  }

  /**
   * Prompt the agent caller to select an environment from pendingOrgs.
   *
   * Emits an NDJSON `prompt` event with all available orgs/projects/environments,
   * then reads one JSON line from stdin with the selection.
   *
   * Expected stdin response:
   * ```json
   * { "appId": "769610" }
   * ```
   *
   * `appId` alone is sufficient — it's globally unique and resolves to
   * exactly one (org, project, app, env) tuple.
   *
   * Falls back to auto-selecting the first environment if stdin is closed
   * or no response is received within 60 seconds.
   */
  async promptEnvironmentSelection(
    orgs: Array<{
      id: string;
      name: string;
      projects: Array<{
        id: string;
        name: string;
        environments?: Array<{
          name: string;
          rank: number;
          app: { id: string; apiKey?: string | null } | null;
        }> | null;
      }>;
    }>,
  ): Promise<{ orgId: string; projectId: string; env: string }> {
    // Emit a flat list of every selectable env so agents can pick without
    // traversing a nested tree. Each entry is unique by (orgId, projectId,
    // envName) and carries the numeric appId that callers can pass as
    // --app-id for unambiguous selection. The previous `orgs` tree view
    // was strictly redundant with this list and roughly doubled the
    // NDJSON envelope size on portfolios with many environments (322-env
    // dogfood went from ~250 KB to ~600 KB) — orchestrators that need a
    // tree can rebuild it from `choices` (group by orgId, then projectId).
    const allChoices = orgs.flatMap((org) =>
      org.projects.flatMap((proj) =>
        (proj.environments ?? [])
          .filter((e) => e.app?.apiKey)
          .sort((a, b) => a.rank - b.rank)
          .map((e) => ({
            orgId: org.id,
            orgName: org.name,
            projectId: proj.id,
            projectName: proj.name,
            appId: e.app?.id ?? null,
            envName: e.name,
            rank: e.rank,
            label: `${org.name} / ${proj.name} / ${e.name}`,
          })),
      ),
    );
    // Cap the wire-level payload at MAX_ENV_SELECTION_CHOICES so a
    // dogfood account with hundreds of environments doesn't ship a
    // 600 KB needs_input envelope on every wizard run. Sorted by rank
    // first (rank 1 = Production at most orgs) and then by org/proj
    // name so the result is stable across runs — orchestrators that
    // hash the payload for caching get a deterministic key.
    //
    // Above-cap users can either:
    //   - search via the orchestrator's picker (the choices list is
    //     itself searchable; the recommended env is included)
    //   - re-run with `--app-id <id>` to pick a specific env that
    //     fell outside the cap (the manualEntry hint surfaces this)
    const sortedChoices = allChoices.slice().sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const orgCmp = a.orgName.localeCompare(b.orgName);
      if (orgCmp !== 0) return orgCmp;
      const projCmp = a.projectName.localeCompare(b.projectName);
      if (projCmp !== 0) return projCmp;
      return a.envName.localeCompare(b.envName);
    });
    const choices = sortedChoices.slice(0, MAX_ENV_SELECTION_CHOICES);

    // Legacy `prompt` event: kept for backward compatibility with
    // orchestrators that key off `type === 'prompt'` and parse
    // `data.choices` / `data.resumeFlags` directly. Newer orchestrators
    // should consume the structured `needs_input` event emitted below.
    emit(
      'prompt',
      `Multiple Amplitude environments available — select one of ${choices.length}.`,
      {
        data: {
          promptType: 'environment_selection',
          // Must stay aligned with the manifest's concepts.hierarchy so
          // agents don't see one shape in the manifest and a different
          // shape in the prompt. Each choice carries appId, the
          // unambiguous selector.
          hierarchy: ['org', 'project', 'app', 'environment'],
          choices,
          // Agents should reply on stdin with one JSON line matching this
          // JSON Schema 2020-12 fragment. Switched from `Record<string, string>`
          // English descriptions in v3 so non-Claude orchestrators
          // (Codex, GPT-5, Mistral) can run a real validator.
          responseSchema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: {
              appId: {
                type: 'string',
                pattern: '^\\d+$',
                description:
                  'Numeric Amplitude app ID — must match one of choices[].appId.',
              },
            },
            required: ['appId'],
          },
          // Or re-invoke with a single CLI flag:
          resumeFlags: choices.map((c) => ({
            label: c.label,
            flags: ['--app-id', String(c.appId ?? '')],
          })),
        },
      },
    );

    // Also emit the canonical structured `needs_input` event. Newer
    // orchestrators key off `type === 'needs_input'` instead of parsing
    // the legacy `prompt` payload.
    //
    // Each choice carries rich metadata (org / workspace / env / region) so
    // the outer agent can render a true searchable picker with a label
    // line, a description line, and a metadata footer.
    const needsInputChoices: NeedsInputChoice<string>[] = choices.map((c) => ({
      value: String(c.appId ?? ''),
      label: c.label,
      hint: c.envName,
      // Show a "Org > Workspace > Env" breadcrumb in widgets that support
      // a description line (Linear / Cursor / Granola pickers all do).
      description: `${c.orgName} > ${c.projectName} > ${c.envName}`,
      metadata: {
        orgId: c.orgId,
        orgName: c.orgName,
        projectId: c.projectId,
        projectName: c.projectName,
        envName: c.envName,
        appId: String(c.appId ?? ''),
        rank: c.rank,
      },
      ...(c.appId != null && {
        resumeFlags: ['--app-id', String(c.appId)],
      }),
    }));
    // Recommend the highest-ranked env that has an API key (rank 1 = Production
    // at most orgs). This lines up with the auto-select fallback below so
    // `--auto-approve` and "no input" both pick the same environment.
    const recommendedChoice =
      needsInputChoices.find((c) => c.value !== '') ?? undefined;
    const recommended = recommendedChoice?.value;
    const recommendedReason = recommendedChoice
      ? `Highest-ranked environment in the first available workspace (${recommendedChoice.description}).`
      : undefined;
    const decisionId = this.emitNeedsInput<string>({
      code: 'environment_selection',
      message: `Multiple Amplitude environments available — select one of ${choices.length}.`,
      ui: {
        component: 'searchable_select',
        priority: 'required',
        title: 'Select an Amplitude environment',
        description:
          'Choose where events from this app should be sent. Each choice is one (org, workspace, environment) tuple.',
        searchPlaceholder: 'Search by org, workspace, environment, or app ID…',
        emptyState:
          'No Amplitude environments found. Create a project at https://app.amplitude.com first.',
      },
      choices: needsInputChoices,
      recommended,
      recommendedReason,
      resumeFlags: choices
        .filter((c) => c.appId != null)
        .map((c) => ({
          value: String(c.appId),
          flags: ['--app-id', String(c.appId)],
        })),
      // JSON Schema 2020-12 fragment — replaces the v2 English-in-JSON
      // shape so non-Claude orchestrators can run `ajv` / `jsonschema`
      // directly. We use `pattern: '^\\d+$'` (not `enum`) because
      // `allowManualEntry: true` lets orchestrators legitimately submit
      // an above-cap app-id that didn't make the choices list.
      responseSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          appId: {
            type: 'string',
            pattern: '^\\d+$',
            description:
              'Numeric Amplitude app ID — must match one of choices[].value, or any valid app ID when allowManualEntry is true.',
          },
        },
        required: ['appId'],
      },
      // Pagination is signalled even when all choices fit so outer agents
      // can surface the total. When the wizard caps the payload at
      // MAX_ENV_SELECTION_CHOICES (currently 50), `total` carries the
      // pre-cap count and `returned` the post-cap count — so
      // `total > returned` is the orchestrator's signal to surface the
      // manualEntry hint or run a separate `wizard projects list` (when
      // it lands). `nextCommand` is intentionally omitted: there's no
      // dedicated "list more envs" subcommand yet, and stubbing one in
      // the wire would lock us into a shape we haven't designed.
      pagination: {
        total: sortedChoices.length,
        returned: needsInputChoices.length,
      },
      // Allow free-form `--app-id` entry when none of the listed choices fit
      // (e.g. a brand-new project the cached fetch missed).
      allowManualEntry: true,
      manualEntry: {
        flag: '--app-id',
        placeholder: 'Enter Amplitude app ID (e.g. 769610)',
        pattern: '^\\d+$',
      },
    });

    // Read one line from stdin. Parsing + matching is a pure helper so tests
    // can exercise it without stdin mocking. Outcomes:
    //   - no line / timeout / invalid JSON / empty object → auto-select
    //   - specific appId that matches → return it
    //   - selector provided but doesn't match → throw, so the caller emits
    //     `auth_required: env_selection_failed` instead of silently picking
    //     the wrong environment (a data-integrity risk).
    const line = await readStdinLine(60_000).catch(() => null);
    const { parsed, rejectionMessage } = parseEnvSelectionStdinLine(line);
    if (rejectionMessage) {
      emit('log', rejectionMessage, { level: 'warn' });
    }

    // Validate stdin against the PRE-CAP `sortedChoices`, not the capped
    // `choices`. The wire contract advertises `allowManualEntry: true` with
    // `pagination.total > pagination.returned`, telling orchestrators that
    // above-cap entries are valid; rejecting an above-cap app-id forwarded
    // on stdin would contradict the manualEntry contract.
    const outcome = resolveEnvSelectionFromStdin(parsed, sortedChoices);
    for (const warning of outcome.warnings) {
      emit('log', warning, { level: 'warn' });
    }
    if (outcome.kind === 'selected') {
      return outcome.selection;
    }
    if (outcome.kind === 'mismatch') {
      throw new Error(outcome.reason);
    }

    // `--confirm-app` (env-var bridge: AMPLITUDE_WIZARD_CONFIRM_APP=1) means
    // the caller demanded an explicit app selection. If we got here without a
    // stdin answer, the orchestrator either timed out or didn't know to
    // respond — either way, refusing to auto-select is the safer behavior.
    // The needs_input event has already been emitted above; throwing here
    // bubbles up through the wizard's normal abort path, which routes the
    // exit through `wizardAbort` and produces a clean `run_completed` with
    // a non-zero exit code. The orchestrator can branch on `needs_input`
    // (was emitted) + non-success exit. This is the contract that prevents
    // the "wizard wrote to the wrong project" class of failure.
    if (process.env.AMPLITUDE_WIZARD_CONFIRM_APP) {
      emit(
        'log',
        'Refusing to auto-select an environment because --confirm-app is set. Re-invoke with --app-id <id> after the user picks one.',
        { level: 'warn' },
      );
      throw new Error(
        '--confirm-app set: refusing to auto-select an environment. Re-invoke with --app-id <id>.',
      );
    }

    // Fallback: auto-select the first entry from sortedChoices so the
    // pick is identical to `recommended` (both derive from the same
    // (rank, orgName, projectName, envName) ordering).
    const autoChoice = sortedChoices[0];
    if (autoChoice) {
      emit(
        'log',
        `Auto-selected environment: ${autoChoice.orgName} / ${autoChoice.projectName} / ${autoChoice.envName}`,
        {
          level: 'warn',
        },
      );
      // Companion `decision_auto` for the `needs_input:
      // environment_selection` emitted above. Closes the
      // request/response correlation loop — orchestrators that
      // subscribe to `needs_input` see a matching `decision_auto`
      // tagged with the same `decisionId` instead of having to
      // infer "the wizard auto-picked" from the absence of a
      // resolution envelope. Stringified `appId` echoes the wire
      // shape on `NeedsInputChoice.value`.
      emitDecisionAuto({
        code: 'environment_selection',
        decisionId,
        value: String(autoChoice.appId ?? ''),
        reason: 'auto_approve',
      });
      return {
        orgId: autoChoice.orgId,
        projectId: autoChoice.projectId,
        env: autoChoice.envName,
      };
    }

    throw new Error('No environments with API keys found');
  }
}

/**
 * Read a single line from stdin with a timeout.
 * Returns null if stdin is not readable or times out.
 */
function readStdinLine(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    if (!process.stdin.readable) {
      resolve(null);
      return;
    }

    const rl = createInterface({ input: process.stdin });
    const timer = setTimeout(() => {
      rl.close();
      resolve(null);
    }, timeoutMs);

    rl.once('line', (line) => {
      clearTimeout(timer);
      rl.close();
      resolve(line.trim());
    });

    rl.once('close', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}
