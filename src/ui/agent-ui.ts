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
    projectId: number;
  }): void {
    emit('session_state', 'credentials_set', {
      data: {
        field: 'credentials',
        host: credentials.host,
        projectId: credentials.projectId,
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
   * { "orgId": "...", "workspaceId": "...", "env": "Production" }
   * ```
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
    // Build a sanitized view (no API keys exposed)
    const sanitizedOrgs = orgs.map((org) => ({
      id: org.id,
      name: org.name,
      workspaces: org.workspaces.map((ws) => ({
        id: ws.id,
        name: ws.name,
        environments: (ws.environments ?? [])
          .filter((e) => e.app?.apiKey)
          .sort((a, b) => a.rank - b.rank)
          .map((e) => ({ name: e.name, rank: e.rank })),
      })),
    }));

    emit('prompt', 'Select an environment', {
      data: {
        promptType: 'environment_selection',
        orgs: sanitizedOrgs,
      },
    });

    // Read one line from stdin
    try {
      const line = await readStdinLine(60_000);
      if (line) {
        const parsed = JSON.parse(line) as {
          orgId?: string;
          workspaceId?: string;
          env?: string;
        };
        if (parsed.orgId && parsed.workspaceId && parsed.env) {
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
