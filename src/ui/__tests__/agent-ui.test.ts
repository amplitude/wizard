import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AgentUI,
  parseEnvSelectionStdinLine,
  resolveEnvSelectionFromStdin,
  type EnvSelectionChoice,
} from '../agent-ui.js';

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
      instruction: 'Detected nested agent — sanitized env.',
      bypassEnv: 'AMPLITUDE_WIZARD_ALLOW_NESTED',
    });

    const event = lastEvent();
    expect(event.v).toBe(1);
    expect(event.type).toBe('lifecycle');
    expect(event.level).toBe('info');
    expect(event.message).toBe('Detected nested agent — sanitized env.');
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
      instruction: 'Detected nested agent — sanitized env.',
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
        projects: [
          {
            id: 'proj-a',
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
        projectId: string;
        projectName: string;
        appId: string | null;
        envName: string;
        label: string;
      }>;
    };
    expect(data.promptType).toBe('environment_selection');
    expect(data.hierarchy).toEqual(['org', 'project', 'app', 'environment']);
    expect(data.choices).toHaveLength(2);
    expect(data.choices[0]).toMatchObject({
      orgId: 'org-1',
      orgName: 'DevX',
      projectId: 'proj-a',
      projectName: 'Sandbox',
      appId: '100001',
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
        projects: [
          {
            id: 'proj-a',
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

  it('surfaces resumeFlags with --app-id for unambiguous re-invocation', async () => {
    const ui = new AgentUI();
    const event = await runPromptAndGetFirst(ui, [
      {
        id: 'org-1',
        name: 'DevX',
        projects: [
          {
            id: 'proj-a',
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
    // --app-id alone is sufficient — it's globally unique and resolves
    // to one (org, project, env) tuple server-side. No --env / --org noise.
    expect(data.resumeFlags[0].flags).toEqual(['--app-id', '100002']);
  });
});

describe('parseEnvSelectionStdinLine', () => {
  it('returns parsed=null without error for null / empty input', () => {
    expect(parseEnvSelectionStdinLine(null)).toEqual({
      parsed: null,
      rejectionMessage: null,
    });
    expect(parseEnvSelectionStdinLine('')).toEqual({
      parsed: null,
      rejectionMessage: null,
    });
  });

  it('parses canonical { appId } shape via zod', () => {
    const { parsed, rejectionMessage } =
      parseEnvSelectionStdinLine('{"appId":"100002"}');
    expect(rejectionMessage).toBeNull();
    expect(parsed).toEqual({ appId: '100002' });
  });

  it('rejects non-string appId (wrong type) and returns a descriptive reason', () => {
    const { parsed, rejectionMessage } =
      parseEnvSelectionStdinLine('{"appId":12345}');
    expect(parsed).toBeNull();
    expect(rejectionMessage).toMatch(/stdin response rejected/);
    expect(rejectionMessage).toMatch(/appId/);
  });

  it('rejects invalid JSON with a descriptive reason', () => {
    const { parsed, rejectionMessage } = parseEnvSelectionStdinLine('not json');
    expect(parsed).toBeNull();
    expect(rejectionMessage).toMatch(/not valid JSON/);
  });
});

describe('resolveEnvSelectionFromStdin', () => {
  const CHOICES: EnvSelectionChoice[] = [
    {
      orgId: 'org-1',
      orgName: 'DevX',
      projectId: 'proj-a',
      projectName: 'Sandbox',
      appId: '100001',
      envName: 'Production',
      rank: 1,
      label: 'DevX / Sandbox / Production',
    },
    {
      orgId: 'org-1',
      orgName: 'DevX',
      projectId: 'proj-a',
      projectName: 'Sandbox',
      appId: '100002',
      envName: 'Development',
      rank: 2,
      label: 'DevX / Sandbox / Development',
    },
  ];

  it('returns kind=auto when no payload is parsed (callers auto-select)', () => {
    expect(resolveEnvSelectionFromStdin(null, CHOICES)).toEqual({
      kind: 'auto',
      warnings: [],
    });
  });

  it('returns kind=auto for an empty object (no usable selector)', () => {
    expect(resolveEnvSelectionFromStdin({}, CHOICES)).toEqual({
      kind: 'auto',
      warnings: [],
    });
  });

  it('resolves canonical { appId } to the matching choice without warnings', () => {
    expect(resolveEnvSelectionFromStdin({ appId: '100002' }, CHOICES)).toEqual({
      kind: 'selected',
      selection: {
        orgId: 'org-1',
        projectId: 'proj-a',
        env: 'Development',
      },
      warnings: [],
    });
  });

  it('returns kind=mismatch when a provided appId does not match any choice', () => {
    const outcome = resolveEnvSelectionFromStdin({ appId: '999999' }, CHOICES);
    expect(outcome.kind).toBe('mismatch');
    if (outcome.kind === 'mismatch') {
      expect(outcome.reason).toMatch(/999999/);
      expect(outcome.reason).toMatch(/did not match/);
    }
  });
});

describe('AgentUI.emitNeedsInput', () => {
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

  const lastEvent = (): NDJSONEvent =>
    JSON.parse(writes[writes.length - 1].trim()) as NDJSONEvent;

  it('emits a needs_input envelope with code, choices, and recommended', () => {
    const ui = new AgentUI();
    ui.emitNeedsInput({
      code: 'project_selection',
      message: 'Pick an Amplitude project.',
      choices: [
        { value: '123', label: 'Production' },
        { value: '456', label: 'Staging' },
      ],
      recommended: '456',
      resumeFlags: [
        { value: '123', flags: ['--app-id', '123'] },
        { value: '456', flags: ['--app-id', '456'] },
      ],
    });

    const event = lastEvent();
    expect(event.v).toBe(1);
    expect(event.type).toBe('needs_input');
    expect(event.message).toBe('Pick an Amplitude project.');
    expect(event.data).toMatchObject({
      event: 'needs_input',
      code: 'project_selection',
      recommended: '456',
    });
    expect(event.data?.choices).toEqual([
      { value: '123', label: 'Production' },
      { value: '456', label: 'Staging' },
    ]);
    expect(event.data?.resumeFlags).toEqual([
      { value: '123', flags: ['--app-id', '123'] },
      { value: '456', flags: ['--app-id', '456'] },
    ]);
  });

  it('promptConfirm emits prompt + needs_input + decision_auto, in that order', () => {
    const ui = new AgentUI();
    void ui.promptConfirm('Apply this plan?');

    // Order matters: legacy `prompt` first (back-compat), then the
    // structured `needs_input`, then the `decision_auto` companion.
    // Orchestrators that subscribe to needs_input MUST see
    // decision_auto next on the same stream — that's the contract
    // for distinguishing "awaiting input" from "auto-resolved".
    expect(writes.length).toBe(3);
    const [legacy, modern, decision] = writes.map(
      (l) => JSON.parse(l.trim()) as NDJSONEvent,
    );
    expect(legacy.type).toBe('prompt');
    expect(legacy.data).toMatchObject({ promptType: 'confirm' });
    expect(modern.type).toBe('needs_input');
    expect(modern.data).toMatchObject({
      code: 'confirm',
      recommended: 'yes',
    });
    expect(modern.data?.choices).toEqual([
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ]);
    expect(decision.type).toBe('lifecycle');
    expect(decision.data).toMatchObject({
      event: 'decision_auto',
      code: 'confirm',
      value: 'yes',
      reason: 'auto_approve',
    });
  });

  it('promptChoice emits prompt + needs_input + decision_auto, in that order', () => {
    const ui = new AgentUI();
    void ui.promptChoice('Pick a framework', ['nextjs', 'vue', 'svelte']);

    expect(writes.length).toBe(3);
    const events = writes.map((l) => JSON.parse(l.trim()) as NDJSONEvent);
    const modern = events[1];
    const decision = events[2];
    expect(modern.type).toBe('needs_input');
    expect(modern.data).toMatchObject({
      code: 'choice',
      recommended: 'nextjs',
    });
    expect(decision.type).toBe('lifecycle');
    expect(decision.data).toMatchObject({
      event: 'decision_auto',
      code: 'choice',
      value: 'nextjs',
      reason: 'auto_approve',
    });
    expect(modern.data?.choices).toEqual([
      { value: 'nextjs', label: 'nextjs' },
      { value: 'vue', label: 'vue' },
      { value: 'svelte', label: 'svelte' },
    ]);
  });

  it('promptChoice picks searchable_select widget for ≥10 options', () => {
    const ui = new AgentUI();
    const longList = Array.from({ length: 15 }, (_, i) => `option-${i}`);
    void ui.promptChoice('Pick one of many', longList);

    const modern = JSON.parse(writes[1].trim()) as NDJSONEvent;
    expect(modern.data?.ui).toMatchObject({
      component: 'searchable_select',
      searchPlaceholder: 'Filter options…',
    });
  });

  it('promptChoice picks plain select widget for <10 options', () => {
    const ui = new AgentUI();
    void ui.promptChoice('Pick one', ['a', 'b', 'c']);
    const modern = JSON.parse(writes[1].trim()) as NDJSONEvent;
    expect(modern.data?.ui).toMatchObject({ component: 'select' });
  });

  it('promptConfirm uses the confirmation widget', () => {
    const ui = new AgentUI();
    void ui.promptConfirm('Apply changes?');
    const modern = JSON.parse(writes[1].trim()) as NDJSONEvent;
    expect(modern.data?.ui).toMatchObject({
      component: 'confirmation',
      priority: 'required',
      title: 'Apply changes?',
    });
  });

  it('emitNeedsInput surfaces ui hints, recommendedReason, pagination, manualEntry', () => {
    const ui = new AgentUI();
    ui.emitNeedsInput({
      code: 'project_selection',
      message: 'Pick a project',
      ui: {
        component: 'searchable_select',
        priority: 'required',
        title: 'Select an Amplitude project',
        description: 'Choose where events go.',
        searchPlaceholder: 'Search…',
        emptyState: 'No projects available.',
      },
      choices: [
        {
          value: '123',
          label: 'Prod',
          description: 'Org > WS > Prod',
          metadata: { orgName: 'Org', envName: 'Prod' },
          resumeFlags: ['--app-id', '123'],
        },
      ],
      recommended: '123',
      recommendedReason: 'Matches current ampli.json',
      pagination: {
        total: 100,
        returned: 1,
        nextCommand: ['npx', 'wizard', 'projects', 'list'],
      },
      allowManualEntry: true,
      manualEntry: { flag: '--app-id', placeholder: 'Enter ID' },
    });

    const event = JSON.parse(writes[0].trim()) as NDJSONEvent;
    expect(event.type).toBe('needs_input');
    expect(event.data).toMatchObject({
      code: 'project_selection',
      ui: {
        component: 'searchable_select',
        priority: 'required',
        title: 'Select an Amplitude project',
      },
      recommended: '123',
      recommendedReason: 'Matches current ampli.json',
      allowManualEntry: true,
    });
    const data = event.data as Record<string, unknown>;
    expect(data.pagination).toMatchObject({ total: 100, returned: 1 });
    expect(data.manualEntry).toMatchObject({ flag: '--app-id' });
    expect((data.choices as Array<Record<string, unknown>>)[0]).toMatchObject({
      value: '123',
      description: 'Org > WS > Prod',
      resumeFlags: ['--app-id', '123'],
    });
  });
});

// ── Per-event data_version stamping ─────────────────────────────────
//
// Orchestrators that pin to envelope `v: 1` aren't protected from
// breaking changes inside `data` — adding/renaming a field on (say)
// `event_plan_proposed` keeps envelope `v` stable but silently shifts
// the contract. The fix: every event whose `data` shape is part of
// the public API carries a `data_version` integer. Orchestrators
// branch on `(type, data?.event, data_version)`.
//
// These tests pin the contract: the registered events emit a
// `data_version` field, and unregistered free-form payloads (log,
// status, generic progress) do NOT, so we don't ship noise.

describe('AgentUI — per-event data_version', () => {
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

  const eventsOfType = (type: string): NDJSONEvent[] =>
    writes
      .map((w) => JSON.parse(w.trim()) as NDJSONEvent)
      .filter((e) => e.type === type);

  it('stamps data_version=1 on auth_required (registered event)', () => {
    const ui = new AgentUI();
    ui.emitAuthRequired({
      reason: 'no_stored_credentials',
      instruction: 'Please log in.',
      loginCommand: ['npx', '@amplitude/wizard', 'login'],
    });
    const event = eventsOfType('lifecycle').at(-1)!;
    expect((event as unknown as { data_version: number }).data_version).toBe(1);
  });

  it('stamps data_version on dashboard_created (result event)', () => {
    const ui = new AgentUI();
    ui.setDashboardUrl('https://app.amplitude.com/dashboard/123');
    const event = eventsOfType('result').at(-1)!;
    expect((event as unknown as { data_version: number }).data_version).toBe(1);
  });

  it('stamps data_version on tool_call', () => {
    const ui = new AgentUI();
    // Bugbot regression: previous version of this test passed
    // `toolName` (the wrong key) — vitest/esbuild skip type-checking
    // at runtime, so the call ran with `data.tool === undefined` and
    // produced a malformed event. The data_version assertion still
    // passed (the discriminator is injected by the method, not the
    // caller), which gave false confidence. Use the correct `tool`
    // key here AND assert the wire shape includes it, so a future
    // typo can't sneak through.
    ui.emitToolCall({
      tool: 'Edit',
      summary: 'edit src/foo.ts',
    });
    const event = eventsOfType('progress').at(-1)!;
    expect((event as unknown as { data_version: number }).data_version).toBe(1);
    expect(event.data).toMatchObject({
      event: 'tool_call',
      tool: 'Edit',
      summary: 'edit src/foo.ts',
    });
  });

  it('does NOT stamp data_version on free-form log events', () => {
    const ui = new AgentUI();
    ui.log.info('a free-form log line');
    const event = eventsOfType('log').at(-1)!;
    // log.* is a debug stream, not a versioned API surface — events
    // without an `event` discriminator stay un-versioned so we don't
    // imply a contract we'd have to honor.
    expect((event as unknown as { data_version?: number }).data_version).toBe(
      undefined,
    );
  });

  it('does NOT stamp data_version on session_state events (free-form payload)', () => {
    const ui = new AgentUI();
    ui.setRegion('us');
    const event = eventsOfType('session_state').at(-1)!;
    expect((event as unknown as { data_version?: number }).data_version).toBe(
      undefined,
    );
  });

  it('preserves the v=1 envelope version regardless of data_version', () => {
    // Envelope `v` is the framing-layer version; data_version is the
    // payload-shape version. Bumping one must not implicitly bump the
    // other.
    const ui = new AgentUI();
    ui.setDashboardUrl('https://example.com');
    const event = eventsOfType('result').at(-1)!;
    expect(event.v).toBe(1);
  });
});

// ── Terminal `run_completed` lifecycle event ─────────────────────────
//
// Orchestrators rely on `run_completed` to distinguish "wizard
// finished cleanly" from "wizard crashed mid-stream and tore the pipe
// down". Absence of this event before stream EOF means crash; presence
// with `outcome: success` is the only signal of a clean run. These
// tests pin that contract.

describe('AgentUI.emitRunCompleted', () => {
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

  it('emits a lifecycle event tagged event=run_completed', () => {
    const ui = new AgentUI();
    ui.emitRunCompleted({
      outcome: 'success',
      exitCode: 0,
      durationMs: 1234,
    });
    const event = lastEvent();
    expect(event.type).toBe('lifecycle');
    expect(event.message).toBe('run_completed: success');
    expect(event.data).toMatchObject({
      event: 'run_completed',
      outcome: 'success',
      exitCode: 0,
      durationMs: 1234,
    });
    expect((event as unknown as { data_version: number }).data_version).toBe(1);
  });

  it('maps outcome to level (success → success, error → error, cancelled → warn)', () => {
    const ui = new AgentUI();

    ui.emitRunCompleted({ outcome: 'success', exitCode: 0, durationMs: 0 });
    expect(lastEvent().level).toBe('success');

    ui.emitRunCompleted({ outcome: 'error', exitCode: 10, durationMs: 0 });
    expect(lastEvent().level).toBe('error');

    ui.emitRunCompleted({ outcome: 'cancelled', exitCode: 130, durationMs: 0 });
    expect(lastEvent().level).toBe('warn');
  });

  it('omits reason key when not provided (vs writing reason: undefined)', () => {
    const ui = new AgentUI();
    ui.emitRunCompleted({ outcome: 'success', exitCode: 0, durationMs: 5 });
    const data = lastEvent().data as Record<string, unknown>;
    expect(data).not.toHaveProperty('reason');
  });

  it('includes reason when provided (e.g. wizardAbort with a message)', () => {
    const ui = new AgentUI();
    ui.emitRunCompleted({
      outcome: 'error',
      exitCode: 10,
      durationMs: 5,
      reason: 'Inner agent failed: model overloaded',
    });
    const data = lastEvent().data as Record<string, unknown>;
    expect(data.reason).toBe('Inner agent failed: model overloaded');
  });
});

describe('AgentUI.emitAgentMetrics', () => {
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

  it('emits a progress event with event=agent_metrics', () => {
    const ui = new AgentUI();
    ui.emitAgentMetrics({
      durationMs: 12345,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadInputTokens: 800,
      costUsd: 0.0123,
      numTurns: 7,
      totalToolCalls: 12,
      totalMessages: 25,
      isError: false,
    });
    const event = lastEvent();
    expect(event.type).toBe('progress');
    expect(event.message).toBe('agent_metrics: 12345ms');
    expect(event.data).toMatchObject({
      event: 'agent_metrics',
      durationMs: 12345,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadInputTokens: 800,
      costUsd: 0.0123,
      numTurns: 7,
      totalToolCalls: 12,
      totalMessages: 25,
      isError: false,
    });
    expect((event as unknown as { data_version: number }).data_version).toBe(1);
  });

  it('omits undefined fields rather than shipping {"costUsd": undefined}', () => {
    const ui = new AgentUI();
    ui.emitAgentMetrics({
      durationMs: 100,
      // No usage, no cost — SDK didn't report them.
    });
    const data = lastEvent().data as Record<string, unknown>;
    expect(data).not.toHaveProperty('inputTokens');
    expect(data).not.toHaveProperty('costUsd');
    expect(data).toMatchObject({
      event: 'agent_metrics',
      durationMs: 100,
    });
  });
});

// ── Bugbot regressions on the agent-mode reliability PR ─────────────
//
// Two issues bugbot caught during review of the run_completed +
// data_version + decision_auto changes. These tests pin the contracts
// the wizard now upholds.

describe('AgentUI.emitProjectCreateSuccess — registry key match', () => {
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

  // Bugbot Issue 1 (Medium): the registry entry was `project_created`
  // but the actual emitted discriminator is `project_create_success`.
  // Result: `lookupDataVersion` never matched and the data_version
  // stamp was silently omitted from project-create-success events.
  it('stamps data_version=1 on project_create_success (registry key matches discriminator)', () => {
    const ui = new AgentUI();
    ui.emitProjectCreateSuccess({
      orgId: 'org-1',
      appId: 100001,
      name: 'My Project',
      url: 'https://app.amplitude.com/...',
    });
    const event = JSON.parse(writes[writes.length - 1].trim()) as NDJSONEvent;
    expect(event.type).toBe('result');
    expect(event.data).toMatchObject({ event: 'project_create_success' });
    // The whole point of the fix: data_version is now stamped.
    expect((event as unknown as { data_version: number }).data_version).toBe(1);
  });
});

describe('AgentUI.promptEventPlan — needs_input + result + decision_auto contract', () => {
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

  // Bugbot Issue 2 (Low): decision_auto was firing without a
  // preceding needs_input, contradicting the registry docstring that
  // says "Fires AFTER the corresponding `needs_input`." Fix: emit a
  // structured needs_input first so the contract holds.
  it('emits needs_input → result → decision_auto in that order', async () => {
    const ui = new AgentUI();
    await ui.promptEventPlan([
      { name: 'Sign Up', description: 'User completed signup' },
      { name: 'Purchase', description: 'User completed checkout' },
    ]);

    const events = writes.map((l) => JSON.parse(l.trim()) as NDJSONEvent);
    expect(events.length).toBe(3);

    // 1) needs_input — orchestrators surfacing this to a human key
    //    off `code: 'event_plan'` and the choices array.
    expect(events[0].type).toBe('needs_input');
    expect(events[0].data).toMatchObject({
      code: 'event_plan',
      recommended: 'approved',
    });

    // 2) result — back-compat: existing orchestrators that key off
    //    `event: event_plan` see the full events array here.
    expect(events[1].type).toBe('result');
    expect(events[1].data).toMatchObject({ event: 'event_plan' });

    // 3) decision_auto — the contract pin. This MUST follow a
    //    needs_input for the same `code`. An orphaned decision_auto
    //    would confuse orchestrators tracking pair state.
    expect(events[2].type).toBe('lifecycle');
    expect(events[2].data).toMatchObject({
      event: 'decision_auto',
      code: 'event_plan',
      value: 'approved',
      reason: 'auto_approve',
    });
  });
});

// ── EVENT_DATA_VERSIONS registry vs actual discriminators ───────────
//
// Catches future drift between the registry keys and the strings
// AgentUI actually emits. If a new event lands in the wizard but
// doesn't get a registry entry (or gets one under the wrong name),
// the data_version stamp is silently dropped — the same bug bugbot
// caught on `project_created` vs `project_create_success`.

describe('EVENT_DATA_VERSIONS registry covers every emitted discriminator', () => {
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

  // Each documented event-emitter method on AgentUI fires an event
  // whose `data.event` discriminator must be in the registry. This
  // test exercises the public methods that carry a discriminator and
  // asserts every resulting event is stamped with `data_version`.
  it('every documented emit method stamps data_version', () => {
    const ui = new AgentUI();
    ui.emitAuthRequired({
      reason: 'no_stored_credentials',
      instruction: 'login',
      loginCommand: ['x'],
    });
    ui.emitProjectCreateStart({ orgId: 'o', name: 'n' });
    ui.emitProjectCreateSuccess({
      orgId: 'o',
      appId: 1,
      name: 'n',
      url: 'u',
    });
    ui.emitProjectCreateError({
      orgId: 'o',
      name: 'n',
      code: 'X',
      message: 'm',
    });
    ui.emitNestedAgent({
      signal: 'claude_code_cli',
      envVar: 'CLAUDECODE',
      instruction: 'i',
      bypassEnv: 'X',
    });
    ui.emitInnerAgentStarted({ model: 'm', phase: 'wizard' });
    ui.emitToolCall({ tool: 'Edit', summary: 'e' });
    ui.emitFileChangePlanned({ operation: 'create', path: 'p' });
    ui.emitFileChangeApplied({ operation: 'create', path: 'p' });
    ui.emitVerificationStarted({ phase: 'sdk_init' });
    ui.emitVerificationResult({
      phase: 'sdk_init',
      passed: true,
      details: 'd',
    });
    ui.startRun();
    ui.setEventIngestionDetected(['Sign Up']);
    ui.setDashboardUrl('https://example.com');

    const events = writes.map((l) => JSON.parse(l.trim()) as NDJSONEvent);
    // Filter to events that carry a discriminator — others (free-form
    // log/status) intentionally lack data_version.
    const versioned = events.filter(
      (e) =>
        typeof e.data === 'object' &&
        e.data !== null &&
        typeof (e.data as { event?: unknown }).event === 'string',
    );
    expect(versioned.length).toBeGreaterThan(0);
    for (const e of versioned) {
      expect(
        (e as unknown as { data_version?: number }).data_version,
        `Event ${
          (e.data as { event: string }).event
        } should have data_version stamped — registry key may be missing or misnamed`,
      ).toBe(1);
    }
  });
});

describe('AgentUI.startRun + getRunStartedAtMs', () => {
  it('captures start timestamp on startRun() so duration can be computed', () => {
    const before = Date.now();
    const ui = new AgentUI();
    expect(ui.getRunStartedAtMs()).toBeNull();
    ui.startRun();
    const after = Date.now();
    const ts = ui.getRunStartedAtMs();
    expect(ts).not.toBeNull();
    expect(ts!).toBeGreaterThanOrEqual(before);
    expect(ts!).toBeLessThanOrEqual(after);
  });

  it('returns null before startRun() — early-exit paths report durationMs=0', () => {
    // auth_required and INPUT_REQUIRED can fire before the inner
    // agent run starts. wizard-abort's computeRunDurationMs reads
    // null and reports 0 in that case.
    const ui = new AgentUI();
    expect(ui.getRunStartedAtMs()).toBeNull();
  });
});
