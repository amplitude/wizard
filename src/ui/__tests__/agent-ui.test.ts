import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentUI } from '../agent-ui.js';
import { initCorrelation } from '../../lib/observability/correlation';

interface NDJSONEvent {
  v: 1;
  '@timestamp': string;
  type: string;
  message: string;
  session_id?: string;
  run_id?: string;
  data?: Record<string, unknown>;
  level?: string;
}

describe('AgentUI.emitAuthRequired', () => {
  let writes: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writes = [];
    spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  const lastEvent = (): NDJSONEvent => {
    const last = writes[writes.length - 1];
    return JSON.parse(last.trim()) as NDJSONEvent;
  };

  it('emits a lifecycle event with event: "auth_required"', () => {
    const ui = new AgentUI();
    ui.emitAuthRequired({
      reason: 'no_stored_credentials',
      instruction: 'Please log in.',
      loginCommand: ['npx', '@amplitude/wizard', 'login'],
      resumeCommand: ['npx', '@amplitude/wizard', '--agent'],
    });

    const event = lastEvent();
    expect(event.v).toBe(1);
    expect(event.type).toBe('lifecycle');
    expect(event.level).toBe('error');
    expect(event.message).toBe('Please log in.');
    expect(event.data).toMatchObject({
      event: 'auth_required',
      reason: 'no_stored_credentials',
      loginCommand: ['npx', '@amplitude/wizard', 'login'],
      resumeCommand: ['npx', '@amplitude/wizard', '--agent'],
    });
  });

  it('omits resumeCommand when not supplied', () => {
    const ui = new AgentUI();
    ui.emitAuthRequired({
      reason: 'env_selection_failed',
      instruction: 'Pick an env.',
      loginCommand: ['amplitude-wizard', 'login'],
    });

    const event = lastEvent();
    expect(event.data).toMatchObject({
      event: 'auth_required',
      reason: 'env_selection_failed',
    });
    expect(event.data?.resumeCommand).toBeUndefined();
  });

  it('accepts all documented reasons', () => {
    const ui = new AgentUI();
    const reasons = [
      'no_stored_credentials',
      'token_expired',
      'refresh_failed',
      'env_selection_failed',
    ] as const;

    for (const reason of reasons) {
      ui.emitAuthRequired({
        reason,
        instruction: `reason: ${reason}`,
        loginCommand: ['amplitude-wizard', 'login'],
      });
    }

    expect(writes.length).toBe(reasons.length);
    writes.forEach((line, i) => {
      const event = JSON.parse(line.trim()) as NDJSONEvent;
      expect(event.data?.reason).toBe(reasons[i]);
    });
  });
});

describe('AgentUI.emitNestedAgent', () => {
  let writes: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writes = [];
    spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  const lastEvent = (): NDJSONEvent => {
    const last = writes[writes.length - 1];
    return JSON.parse(last.trim()) as NDJSONEvent;
  };

  it('emits a lifecycle event with event: "nested_agent"', () => {
    const ui = new AgentUI();
    ui.emitNestedAgent({
      signal: 'claude_code_cli',
      envVar: 'CLAUDECODE',
      instruction: 'Refusing to run nested.',
      bypassEnv: 'AMPLITUDE_WIZARD_ALLOW_NESTED',
    });

    const event = lastEvent();
    expect(event.v).toBe(1);
    expect(event.type).toBe('lifecycle');
    expect(event.level).toBe('info');
    expect(event.message).toBe('Refusing to run nested.');
    expect(event.data).toMatchObject({
      event: 'nested_agent',
      signal: 'claude_code_cli',
      detectedEnvVar: 'CLAUDECODE',
      bypassEnv: 'AMPLITUDE_WIZARD_ALLOW_NESTED',
    });
  });

  it('distinguishes the two signal sources', () => {
    const ui = new AgentUI();
    ui.emitNestedAgent({
      signal: 'claude_agent_sdk',
      envVar: 'CLAUDE_CODE_ENTRYPOINT',
      instruction: 'Refusing to run nested.',
      bypassEnv: 'AMPLITUDE_WIZARD_ALLOW_NESTED',
    });

    const event = lastEvent();
    expect(event.data).toMatchObject({
      signal: 'claude_agent_sdk',
      detectedEnvVar: 'CLAUDE_CODE_ENTRYPOINT',
    });
  });
});

describe('AgentUI.promptEnvironmentSelection — prompt event shape', () => {
  let writes: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writes = [];
    spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  // Agents parse stdin synchronously in production; we short-circuit the
  // 60-second stdin wait by pointing process.stdin to a non-readable state
  // so the method falls through to auto-select after emitting the prompt.
  const runPromptAndGetFirst = async (
    ui: AgentUI,
    orgs: Parameters<AgentUI['promptEnvironmentSelection']>[0],
  ): Promise<NDJSONEvent> => {
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: { readable: false },
    });
    try {
      await ui.promptEnvironmentSelection(orgs);
    } finally {
      Object.defineProperty(process, 'stdin', {
        configurable: true,
        value: originalStdin,
      });
    }
    return JSON.parse(writes[0].trim()) as NDJSONEvent;
  };

  it('emits flat choices[] so agents can pick without tree traversal', async () => {
    const ui = new AgentUI();
    const event = await runPromptAndGetFirst(ui, [
      {
        id: 'org-1',
        name: 'DevX',
        workspaces: [
          {
            id: 'ws-a',
            name: 'Sandbox',
            environments: [
              {
                name: 'Production',
                rank: 1,
                app: { id: '100001', apiKey: 'k1' },
              },
              {
                name: 'Development',
                rank: 2,
                app: { id: '100002', apiKey: 'k2' },
              },
            ],
          },
        ],
      },
    ]);

    expect(event.type).toBe('prompt');
    const data = event.data as {
      promptType: string;
      hierarchy: string[];
      choices: Array<{
        orgId: string;
        orgName: string;
        workspaceId: string;
        workspaceName: string;
        projectId: string | null;
        envName: string;
        label: string;
      }>;
    };
    expect(data.promptType).toBe('environment_selection');
    expect(data.hierarchy).toEqual([
      'org',
      'workspace',
      'project',
      'environment',
    ]);
    expect(data.choices).toHaveLength(2);
    expect(data.choices[0]).toMatchObject({
      orgId: 'org-1',
      orgName: 'DevX',
      workspaceId: 'ws-a',
      workspaceName: 'Sandbox',
      projectId: '100001',
      envName: 'Production',
      label: 'DevX / Sandbox / Production',
    });
  });

  it('never leaks API keys in the prompt event', async () => {
    const ui = new AgentUI();
    await runPromptAndGetFirst(ui, [
      {
        id: 'org-1',
        name: 'DevX',
        workspaces: [
          {
            id: 'ws-a',
            name: 'Sandbox',
            environments: [
              {
                name: 'Production',
                rank: 1,
                app: { id: '100001', apiKey: 'super-secret-key' },
              },
            ],
          },
        ],
      },
    ]);

    expect(writes[0]).not.toContain('super-secret-key');
  });

  it('surfaces resumeFlags with --project-id for unambiguous re-invocation', async () => {
    const ui = new AgentUI();
    const event = await runPromptAndGetFirst(ui, [
      {
        id: 'org-1',
        name: 'DevX',
        workspaces: [
          {
            id: 'ws-a',
            name: 'Sandbox',
            environments: [
              {
                name: 'Development',
                rank: 1,
                app: { id: '100002', apiKey: 'k2' },
              },
            ],
          },
        ],
      },
    ]);

    const data = event.data as {
      resumeFlags: Array<{ label: string; flags: string[] }>;
    };
    expect(data.resumeFlags).toHaveLength(1);
    expect(data.resumeFlags[0].flags).toEqual([
      '--project-id',
      '100002',
      '--env',
      'Development',
    ]);
  });
});
/**
 * AgentUI NDJSON output tests.
 *
 * Every AgentUI method emits exactly one JSON line to stdout. These tests spy
 * on process.stdout.write, instantiate AgentUI, invoke methods, and assert on
 * the parsed NDJSON shape.
 *
 * Security-critical assertions:
 *   - setCredentials() never leaks accessToken or projectApiKey in output
 *   - setRunError() redacts absolute paths and URLs from error messages
 */

type StdoutWrite = typeof process.stdout.write;

/**
 * Captured NDJSON event parsed from the last stdout.write call.
 * Includes newline presence assertion.
 */
interface CapturedEvent {
  raw: string;
  parsed: Record<string, unknown>;
}

function captureEvents(spy: ReturnType<typeof vi.spyOn>): CapturedEvent[] {
  return spy.mock.calls.map((call) => {
    const raw = String(call[0]);
    // Every emit() call writes a single JSON line terminated by \n.
    expect(raw.endsWith('\n')).toBe(true);
    const line = raw.replace(/\n$/, '');
    return { raw, parsed: JSON.parse(line) as Record<string, unknown> };
  });
}

function single(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const events = captureEvents(spy);
  expect(events).toHaveLength(1);
  return events[0].parsed;
}

/** Assert that the event has the common envelope fields (v, @timestamp, type, message, ids). */
function assertEnvelope(
  event: Record<string, unknown>,
  expected: { type: string; messageLike?: string | RegExp },
): void {
  expect(event.v).toBe(1);
  expect(typeof event['@timestamp']).toBe('string');
  // ISO timestamp should be parseable.
  const ts = new Date(event['@timestamp'] as string);
  expect(Number.isNaN(ts.getTime())).toBe(false);
  expect(event.type).toBe(expected.type);
  expect(typeof event.message).toBe('string');
  if (expected.messageLike instanceof RegExp) {
    expect(event.message).toMatch(expected.messageLike);
  } else if (typeof expected.messageLike === 'string') {
    expect(event.message).toBe(expected.messageLike);
  }
  expect(typeof event.session_id).toBe('string');
  expect(typeof event.run_id).toBe('string');
  expect((event.session_id as string).length).toBeGreaterThan(0);
  expect((event.run_id as string).length).toBeGreaterThan(0);
}

describe('AgentUI NDJSON output', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let ui: AgentUI;

  beforeEach(() => {
    // Deterministic correlation IDs so assertions don't depend on UUID generation.
    initCorrelation('test-session-id');
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((
      _chunk: string | Uint8Array,
      _encoding?: unknown,
      cb?: (err?: Error | null) => void,
    ) => {
      if (typeof cb === 'function') cb();
      return true;
    }) as StdoutWrite);
    ui = new AgentUI();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    test('intro() emits type=lifecycle with event=intro', () => {
      ui.intro('Welcome to the wizard');
      const event = single(stdoutSpy);
      assertEnvelope(event, {
        type: 'lifecycle',
        messageLike: 'Welcome to the wizard',
      });
      expect(event.data).toEqual({ event: 'intro' });
    });

    test('outro() emits type=lifecycle with event=outro', () => {
      ui.outro('All done!');
      const event = single(stdoutSpy);
      assertEnvelope(event, { type: 'lifecycle', messageLike: 'All done!' });
      expect(event.data).toEqual({ event: 'outro' });
    });

    test('cancel() includes docsUrl in data', () => {
      ui.cancel('Cancelled by user', { docsUrl: 'https://docs.amplitude.com' });
      const event = single(stdoutSpy);
      assertEnvelope(event, {
        type: 'lifecycle',
        messageLike: 'Cancelled by user',
      });
      expect(event.data).toEqual({
        event: 'cancel',
        docsUrl: 'https://docs.amplitude.com',
      });
    });

    test('cancel() without options leaves docsUrl undefined', () => {
      ui.cancel('Cancelled');
      const event = single(stdoutSpy);
      const data = event.data as Record<string, unknown>;
      expect(data.event).toBe('cancel');
      expect(data.docsUrl).toBeUndefined();
    });

    test('startRun() emits type=lifecycle with event=start_run', () => {
      ui.startRun();
      const event = single(stdoutSpy);
      assertEnvelope(event, { type: 'lifecycle' });
      expect(event.data).toEqual({ event: 'start_run' });
    });
  });

  // ── Logging ───────────────────────────────────────────────────────────

  describe('log', () => {
    test.each([
      ['info', 'info message'],
      ['warn', 'warn message'],
      ['error', 'error message'],
      ['success', 'success message'],
      ['step', 'step message'],
    ] as const)('log.%s() emits type=log with correct level', (level, msg) => {
      (ui.log as Record<string, (m: string) => void>)[level](msg);
      const event = single(stdoutSpy);
      assertEnvelope(event, { type: 'log', messageLike: msg });
      expect(event.level).toBe(level);
    });
  });

  // ── Session state ─────────────────────────────────────────────────────

  describe('session state', () => {
    test('setRegion() emits session_state with field=region and value', () => {
      ui.setRegion('US');
      const event = single(stdoutSpy);
      assertEnvelope(event, { type: 'session_state' });
      expect(event.data).toEqual({ field: 'region', value: 'US' });
    });

    test('setDetectedFramework() emits field=detectedFramework', () => {
      ui.setDetectedFramework('nextjs');
      const event = single(stdoutSpy);
      assertEnvelope(event, { type: 'session_state' });
      expect(event.data).toEqual({
        field: 'detectedFramework',
        value: 'nextjs',
      });
    });

    test('setProjectHasData(true) emits field=projectHasData with boolean', () => {
      ui.setProjectHasData(true);
      const event = single(stdoutSpy);
      assertEnvelope(event, { type: 'session_state' });
      expect(event.data).toEqual({ field: 'projectHasData', value: true });
    });

    test('setProjectHasData(false) emits field=projectHasData with false', () => {
      ui.setProjectHasData(false);
      const event = single(stdoutSpy);
      expect(event.data).toEqual({ field: 'projectHasData', value: false });
    });

    test('setLoginUrl(url) emits loginUrl field with value', () => {
      ui.setLoginUrl('https://amplitude.com/login');
      const event = single(stdoutSpy);
      assertEnvelope(event, { type: 'session_state' });
      expect(event.data).toEqual({
        field: 'loginUrl',
        value: 'https://amplitude.com/login',
      });
    });

    test('setLoginUrl(null) emits loginUrl field with null value', () => {
      ui.setLoginUrl(null);
      const event = single(stdoutSpy);
      expect(event.data).toEqual({ field: 'loginUrl', value: null });
    });
  });

  // ── Redaction (security-critical) ─────────────────────────────────────

  describe('redaction', () => {
    test('setCredentials() never leaks accessToken or projectApiKey', () => {
      const accessToken = 'supersecret-access-token-ABCDEF1234567890';
      const projectApiKey = 'projapi-key-xyz-9876543210';
      ui.setCredentials({
        accessToken,
        projectApiKey,
        host: 'https://api2.amplitude.com',
        projectId: 12345,
      });

      const events = captureEvents(stdoutSpy);
      expect(events).toHaveLength(1);
      const { raw, parsed } = events[0];

      // Raw JSON string must not contain either credential substring, anywhere.
      expect(raw).not.toContain(accessToken);
      expect(raw).not.toContain(projectApiKey);
      expect(raw).not.toContain('accessToken');
      expect(raw).not.toContain('projectApiKey');

      // Non-sensitive fields are preserved.
      assertEnvelope(parsed, { type: 'session_state' });
      const data = parsed.data as Record<string, unknown>;
      expect(data.field).toBe('credentials');
      expect(data.host).toBe('https://api2.amplitude.com');
      expect(data.projectId).toBe(12345);
    });

    test('setRunError() redacts absolute paths and URLs from error messages', async () => {
      const err = new Error(
        'failed at /Users/foo/bar with https://secret.example.com',
      );
      await ui.setRunError(err);

      const events = captureEvents(stdoutSpy);
      expect(events).toHaveLength(1);
      const { raw, parsed } = events[0];

      // The raw emitted line must not contain the original path or URL.
      expect(raw).not.toContain('/Users/foo/bar');
      expect(raw).not.toContain('https://secret.example.com');

      assertEnvelope(parsed, { type: 'error' });
      expect(parsed.message).not.toContain('/Users/foo/bar');
      expect(parsed.message).not.toContain('https://secret.example.com');
      const data = parsed.data as Record<string, unknown>;
      expect(data.name).toBe('Error');
    });

    test('setRunError() resolves to false (no retry in agent mode)', async () => {
      const err = new Error('boom');
      await expect(ui.setRunError(err)).resolves.toBe(false);
    });
  });

  // ── Prompts (auto-approve) ────────────────────────────────────────────

  describe('prompts (auto-approve)', () => {
    test('promptConfirm() resolves true and emits autoResult=true', async () => {
      const result = await ui.promptConfirm('Proceed?');
      expect(result).toBe(true);

      const event = single(stdoutSpy);
      assertEnvelope(event, { type: 'prompt', messageLike: 'Proceed?' });
      const data = event.data as Record<string, unknown>;
      expect(data.promptType).toBe('confirm');
      expect(data.autoResult).toBe(true);
    });

    test('promptChoice() resolves first option and emits autoResult', async () => {
      const result = await ui.promptChoice('Pick one', ['a', 'b', 'c']);
      expect(result).toBe('a');

      const event = single(stdoutSpy);
      assertEnvelope(event, { type: 'prompt', messageLike: 'Pick one' });
      const data = event.data as Record<string, unknown>;
      expect(data.promptType).toBe('choice');
      expect(data.options).toEqual(['a', 'b', 'c']);
      expect(data.autoResult).toBe('a');
    });

    test('promptChoice() with empty options resolves to empty string', async () => {
      const result = await ui.promptChoice('Pick one', []);
      expect(result).toBe('');

      const event = single(stdoutSpy);
      const data = event.data as Record<string, unknown>;
      expect(data.autoResult).toBe('');
    });

    test('promptEventPlan() resolves to { decision: approved }', async () => {
      const events = [
        { name: 'signup', description: 'user signs up' },
        { name: 'purchase', description: 'user purchases' },
      ];
      const result = await ui.promptEventPlan(events);
      expect(result).toEqual({ decision: 'approved' });

      const event = single(stdoutSpy);
      assertEnvelope(event, { type: 'result' });
      const data = event.data as Record<string, unknown>;
      expect(data.event).toBe('event_plan');
      expect(data.events).toEqual(events);
    });
  });

  // ── Progress and results ──────────────────────────────────────────────

  describe('progress and results', () => {
    test('syncTodos() emits type=progress with data.todos', () => {
      const todos = [
        { content: 'Install SDK', status: 'completed' },
        { content: 'Add events', status: 'in_progress' },
      ];
      ui.syncTodos(todos);

      const event = single(stdoutSpy);
      assertEnvelope(event, { type: 'progress' });
      expect(event.data).toEqual({ todos });
    });

    test('setEventPlan() emits type=result with event=event_plan_set', () => {
      const events = [
        { name: 'signup', description: 'user signs up' },
        { name: 'checkout', description: 'user checks out' },
      ];
      ui.setEventPlan(events);

      const event = single(stdoutSpy);
      assertEnvelope(event, { type: 'result' });
      const data = event.data as Record<string, unknown>;
      expect(data.event).toBe('event_plan_set');
      expect(data.events).toEqual(events);
    });

    test('setEventIngestionDetected() emits event=events_detected with names', () => {
      ui.setEventIngestionDetected(['signup', 'login']);
      const event = single(stdoutSpy);
      assertEnvelope(event, { type: 'result' });
      const data = event.data as Record<string, unknown>;
      expect(data.event).toBe('events_detected');
      expect(data.eventNames).toEqual(['signup', 'login']);
    });

    test('setDashboardUrl() emits type=result with dashboardUrl', () => {
      const url = 'https://app.amplitude.com/dashboard/abc123';
      ui.setDashboardUrl(url);

      const event = single(stdoutSpy);
      assertEnvelope(event, { type: 'result' });
      const data = event.data as Record<string, unknown>;
      expect(data.event).toBe('dashboard_created');
      expect(data.dashboardUrl).toBe(url);
    });
  });

  // ── Envelope invariants ───────────────────────────────────────────────

  describe('envelope invariants', () => {
    test('every emitted event has v=1, ISO @timestamp, type, message', () => {
      ui.intro('intro');
      ui.log.info('info');
      ui.setRegion('US');
      ui.startRun();
      ui.setEventPlan([{ name: 'x', description: 'y' }]);

      const events = captureEvents(stdoutSpy);
      expect(events).toHaveLength(5);
      for (const { parsed } of events) {
        expect(parsed.v).toBe(1);
        expect(typeof parsed['@timestamp']).toBe('string');
        expect(
          Number.isNaN(new Date(parsed['@timestamp'] as string).getTime()),
        ).toBe(false);
        expect(typeof parsed.type).toBe('string');
        expect(typeof parsed.message).toBe('string');
      }
    });

    test('every emitted event has session_id and run_id', () => {
      ui.log.info('hello');
      ui.setRegion('EU');

      const events = captureEvents(stdoutSpy);
      expect(events).toHaveLength(2);
      for (const { parsed } of events) {
        expect(typeof parsed.session_id).toBe('string');
        expect(typeof parsed.run_id).toBe('string');
        expect((parsed.session_id as string).length).toBeGreaterThan(0);
        expect((parsed.run_id as string).length).toBeGreaterThan(0);
      }
    });

    test('emits exactly one newline-terminated JSON line per call', () => {
      ui.log.info('a');
      ui.log.warn('b');
      ui.log.error('c');

      expect(stdoutSpy).toHaveBeenCalledTimes(3);
      for (const call of stdoutSpy.mock.calls) {
        const chunk = String(call[0]);
        expect(chunk.endsWith('\n')).toBe(true);
        // Exactly one trailing newline (no intermediate newlines inside JSON).
        expect(chunk.match(/\n/g)?.length).toBe(1);
        expect(() => JSON.parse(chunk)).not.toThrow();
      }
    });
  });
});
