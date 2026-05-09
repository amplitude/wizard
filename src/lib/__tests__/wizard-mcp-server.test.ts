import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock agent-ops so we can assert the MCP tool handlers forward correctly.
vi.mock('../agent-ops.js', () => ({
  runDetect: vi.fn(),
  runStatus: vi.fn(),
  runPlan: vi.fn(),
  runVerify: vi.fn(),
  runGetEventPlan: vi.fn(),
  getAuthStatus: vi.fn(),
  getAuthToken: vi.fn(),
}));

import { registerWizardTools } from '../wizard-mcp-server.js';
import {
  runDetect,
  runStatus,
  runPlan,
  runVerify,
  runGetEventPlan,
  getAuthStatus,
  getAuthToken,
} from '../agent-ops.js';

const mockedRunDetect = vi.mocked(runDetect);
const mockedRunStatus = vi.mocked(runStatus);
const mockedRunPlan = vi.mocked(runPlan);
const mockedRunVerify = vi.mocked(runVerify);
const mockedRunGetEventPlan = vi.mocked(runGetEventPlan);
const mockedGetAuthStatus = vi.mocked(getAuthStatus);
const mockedGetAuthToken = vi.mocked(getAuthToken);

interface CapturedTool {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  };
  handler: (args: unknown) => unknown;
}

interface FakeServer {
  tools: CapturedTool[];
  registerTool: (
    name: string,
    config: CapturedTool['config'],
    handler: CapturedTool['handler'],
  ) => void;
}

function makeFakeServer(): FakeServer {
  const tools: CapturedTool[] = [];
  return {
    tools,
    registerTool: (name, config, handler) => {
      tools.push({ name, config, handler });
    },
  };
}

// Extract the first text-block from an MCP tool result and JSON.parse it.
function parseToolResult(result: unknown): unknown {
  const typed = result as {
    content: Array<{ type: string; text: string }>;
  };
  return JSON.parse(typed.content[0].text);
}

describe('registerWizardTools', () => {
  let fake: ReturnType<typeof makeFakeServer>;

  beforeEach(() => {
    mockedRunDetect.mockReset();
    mockedRunStatus.mockReset();
    mockedRunPlan.mockReset();
    mockedRunVerify.mockReset();
    mockedRunGetEventPlan.mockReset();
    mockedGetAuthStatus.mockReset();
    mockedGetAuthToken.mockReset();
    fake = makeFakeServer();
    registerWizardTools(fake);
  });

  it('registers every expected tool by name (PR 3 added orchestration mirrors)', () => {
    const names = fake.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      // Original tools
      'detect_framework',
      'get_auth_status',
      'get_auth_token',
      'get_choice',
      'get_dashboard_plan',
      'get_event_plan',
      'get_last_stopping_point',
      'get_manual_verification',
      'get_mcp_capability',
      'get_orchestration_status',
      'get_project_status',
      'get_session',
      'get_task',
      'list_choices',
      'list_manual_verifications',
      'list_mcp_capabilities',
      'list_sessions',
      'list_tasks',
      'plan_setup',
      'record_dashboard_plan',
      'verify_setup',
    ]);
  });

  it('every tool has a non-empty description', () => {
    for (const tool of fake.tools) {
      expect(tool.config.description).toBeTruthy();
      expect((tool.config.description ?? '').length).toBeGreaterThan(10);
    }
  });

  it('detect_framework, get_project_status, and get_event_plan accept optional installDir', () => {
    for (const name of [
      'detect_framework',
      'get_project_status',
      'get_event_plan',
    ]) {
      const tool = fake.tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool!.config.inputSchema).toBeDefined();
      expect(tool!.config.inputSchema).toHaveProperty('installDir');
    }
  });

  it('get_auth_status and get_auth_token have empty input schemas', () => {
    for (const name of ['get_auth_status', 'get_auth_token']) {
      const tool = fake.tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool!.config.inputSchema).toEqual({});
    }
  });

  it('get_auth_token description flags that it returns a live token', () => {
    const tool = fake.tools.find((t) => t.name === 'get_auth_token');
    // Don't lock to exact wording; just require a security-flavored hint.
    expect(tool!.config.description).toMatch(/token|secret|sensitive/i);
  });

  it('detect_framework forwards to runDetect with installDir when provided', async () => {
    mockedRunDetect.mockResolvedValue({
      integration: null,
      frameworkName: null,
      confidence: 'none',
      signals: [],
    });

    const tool = fake.tools.find((t) => t.name === 'detect_framework')!;
    const result = await tool.handler({ installDir: '/tmp/my-app' });

    expect(mockedRunDetect).toHaveBeenCalledWith('/tmp/my-app');
    expect(parseToolResult(result)).toEqual({
      integration: null,
      frameworkName: null,
      confidence: 'none',
      signals: [],
    });
  });

  it('detect_framework defaults to process.cwd() when installDir omitted', async () => {
    mockedRunDetect.mockResolvedValue({
      integration: null,
      frameworkName: null,
      confidence: 'none',
      signals: [],
    });

    const tool = fake.tools.find((t) => t.name === 'detect_framework')!;
    await tool.handler({});
    expect(mockedRunDetect).toHaveBeenCalledWith(process.cwd());
  });

  it('get_project_status forwards to runStatus and returns its payload', async () => {
    const statusPayload = {
      installDir: '/p',
      framework: { integration: null, name: null },
      amplitudeInstalled: { installed: false },
      apiKey: { configured: false, source: null },
      auth: { loggedIn: false, email: null, zone: null },
    };
    // runStatus's type is strict; cast to any since we're just echoing in tests.
    mockedRunStatus.mockResolvedValue(
      statusPayload as unknown as Awaited<ReturnType<typeof runStatus>>,
    );

    const tool = fake.tools.find((t) => t.name === 'get_project_status')!;
    const result = await tool.handler({ installDir: '/p' });

    expect(mockedRunStatus).toHaveBeenCalledWith('/p');
    expect(parseToolResult(result)).toEqual(statusPayload);
  });

  it('get_auth_status forwards to getAuthStatus', async () => {
    mockedGetAuthStatus.mockReturnValue({
      loggedIn: false,
      user: null,
      tokenExpiresAt: null,
    });

    const tool = fake.tools.find((t) => t.name === 'get_auth_status')!;
    const result = await tool.handler({});

    expect(mockedGetAuthStatus).toHaveBeenCalledTimes(1);
    expect(parseToolResult(result)).toEqual({
      loggedIn: false,
      user: null,
      tokenExpiresAt: null,
    });
  });

  it('get_auth_token returns { token: null, ... } when not logged in (does not throw)', async () => {
    mockedGetAuthToken.mockReturnValue({
      token: null,
      expiresAt: null,
      zone: null,
    });

    const tool = fake.tools.find((t) => t.name === 'get_auth_token')!;
    const result = await tool.handler({});

    expect(mockedGetAuthToken).toHaveBeenCalledTimes(1);
    expect(parseToolResult(result)).toEqual({
      token: null,
      expiresAt: null,
      zone: null,
    });
  });

  it('get_auth_token returns the access token when logged in', async () => {
    mockedGetAuthToken.mockReturnValue({
      token: 'oauth-token-xyz',
      expiresAt: '2099-01-01T00:00:00.000Z',
      zone: 'US',
    });

    const tool = fake.tools.find((t) => t.name === 'get_auth_token')!;
    const parsed = parseToolResult(await tool.handler({})) as {
      token: string | null;
    };
    expect(parsed.token).toBe('oauth-token-xyz');
  });

  // ── plan_setup ──────────────────────────────────────────────────────

  it('plan_setup forwards installDir to runPlan and JSON-wraps the result', async () => {
    mockedRunPlan.mockResolvedValue({
      plan: {
        v: 1,
        planId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        createdAt: new Date().toISOString(),
        installDir: '/tmp/example',
        framework: 'nextjs',
        frameworkName: 'Next.js',
        sdk: '@amplitude/analytics-browser',
        events: [],
        fileChanges: [],
        requiresApproval: true,
      },
      detected: true,
    });

    const tool = fake.tools.find((t) => t.name === 'plan_setup')!;
    const parsed = parseToolResult(
      await tool.handler({ installDir: '/tmp/example' }),
    ) as { plan: { framework: string }; detected: boolean };

    expect(mockedRunPlan).toHaveBeenCalledWith('/tmp/example');
    expect(parsed.plan.framework).toBe('nextjs');
    expect(parsed.detected).toBe(true);
  });

  it('plan_setup defaults to process.cwd() when installDir is omitted', async () => {
    mockedRunPlan.mockResolvedValue({
      plan: {
        v: 1,
        planId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        createdAt: new Date().toISOString(),
        installDir: process.cwd(),
        framework: 'generic',
        frameworkName: null,
        sdk: null,
        events: [],
        fileChanges: [],
        requiresApproval: true,
      },
      detected: false,
    });
    const tool = fake.tools.find((t) => t.name === 'plan_setup')!;
    await tool.handler({});
    expect(mockedRunPlan).toHaveBeenCalledWith(process.cwd());
  });

  it('plan_setup is documented as read-only / does not write files', () => {
    const tool = fake.tools.find((t) => t.name === 'plan_setup')!;
    const description = (tool.config.description ?? '').toLowerCase();
    // Don't lock to exact wording — just require something that signals
    // "no writes / read-only" so the LLM picking the tool doesn't assume
    // it executes the install.
    expect(
      description.includes('no files') ||
        description.includes('read-only') ||
        description.includes('not touched') ||
        description.includes('does not write'),
    ).toBe(true);
  });

  // ── verify_setup ────────────────────────────────────────────────────

  it('verify_setup forwards installDir and surfaces failures', async () => {
    mockedRunVerify.mockResolvedValue({
      installDir: '/tmp/example',
      framework: { integration: 'nextjs', name: 'Next.js' },
      amplitudeInstalled: { confidence: 'high', reason: 'pkg.json' },
      apiKeyConfigured: false,
      outcome: 'fail',
      failures: ['amplitude API key is not configured'],
    });

    const tool = fake.tools.find((t) => t.name === 'verify_setup')!;
    const parsed = parseToolResult(
      await tool.handler({ installDir: '/tmp/example' }),
    ) as { outcome: string; failures: string[] };

    expect(mockedRunVerify).toHaveBeenCalledWith('/tmp/example');
    expect(parsed.outcome).toBe('fail');
    expect(parsed.failures).toContain('amplitude API key is not configured');
  });

  // ── record_dashboard_plan / get_dashboard_plan ─────────────────────────
  // PR 2 of DEFER_DASHBOARD_PLAN.md: external MCP-server parity for the
  // in-process `wizard-tools:record_dashboard_plan`. Tests round-trip
  // against a real tmp directory so the on-disk artifact shape is locked.

  describe('record_dashboard_plan / get_dashboard_plan', () => {
    let tmpDir: string;
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-mcp-plan-'));
    });
    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function validPlanInput() {
      return {
        orgId: '111',
        projectId: '222',
        events: [{ name: 'User Signed Up' }],
        charts: [
          {
            title: 'Signup Funnel',
            eventName: 'User Signed Up',
            chartType: 'funnel' as const,
          },
        ],
        dashboard: { title: 'Onboarding' },
      };
    }

    it('record_dashboard_plan writes the artifact and returns the stamped plan', () => {
      const tool = fake.tools.find((t) => t.name === 'record_dashboard_plan')!;
      const result = tool.handler({
        installDir: tmpDir,
        plan: validPlanInput(),
      });
      const parsed = parseToolResult(result) as {
        ok: boolean;
        plan: { planId: string; version: number; createdAt: string };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.plan.version).toBe(1);
      expect(parsed.plan.planId).toMatch(/^[0-9a-f-]+$/i);

      const filePath = path.join(tmpDir, '.amplitude', 'dashboard-plan.json');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('record_dashboard_plan returns ok:false on schema-invalid input', () => {
      const tool = fake.tools.find((t) => t.name === 'record_dashboard_plan')!;
      const bad = { ...validPlanInput(), orgId: '' };
      const result = tool.handler({ installDir: tmpDir, plan: bad });
      const parsed = parseToolResult(result) as {
        ok: boolean;
        error?: string;
      };
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toBeTruthy();
    });

    it('get_dashboard_plan returns the persisted plan after record_dashboard_plan', () => {
      const recorder = fake.tools.find(
        (t) => t.name === 'record_dashboard_plan',
      )!;
      const reader = fake.tools.find((t) => t.name === 'get_dashboard_plan')!;

      const wrote = parseToolResult(
        recorder.handler({ installDir: tmpDir, plan: validPlanInput() }),
      ) as { plan: { planId: string } };

      const read = parseToolResult(reader.handler({ installDir: tmpDir })) as {
        plan: { planId: string } | null;
      };
      expect(read.plan).not.toBeNull();
      expect(read.plan!.planId).toBe(wrote.plan.planId);
    });

    it('get_dashboard_plan returns plan:null when nothing has been written', () => {
      const reader = fake.tools.find((t) => t.name === 'get_dashboard_plan')!;
      const parsed = parseToolResult(
        reader.handler({ installDir: tmpDir }),
      ) as { plan: unknown };
      expect(parsed.plan).toBeNull();
    });
  });

  // ── get_event_plan ────────────────────────────────────────────────────

  it('get_event_plan forwards installDir to runGetEventPlan', () => {
    mockedRunGetEventPlan.mockReturnValue({
      installDir: '/tmp/example',
      events: [{ name: 'Button Clicked', description: 'User tapped CTA' }],
      count: 1,
    });

    const tool = fake.tools.find((t) => t.name === 'get_event_plan')!;
    const parsed = parseToolResult(
      tool.handler({ installDir: '/tmp/example' }),
    ) as { count: number; events: unknown[] };

    expect(mockedRunGetEventPlan).toHaveBeenCalledWith('/tmp/example');
    expect(parsed.count).toBe(1);
    expect(parsed.events).toHaveLength(1);
  });

  it('get_event_plan defaults to process.cwd() when installDir is omitted', () => {
    mockedRunGetEventPlan.mockReturnValue({
      installDir: process.cwd(),
      events: [],
      count: 0,
    });

    const tool = fake.tools.find((t) => t.name === 'get_event_plan')!;
    tool.handler({});
    expect(mockedRunGetEventPlan).toHaveBeenCalledWith(process.cwd());
  });

  // ── Orchestration tool parity (PR 3) ─────────────────────────────────
  // Smoke-test the new orchestration tools: each wraps the same envelope
  // builder the matching CLI command uses, so we just need to confirm
  // the registered tools (a) accept an installDir input, (b) return a
  // text-content response, and (c) the parsed JSON validates against the
  // shared schema.

  describe('orchestration tools (PR 3)', () => {
    let tmpDir: string;
    let originalCacheDir: string | undefined;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-mcp-orch-'));
      originalCacheDir = process.env.AMPLITUDE_WIZARD_CACHE_DIR;
      process.env.AMPLITUDE_WIZARD_CACHE_DIR = path.join(tmpDir, '.cache');
    });
    afterEach(() => {
      if (originalCacheDir === undefined) {
        delete process.env.AMPLITUDE_WIZARD_CACHE_DIR;
      } else {
        process.env.AMPLITUDE_WIZARD_CACHE_DIR = originalCacheDir;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('get_orchestration_status returns a schema-valid envelope', async () => {
      const tool = fake.tools.find(
        (t) => t.name === 'get_orchestration_status',
      )!;
      const parsed = parseToolResult(tool.handler({ installDir: tmpDir })) as {
        v: number;
        type: string;
      };
      expect(parsed.v).toBe(1);
      expect(parsed.type).toBe('orchestration_status');
      const { ENVELOPE_SCHEMAS } = await import(
        '../orchestration/envelopes.js'
      );
      expect(() => ENVELOPE_SCHEMAS.status.parse(parsed)).not.toThrow();
    });

    it('get_last_stopping_point returns a schema-valid envelope', async () => {
      const tool = fake.tools.find(
        (t) => t.name === 'get_last_stopping_point',
      )!;
      const parsed = parseToolResult(tool.handler({ installDir: tmpDir })) as {
        type: string;
      };
      expect(parsed.type).toBe('orchestration_last_stopping_point');
      const { ENVELOPE_SCHEMAS } = await import(
        '../orchestration/envelopes.js'
      );
      expect(() =>
        ENVELOPE_SCHEMAS.lastStoppingPoint.parse(parsed),
      ).not.toThrow();
    });

    it('list_tasks returns an empty array for a fresh project', () => {
      const tool = fake.tools.find((t) => t.name === 'list_tasks')!;
      const parsed = parseToolResult(tool.handler({ installDir: tmpDir })) as {
        tasks: unknown[];
      };
      expect(Array.isArray(parsed.tasks)).toBe(true);
      expect(parsed.tasks).toEqual([]);
    });

    it('get_task returns { error: "not_found" } for an unknown task id', () => {
      const tool = fake.tools.find((t) => t.name === 'get_task')!;
      const parsed = parseToolResult(
        tool.handler({ installDir: tmpDir, id: 'task_unknown' }),
      ) as { error: string; id?: string };
      expect(parsed.error).toBe('not_found');
    });

    it('get_task returns { error: "invalid_id" } for a non-task-shaped id', () => {
      const tool = fake.tools.find((t) => t.name === 'get_task')!;
      const parsed = parseToolResult(
        tool.handler({ installDir: tmpDir, id: 'not-a-task' }),
      ) as { error: string };
      expect(parsed.error).toBe('invalid_id');
    });

    it('list_choices defaults to status="pending"', async () => {
      // Seed a pending + an answered choice; the default filter should
      // surface only the pending one.
      const { getOrchestrationStore, _resetOrchestrationStoreCache } =
        await import('../orchestration/store.js');
      const { ChoiceKind, ChoiceStatus } = await import(
        '../orchestration/checkpoints/choices.js'
      );
      _resetOrchestrationStoreCache();
      const store = getOrchestrationStore(tmpDir);
      const session = store.createSession({ goal: 'test' });
      const c1 = store.addChoice({
        kind: ChoiceKind.EnvironmentSelection,
        promptId: 'p1',
        message: 'pick',
        options: [{ id: 'a', label: 'A' }],
        recommendedOptionId: 'a',
        safeDefaultOptionId: 'a',
        requiresHuman: true,
        automationAllowed: false,
        consequenceIfSkipped: 'no',
        reversible: true,
        whyAsking: 'why',
        resumeCommand: ['x'],
        linkedSessionId: session.id,
      });
      // Answer it, then add another pending choice with a different
      // promptId.
      store.answerChoice(c1.id, 'a', 'human');
      store.addChoice({
        kind: ChoiceKind.EnvironmentSelection,
        promptId: 'p2',
        message: 'pick again',
        options: [{ id: 'a', label: 'A' }],
        recommendedOptionId: 'a',
        safeDefaultOptionId: 'a',
        requiresHuman: true,
        automationAllowed: false,
        consequenceIfSkipped: 'no',
        reversible: true,
        whyAsking: 'why',
        resumeCommand: ['x'],
        linkedSessionId: session.id,
      });

      const tool = fake.tools.find((t) => t.name === 'list_choices')!;
      const parsed = parseToolResult(tool.handler({ installDir: tmpDir })) as {
        choices: Array<{ status: string }>;
      };
      expect(parsed.choices).toHaveLength(1);
      expect(parsed.choices[0].status).toBe(ChoiceStatus.Pending);

      // Asking for status='all' surfaces both.
      const all = parseToolResult(
        tool.handler({ installDir: tmpDir, status: 'all' }),
      ) as { choices: unknown[] };
      expect(all.choices).toHaveLength(2);
    });

    it('list_mcp_capabilities surfaces install_skipped capabilities (anti-nag visibility)', async () => {
      const { getOrchestrationStore, _resetOrchestrationStoreCache } =
        await import('../orchestration/store.js');
      const { McpAppCapabilityKind, McpAppCapabilityState } = await import(
        '../orchestration/mcp-app-lifecycle.js'
      );
      _resetOrchestrationStoreCache();
      const store = getOrchestrationStore(tmpDir);
      const session = store.createSession({ goal: 'test' });
      const cap = store.addMcpCapability({
        kind: McpAppCapabilityKind.AmplitudeMcpHttp,
        whyNeeded: 'For chart Q&A',
        whatItEnables: 'Ask charts in chat',
        required: false,
        consequenceIfSkipped: 'No chat charts',
        safeToSkip: true,
        reversible: true,
        userDecisionResumeCommand: ['x'],
        linkedSessionId: session.id,
      });
      // available → needs_user_choice → install_skipped is the legal
      // path; transitioning straight from available trips the lifecycle
      // matrix.
      store.transitionMcpCapability(
        cap.id,
        McpAppCapabilityState.NeedsUserChoice,
        null,
      );
      store.transitionMcpCapability(
        cap.id,
        McpAppCapabilityState.InstallSkipped,
        'user said no',
      );

      const tool = fake.tools.find((t) => t.name === 'list_mcp_capabilities')!;
      const parsed = parseToolResult(tool.handler({ installDir: tmpDir })) as {
        capabilities: Array<{ state: string; userDecision: string | null }>;
      };
      expect(parsed.capabilities).toHaveLength(1);
      expect(parsed.capabilities[0].state).toBe(
        McpAppCapabilityState.InstallSkipped,
      );
      expect(parsed.capabilities[0].userDecision).toBe('skipped');
    });

    it('every orchestration tool description is non-empty', () => {
      const orchTools = [
        'get_orchestration_status',
        'get_last_stopping_point',
        'list_tasks',
        'get_task',
        'list_sessions',
        'get_session',
        'list_choices',
        'get_choice',
        'list_manual_verifications',
        'get_manual_verification',
        'list_mcp_capabilities',
        'get_mcp_capability',
      ];
      for (const name of orchTools) {
        const tool = fake.tools.find((t) => t.name === name);
        expect(tool, `tool ${name} should be registered`).toBeDefined();
        expect(tool!.config.description).toBeTruthy();
        expect((tool!.config.description ?? '').length).toBeGreaterThan(20);
      }
    });

    it('orchestration tools do NOT include any mutation surface (read-only contract)', () => {
      // Sanity-check that PR 3 didn't accidentally introduce a write tool.
      // Anything that mutates orchestration state belongs on the CLI.
      const writeIndicators = [
        'answer',
        'mark',
        'transition',
        'install',
        'skip',
        'create_choice',
        'create_verification',
      ];
      for (const tool of fake.tools) {
        // Skip the existing record_dashboard_plan — that's NOT
        // orchestration; it's a separate writable surface that
        // pre-dated PR 3 and is intentional.
        if (tool.name === 'record_dashboard_plan') continue;
        for (const ind of writeIndicators) {
          expect(
            tool.name.toLowerCase().includes(ind),
            `tool ${tool.name} smells like a mutation; PR 3 must stay read-only`,
          ).toBe(false);
        }
      }
    });
  });
});
