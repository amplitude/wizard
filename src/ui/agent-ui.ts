/**
 * AgentUI — NDJSON implementation of WizardUI for --agent mode.
 * Every method emits one JSON line to stdout for machine consumption.
 * Prompts auto-approve; no interactivity.
 */

import type { WizardUI, SpinnerHandle, EventPlanDecision } from './wizard-ui';
import type { RetryState } from '../lib/wizard-session';
import type {
  AgentEventType,
  NeedsInputChoice,
  NeedsInputData,
  NeedsInputWireData,
  InnerAgentStartedData,
  ToolCallData,
  FileChangePlannedData,
  FileChangeAppliedData,
  EventPlanProposedData,
  EventPlanConfirmedData,
  VerificationStartedData,
  VerificationResultData,
} from '../lib/agent-events';
import { createInterface } from 'readline';
import { z } from 'zod';

/**
 * Stdin response schema for `promptEnvironmentSelection`.
 *
 * External input (from AI orchestrators) — parse with zod rather than an
 * `as` cast so bad shapes get rejected instead of silently falling through
 * to auto-select.
 *
 * Canonical shape: `{ appId }`.
 * Legacy shapes still accepted (with a deprecation warning):
 *   - `{ projectId }` (old name for appId)
 *   - `{ orgId, workspaceId, env }` (pre-appId triple)
 */
const EnvSelectionStdinSchema = z.object({
  appId: z.string().optional(),
  projectId: z.string().optional(),
  orgId: z.string().optional(),
  workspaceId: z.string().optional(),
  env: z.string().optional(),
});
type EnvSelectionStdin = z.infer<typeof EnvSelectionStdinSchema>;

/** Flat choice shape exposed in the prompt event and matched against stdin. */
export interface EnvSelectionChoice {
  orgId: string;
  orgName: string;
  workspaceId: string;
  workspaceName: string;
  appId: string | null;
  envName: string;
  rank: number;
  label: string;
}

/** Resolved selection returned from the env-selection prompt. */
export interface EnvSelection {
  orgId: string;
  workspaceId: string;
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

  const selectedAppId = parsed.appId ?? parsed.projectId;
  if (selectedAppId) {
    if (parsed.projectId && !parsed.appId) {
      warnings.push(
        'Legacy { projectId } selection shape is deprecated — prefer { appId }.',
      );
    }
    const match = choices.find(
      (c) => String(c.appId) === String(selectedAppId),
    );
    if (match) {
      return {
        kind: 'selected',
        selection: {
          orgId: match.orgId,
          workspaceId: match.workspaceId,
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

  if (parsed.orgId && parsed.workspaceId && parsed.env) {
    warnings.push(
      'Legacy { orgId, workspaceId, env } selection shape is deprecated — prefer { appId }.',
    );
    const envLower = parsed.env.toLowerCase();
    const match = choices.find(
      (c) =>
        c.orgId === parsed.orgId &&
        c.workspaceId === parsed.workspaceId &&
        c.envName.toLowerCase() === envLower,
    );
    if (!match) {
      return {
        kind: 'mismatch',
        reason: `Environment selection { orgId: ${parsed.orgId}, workspaceId: ${parsed.workspaceId}, env: ${parsed.env} } did not match any of the ${choices.length} available environments.`,
        warnings,
      };
    }
    return {
      kind: 'selected',
      selection: {
        orgId: parsed.orgId,
        workspaceId: parsed.workspaceId,
        env: parsed.env,
      },
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

// ── NDJSON event types ──────────────────────────────────────────────

interface NDJSONEvent {
  v: 1;
  '@timestamp': string;
  type: AgentEventType;
  message: string;
  session_id?: string;
  run_id?: string;
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

function emit(
  type: AgentEventType,
  message: string,
  extra?: Omit<NDJSONEvent, 'v' | '@timestamp' | 'type' | 'message'>,
): void {
  const { session_id, run_id } = getCorrelationIds();
  const event: NDJSONEvent = {
    v: 1,
    '@timestamp': new Date().toISOString(),
    type,
    message,
    session_id,
    run_id,
    ...extra,
  };
  process.stdout.write(JSON.stringify(event) + '\n');
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

  cancel(message: string, options?: { docsUrl?: string }): void {
    emit('lifecycle', message, {
      data: { event: 'cancel', docsUrl: options?.docsUrl },
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
      | 'env_selection_failed';
    instruction: string;
    loginCommand: string[];
    resumeCommand?: string[];
  }): void {
    emit('lifecycle', data.instruction, {
      level: 'error',
      data: {
        event: 'auth_required',
        reason: data.reason,
        loginCommand: data.loginCommand,
        resumeCommand: data.resumeCommand,
      },
    });
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
    // can read it from the project-local .env.local / keychain if needed.
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
      | 'INTERNAL'
      | 'MISSING_NAME'
      | 'MISSING_ORG';
    message: string;
    name?: string;
  }): void {
    emit('error', data.message, {
      level: 'error',
      data: {
        event: 'project_create_error',
        code: data.code,
        name: data.name,
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
   */
  emitNeedsInput<V = string>(data: NeedsInputData<V>): void {
    const wireData: NeedsInputWireData<V> = {
      event: 'needs_input',
      code: data.code,
      choices: data.choices,
      recommended: data.recommended,
      resumeFlags: data.resumeFlags,
      responseSchema: data.responseSchema,
    };
    emit('needs_input', data.message, { data: wireData });
  }

  // ── Inner-agent lifecycle ───────────────────────────────────────────
  //
  // Emitted from agent-interface hooks (PreToolUse / PostToolUse /
  // SessionStart / Stop) so outer agents can mirror what the inner Claude
  // SDK is doing. Each emitter is a thin wrapper over `emit()` so the
  // wire format stays consistent with the rest of agent-mode output.

  /**
   * Inner Claude SDK has booted and is about to start its first turn.
   * Carries the model name and the wizard phase (plan / apply / verify /
   * wizard) so the outer agent can attribute downstream events.
   */
  emitInnerAgentStarted(data: Omit<InnerAgentStartedData, 'event'>): void {
    emit('lifecycle', `inner_agent_started: ${data.model}`, {
      data: { event: 'inner_agent_started', ...data },
    });
  }

  /**
   * The inner agent is about to call a tool. Use the helper
   * `summarizeToolInput` from `agent-events` to build a privacy-safe
   * `summary` rather than passing the raw input through.
   */
  emitToolCall(data: Omit<ToolCallData, 'event'>): void {
    emit(
      'progress',
      data.summary
        ? `tool: ${data.tool} — ${data.summary}`
        : `tool: ${data.tool}`,
      { data: { event: 'tool_call', ...data } },
    );
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

  heartbeat(statuses: string[]): void {
    if (statuses.length === 0) return;
    emit('status', `heartbeat: ${statuses.length} active`, {
      data: { kind: 'heartbeat', statuses },
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

  // ── Session state ───────────────────────────────────────────────────

  startRun(): void {
    emit('lifecycle', 'run_started', { data: { event: 'start_run' } });
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
    emit('error', sanitized, {
      data: { name: error.name },
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
    workspaceId?: string | null;
    workspaceName?: string | null;
    envName?: string | null;
  }): void {
    emit('session_state', 'credentials_set', {
      data: {
        field: 'credentials',
        host: credentials.host,
        // appId is the canonical Amplitude app ID (Amplitude's UI labels this
        // "Project ID"). envName is the env label (Production/Dev/etc).
        appId: credentials.appId,
        orgId: credentials.orgId ?? null,
        orgName: credentials.orgName ?? null,
        workspaceId: credentials.workspaceId ?? null,
        workspaceName: credentials.workspaceName ?? null,
        envName: credentials.envName ?? null,
      },
    });
  }

  setRegion(region: string): void {
    emit('session_state', `region: ${region}`, {
      data: { field: 'region', value: region },
    });
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

  showSettingsOverride(
    keys: string[],
    backupAndFix: () => boolean,
  ): Promise<void> {
    backupAndFix();
    emit('status', 'settings_override auto-fixed', {
      data: { kind: 'settings_override', keys },
    });
    return Promise.resolve();
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
    this.emitNeedsInput({
      code: 'confirm',
      message,
      choices: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
      recommended: 'yes',
    });
    return Promise.resolve(true);
  }

  promptChoice(message: string, options: string[]): Promise<string> {
    const selected = options[0] ?? '';
    emit('prompt', message, {
      data: { promptType: 'choice', options, autoResult: selected },
    });
    this.emitNeedsInput({
      code: 'choice',
      message,
      choices: options.map((opt) => ({ value: opt, label: opt })),
      recommended: selected,
    });
    return Promise.resolve(selected);
  }

  promptEventPlan(
    events: Array<{ name: string; description: string }>,
  ): Promise<EventPlanDecision> {
    emit('result', 'event_plan auto-approved', {
      data: { event: 'event_plan', events },
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

  // ── Event plan ──────────────────────────────────────────────────────

  private _eventPlan: Array<{ name: string; description: string }> = [];

  setEventPlan(events: Array<{ name: string; description: string }>): void {
    this._eventPlan = events;
    emit('result', `event_plan: ${events.length} events`, {
      data: { event: 'event_plan_set', events },
    });
  }

  getEventPlan(): Array<{ name: string; description: string }> {
    return this._eventPlan;
  }

  setEventIngestionDetected(eventNames: string[]): void {
    emit('result', `events_detected: ${eventNames.length} event types`, {
      data: { event: 'events_detected', eventNames },
    });
  }

  setDashboardUrl(url: string): void {
    emit('result', `dashboard_created: ${url}`, {
      data: { event: 'dashboard_created', dashboardUrl: url },
    });
  }

  /**
   * Prompt the agent caller to select an environment from pendingOrgs.
   *
   * Emits an NDJSON `prompt` event with all available orgs/workspaces/environments,
   * then reads one JSON line from stdin with the selection.
   *
   * Expected stdin response:
   * ```json
   * { "projectId": "769610" }
   * ```
   *
   * `projectId` alone is sufficient — it's globally unique and resolves to
   * exactly one (org, workspace, project, env) tuple. The legacy
   * `{ orgId, workspaceId, env }` shape is still accepted for one release
   * so existing orchestrators keep working.
   *
   * Falls back to auto-selecting the first environment if stdin is closed
   * or no response is received within 60 seconds.
   */
  async promptEnvironmentSelection(
    orgs: Array<{
      id: string;
      name: string;
      workspaces: Array<{
        id: string;
        name: string;
        environments?: Array<{
          name: string;
          rank: number;
          app: { id: string; apiKey?: string | null } | null;
        }> | null;
      }>;
    }>,
  ): Promise<{ orgId: string; workspaceId: string; env: string }> {
    // Build a sanitized, tree view of orgs -> workspaces -> environments.
    // API keys are never emitted (they'd leak on stdout to the orchestrator).
    const sanitizedOrgs = orgs.map((org) => ({
      id: org.id,
      name: org.name,
      workspaces: org.workspaces.map((ws) => ({
        id: ws.id,
        name: ws.name,
        environments: (ws.environments ?? [])
          .filter((e) => e.app?.apiKey)
          .sort((a, b) => a.rank - b.rank)
          .map((e) => ({
            name: e.name,
            rank: e.rank,
            appId: e.app?.id ?? null,
            hasApiKey: Boolean(e.app?.apiKey),
          })),
      })),
    }));

    // Also emit a flat list of every selectable env so agents can pick
    // without traversing the tree. Each entry is unique by
    // (orgId, workspaceId, envName) and carries the numeric appId
    // that callers can pass as --app-id for unambiguous selection.
    const choices = orgs.flatMap((org) =>
      org.workspaces.flatMap((ws) =>
        (ws.environments ?? [])
          .filter((e) => e.app?.apiKey)
          .sort((a, b) => a.rank - b.rank)
          .map((e) => ({
            orgId: org.id,
            orgName: org.name,
            workspaceId: ws.id,
            workspaceName: ws.name,
            appId: e.app?.id ?? null,
            envName: e.name,
            rank: e.rank,
            label: `${org.name} / ${ws.name} / ${e.name}`,
          })),
      ),
    );

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
          hierarchy: ['org', 'workspace', 'app', 'environment'],
          choices,
          orgs: sanitizedOrgs,
          // Agents should reply on stdin with one JSON line matching this shape:
          responseSchema: {
            appId: 'string (required, from choices[].appId)',
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
    const needsInputChoices: NeedsInputChoice<string>[] = choices.map((c) => ({
      value: String(c.appId ?? ''),
      label: c.label,
      hint: c.envName,
    }));
    const recommended =
      needsInputChoices.find((c) => c.value !== '')?.value ?? undefined;
    this.emitNeedsInput<string>({
      code: 'environment_selection',
      message: `Multiple Amplitude environments available — select one of ${choices.length}.`,
      choices: needsInputChoices,
      recommended,
      resumeFlags: choices
        .filter((c) => c.appId != null)
        .map((c) => ({
          value: String(c.appId),
          flags: ['--app-id', String(c.appId)],
        })),
      responseSchema: {
        appId: 'string (required, from choices[].value)',
      },
    });

    // Read one line from stdin. Parsing + matching is a pure helper so tests
    // can exercise it without stdin mocking. Outcomes:
    //   - no line / timeout / invalid JSON / empty object → auto-select
    //   - specific appId or legacy triple that matches → return it
    //   - selector provided but doesn't match → throw, so the caller emits
    //     `auth_required: env_selection_failed` instead of silently picking
    //     the wrong environment (a data-integrity risk).
    const line = await readStdinLine(60_000).catch(() => null);
    const { parsed, rejectionMessage } = parseEnvSelectionStdinLine(line);
    if (rejectionMessage) {
      emit('log', rejectionMessage, { level: 'warn' });
    }

    const outcome = resolveEnvSelectionFromStdin(parsed, choices);
    for (const warning of outcome.warnings) {
      emit('log', warning, { level: 'warn' });
    }
    if (outcome.kind === 'selected') {
      return outcome.selection;
    }
    if (outcome.kind === 'mismatch') {
      throw new Error(outcome.reason);
    }

    // Fallback: auto-select the first environment
    for (const org of orgs) {
      for (const ws of org.workspaces) {
        const env = (ws.environments ?? [])
          .filter((e) => e.app?.apiKey)
          .sort((a, b) => a.rank - b.rank)[0];
        if (env) {
          emit(
            'log',
            `Auto-selected environment: ${org.name} / ${ws.name} / ${env.name}`,
            {
              level: 'warn',
            },
          );
          return { orgId: org.id, workspaceId: ws.id, env: env.name };
        }
      }
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
