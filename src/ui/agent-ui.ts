/**
 * AgentUI — NDJSON implementation of WizardUI for --agent mode.
 * Every method emits one JSON line to stdout for machine consumption.
 * Prompts auto-approve; no interactivity.
 */

import type { WizardUI, SpinnerHandle, EventPlanDecision } from './wizard-ui';
import { createInterface } from 'readline';

// ── NDJSON event types ──────────────────────────────────────────────

type NDJSONEventType =
  | 'lifecycle'
  | 'log'
  | 'status'
  | 'progress'
  | 'session_state'
  | 'prompt'
  | 'diagnostic'
  | 'result'
  | 'error';

interface NDJSONEvent {
  v: 1;
  '@timestamp': string;
  type: NDJSONEventType;
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
  type: NDJSONEventType,
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
    emit('prompt', message, {
      data: { promptType: 'confirm', autoResult: true },
    });
    return Promise.resolve(true);
  }

  promptChoice(message: string, options: string[]): Promise<string> {
    const selected = options[0] ?? '';
    emit('prompt', message, {
      data: { promptType: 'choice', options, autoResult: selected },
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

  setEventPlan(events: Array<{ name: string; description: string }>): void {
    emit('result', `event_plan: ${events.length} events`, {
      data: { event: 'event_plan_set', events },
    });
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

    // Read one line from stdin. Accept either the canonical { appId } shape
    // or the legacy { orgId, workspaceId, env } triple or { projectId } alias.
    try {
      const line = await readStdinLine(60_000);
      if (line) {
        const parsed = JSON.parse(line) as {
          appId?: string;
          projectId?: string;
          orgId?: string;
          workspaceId?: string;
          env?: string;
        };
        const selectedAppId = parsed.appId ?? parsed.projectId;
        if (selectedAppId) {
          if (parsed.projectId && !parsed.appId) {
            emit(
              'log',
              'Legacy { projectId } selection shape is deprecated — prefer { appId }.',
              { level: 'warn' },
            );
          }
          const match = choices.find(
            (c) => String(c.appId) === String(selectedAppId),
          );
          if (match) {
            return {
              orgId: match.orgId,
              workspaceId: match.workspaceId,
              env: match.envName,
            };
          }
        }
        if (parsed.orgId && parsed.workspaceId && parsed.env) {
          emit(
            'log',
            'Legacy { orgId, workspaceId, env } selection shape is deprecated — prefer { appId }.',
            { level: 'warn' },
          );
          return {
            orgId: parsed.orgId,
            workspaceId: parsed.workspaceId,
            env: parsed.env,
          };
        }
      }
    } catch {
      // Stdin closed, timeout, or invalid JSON — fall through to auto-select
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
