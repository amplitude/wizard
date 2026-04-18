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
        appId: string | null;
        envName: string;
        label: string;
      }>;
    };
    expect(data.promptType).toBe('environment_selection');
    expect(data.hierarchy).toEqual(['org', 'workspace', 'app', 'environment']);
    expect(data.choices).toHaveLength(2);
    expect(data.choices[0]).toMatchObject({
      orgId: 'org-1',
      orgName: 'DevX',
      workspaceId: 'ws-a',
      workspaceName: 'Sandbox',
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

  it('surfaces resumeFlags with --app-id for unambiguous re-invocation', async () => {
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
    // --project-id alone is sufficient — it's globally unique and resolves
    // to one (org, workspace, env) tuple server-side. No --env / --org noise.
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

  it('parses legacy { projectId } shape via zod', () => {
    const { parsed, rejectionMessage } = parseEnvSelectionStdinLine(
      '{"projectId":"100001"}',
    );
    expect(rejectionMessage).toBeNull();
    expect(parsed).toEqual({ projectId: '100001' });
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
      workspaceId: 'ws-a',
      workspaceName: 'Sandbox',
      appId: '100001',
      envName: 'Production',
      rank: 1,
      label: 'DevX / Sandbox / Production',
    },
    {
      orgId: 'org-1',
      orgName: 'DevX',
      workspaceId: 'ws-a',
      workspaceName: 'Sandbox',
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
        workspaceId: 'ws-a',
        env: 'Development',
      },
      warnings: [],
    });
  });

  it('resolves legacy { projectId } alias AND surfaces a deprecation warning', () => {
    const outcome = resolveEnvSelectionFromStdin(
      { projectId: '100001' },
      CHOICES,
    );
    expect(outcome.kind).toBe('selected');
    if (outcome.kind === 'selected') {
      expect(outcome.selection.env).toBe('Production');
    }
    expect(outcome.warnings.join('\n')).toMatch(/\{ projectId \}/);
    expect(outcome.warnings.join('\n')).toMatch(/deprecated/);
  });

  it('returns kind=mismatch when a provided appId does not match any choice', () => {
    const outcome = resolveEnvSelectionFromStdin({ appId: '999999' }, CHOICES);
    expect(outcome.kind).toBe('mismatch');
    if (outcome.kind === 'mismatch') {
      expect(outcome.reason).toMatch(/999999/);
      expect(outcome.reason).toMatch(/did not match/);
    }
  });

  it('returns kind=mismatch when a legacy triple does not match any choice', () => {
    const outcome = resolveEnvSelectionFromStdin(
      { orgId: 'ghost', workspaceId: 'none', env: 'Staging' },
      CHOICES,
    );
    expect(outcome.kind).toBe('mismatch');
    if (outcome.kind === 'mismatch') {
      expect(outcome.reason).toMatch(/ghost/);
    }
  });

  it('accepts a matching legacy triple and emits the deprecation warning', () => {
    const outcome = resolveEnvSelectionFromStdin(
      { orgId: 'org-1', workspaceId: 'ws-a', env: 'Production' },
      CHOICES,
    );
    expect(outcome.kind).toBe('selected');
    expect(outcome.warnings.join('\n')).toMatch(
      /\{ orgId, workspaceId, env \}/,
    );
  });
});
