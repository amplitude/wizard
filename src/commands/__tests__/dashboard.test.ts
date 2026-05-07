/**
 * Unit tests for `amplitude-wizard dashboard` (PR 3, DEFER_DASHBOARD_PLAN.md).
 *
 * The yargs handler is end-to-end ish (it calls `process.exit`), so these
 * tests target `runDashboardCommand` directly with injected dependencies.
 * That keeps the surface fully synchronous and avoids reaching into the
 * SDK / network / OAuth layer.
 */

// Skip the per-project storage bootstrap (migration shim + project log
// file routing) — same reason `auth-gate.test.ts` sets it.
process.env.AMPLITUDE_WIZARD_SKIP_BOOTSTRAP = '1';

import { describe, expect, it, vi } from 'vitest';

import {
  runDashboardCommand,
  parseDashboardAgentOutput,
  extractJsonContaining,
  buildDashboardAgentPrompt,
  pollDashboardIngestion,
} from '../dashboard';
import { ExitCode } from '../../lib/exit-codes';
import type { DashboardCommandDeps } from '../dashboard';
import type { DashboardPlan } from '../../lib/dashboard-plan';
import { buildSession } from '../../lib/wizard-session';

// ---------------------------------------------------------------------------
// Test fixtures + helpers
// ---------------------------------------------------------------------------

function makePlan(overrides?: Partial<DashboardPlan>): DashboardPlan {
  return {
    version: 1,
    planId: 'plan-abc-123',
    createdAt: '2026-05-06T00:00:00.000Z',
    orgId: 'org-1',
    projectId: '12345',
    events: [{ name: 'Signup Completed' }],
    charts: [
      {
        title: 'Signup Funnel',
        eventName: 'Signup Completed',
        chartType: 'funnel',
      },
    ],
    dashboard: { title: 'Acme Analytics' },
    ...overrides,
  };
}

interface DepOverrides {
  plan?: DashboardPlan | null;
  /** When provided, drives the ingestion poll outcome via direct injection. */
  ingestion?:
    | { ok: true; eventNames: string[] }
    | { ok: false }
    | { kind: 'sequence'; values: Array<{ hasEvents: boolean }> };
  agentResult?: Record<string, unknown> | null;
  withCredentials?: boolean;
}

function makeDeps(overrides: DepOverrides): {
  deps: DashboardCommandDeps;
  persistDashboardMock: ReturnType<typeof vi.fn>;
  callAmplitudeMcpMock: ReturnType<typeof vi.fn>;
  fetchHasAnyEventsMcpMock: ReturnType<typeof vi.fn>;
} {
  const persistDashboardMock = vi.fn(() => true);
  const callAmplitudeMcpMock = vi.fn(async () => overrides.agentResult ?? null);

  // fetchHasAnyEventsMcp drives `pollDashboardIngestion`. Returning hasEvents
  // immediately on call #1 maps to ingestion.ok=true via a one-shot mock;
  // returning hasEvents=false maps to a timeout so long as the budget is 0.
  const fetchHasAnyEventsMcpMock = vi.fn(async () => {
    if (
      overrides.ingestion &&
      'ok' in overrides.ingestion &&
      overrides.ingestion.ok
    ) {
      return {
        hasEvents: true,
        csvRows: [],
        activeEventNames: overrides.ingestion.eventNames,
        activeUsers: [],
      };
    }
    return {
      hasEvents: false,
      csvRows: [],
      activeEventNames: [] as string[],
      activeUsers: [],
    };
  });

  const deps: DashboardCommandDeps = {
    readDashboardPlan: vi.fn(() => overrides.plan ?? null),
    resolveCredentials: vi.fn(async (session) => {
      if (overrides.withCredentials !== false) {
        session.credentials = {
          accessToken: 'fake-access-token',
          projectApiKey: 'fake-project-key',
          host: 'https://api.amplitude.com',
          appId: 12345,
        };
      }
    }),
    buildSession: vi.fn((args) =>
      buildSession({ installDir: args.installDir }),
    ),
    fetchHasAnyEventsMcp: fetchHasAnyEventsMcpMock,
    callAmplitudeMcp: callAmplitudeMcpMock,
    persistDashboard: persistDashboardMock,
    getMcpUrlFromZone: vi.fn(() => 'https://mcp.amplitude.com'),
    decodeJwtZone: vi.fn(() => 'us'),
  };

  return {
    deps,
    persistDashboardMock,
    callAmplitudeMcpMock,
    fetchHasAnyEventsMcpMock,
  };
}

// ---------------------------------------------------------------------------
// runDashboardCommand — the four headline paths from DEFER_DASHBOARD_PLAN.md
// ---------------------------------------------------------------------------

describe('runDashboardCommand', () => {
  it('exits INPUT_REQUIRED with a clear hint when no plan is present', async () => {
    const { deps, callAmplitudeMcpMock } = makeDeps({ plan: null });
    const result = await runDashboardCommand(
      { installDir: '/tmp/no-such-project', ingestionTimeoutMs: 0 },
      deps,
    );
    expect(result.exitCode).toBe(ExitCode.INPUT_REQUIRED);
    expect(result.message).toMatch(/no dashboard plan found/i);
    expect(result.message).toMatch(/run the wizard first/i);
    // We must not poll or call the agent if no plan exists.
    expect(callAmplitudeMcpMock).not.toHaveBeenCalled();
  });

  it('exits clean (SUCCESS) with a "re-run later" hint when ingestion times out', async () => {
    const { deps, callAmplitudeMcpMock } = makeDeps({
      plan: makePlan(),
      ingestion: { ok: false },
    });
    // ingestionTimeoutMs=0 forces a single failed poll then immediate timeout.
    const result = await runDashboardCommand(
      { installDir: '/tmp/with-plan', ingestionTimeoutMs: 0 },
      deps,
    );
    expect(result.exitCode).toBe(ExitCode.SUCCESS);
    expect(result.message).toMatch(/events haven't reached/i);
    expect(result.message).toMatch(/re-run/i);
    // Headline contract: ingestion-not-ready must NOT spawn the agent.
    expect(callAmplitudeMcpMock).not.toHaveBeenCalled();
  });

  it('writes dashboard.json + returns the URL when ingestion succeeds and the agent succeeds', async () => {
    const dashboardUrl =
      'https://app.amplitude.com/analytics/amplitude/dashboard/abc123';
    const { deps, persistDashboardMock, callAmplitudeMcpMock } = makeDeps({
      plan: makePlan(),
      ingestion: { ok: true, eventNames: ['Signup Completed'] },
      agentResult: {
        dashboardUrl,
        dashboardId: 'abc123',
        charts: [{ id: 'c1', title: 'Signup Funnel', type: 'funnel' }],
      },
    });
    const result = await runDashboardCommand(
      { installDir: '/tmp/with-plan', ingestionTimeoutMs: 60_000 },
      deps,
    );
    expect(result.exitCode).toBe(ExitCode.SUCCESS);
    expect(result.dashboardUrl).toBe(dashboardUrl);
    expect(result.message).toContain(dashboardUrl);
    expect(callAmplitudeMcpMock).toHaveBeenCalledTimes(1);
    expect(persistDashboardMock).toHaveBeenCalledWith(
      '/tmp/with-plan',
      expect.objectContaining({
        dashboardUrl,
        dashboardId: 'abc123',
      }),
    );
  });

  it('exits AGENT_FAILED when ingestion succeeds but the agent returns no result', async () => {
    const { deps, persistDashboardMock } = makeDeps({
      plan: makePlan(),
      ingestion: { ok: true, eventNames: ['Signup Completed'] },
      agentResult: null,
    });
    const result = await runDashboardCommand(
      { installDir: '/tmp/with-plan', ingestionTimeoutMs: 60_000 },
      deps,
    );
    expect(result.exitCode).toBe(ExitCode.AGENT_FAILED);
    expect(result.message).toMatch(/dashboard creation failed/i);
    // No dashboard URL → never persist a half-baked file.
    expect(persistDashboardMock).not.toHaveBeenCalled();
  });

  it('exits AUTH_REQUIRED when credentials cannot be resolved', async () => {
    const { deps, callAmplitudeMcpMock } = makeDeps({
      plan: makePlan(),
      withCredentials: false,
    });
    const result = await runDashboardCommand(
      { installDir: '/tmp/with-plan', ingestionTimeoutMs: 0 },
      deps,
    );
    expect(result.exitCode).toBe(ExitCode.AUTH_REQUIRED);
    expect(result.message).toMatch(/no amplitude credentials available/i);
    expect(callAmplitudeMcpMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// pollDashboardIngestion — narrow tests against the helper's contract
// ---------------------------------------------------------------------------

describe('pollDashboardIngestion', () => {
  it('returns ok on the first poll if events are already flowing', async () => {
    const fetchHasAnyEventsMcp = vi.fn(async () => ({
      hasEvents: true,
      csvRows: [],
      activeEventNames: ['Hello API Called'],
      activeUsers: [],
    })) as any;
    const result = await pollDashboardIngestion({
      accessToken: 'token',
      appId: '12345',
      timeoutMs: 60_000,
      fetchHasAnyEventsMcp,
      pollIntervalMs: 0,
      perPollTimeoutMs: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.eventNames).toEqual(['Hello API Called']);
    }
    expect(fetchHasAnyEventsMcp).toHaveBeenCalledTimes(1);
  });

  it('returns not-ok on timeout when no events arrive', async () => {
    const fetchHasAnyEventsMcp = vi.fn(async () => ({
      hasEvents: false,
      csvRows: [],
      activeEventNames: [],
      activeUsers: [],
    })) as any;
    const result = await pollDashboardIngestion({
      accessToken: 'token',
      appId: '12345',
      timeoutMs: 0,
      fetchHasAnyEventsMcp,
      pollIntervalMs: 0,
      perPollTimeoutMs: 0,
    });
    expect(result.ok).toBe(false);
  });

  it('keeps polling past transient errors', async () => {
    let calls = 0;
    const fetchHasAnyEventsMcp = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error('transient');
      return {
        hasEvents: true,
        csvRows: [],
        activeEventNames: ['Boom'],
        activeUsers: [],
      };
    }) as any;
    const result = await pollDashboardIngestion({
      accessToken: 'token',
      appId: '12345',
      timeoutMs: 60_000,
      fetchHasAnyEventsMcp,
      pollIntervalMs: 0,
      perPollTimeoutMs: 0,
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Output parsing helpers
// ---------------------------------------------------------------------------

describe('parseDashboardAgentOutput', () => {
  it('parses the happy path with marker delimiters', () => {
    const text =
      'noise <<<WIZARD_DASHBOARD_RESULT>>>{"dashboardUrl":"https://app.amplitude.com/d/1","dashboardId":"1","charts":[{"id":"a","title":"X","type":"funnel"}]}<<<END>>> tail';
    const result = parseDashboardAgentOutput(text);
    expect(result?.dashboardUrl).toBe('https://app.amplitude.com/d/1');
    expect(result?.dashboardId).toBe('1');
    expect(result?.charts).toHaveLength(1);
  });

  it('falls back to balanced JSON extraction when markers are missing', () => {
    const text =
      'forgot the markers: {"dashboardUrl":"https://app.amplitude.com/d/2","charts":[{"id":"a"}]}';
    const result = parseDashboardAgentOutput(text);
    expect(result?.dashboardUrl).toBe('https://app.amplitude.com/d/2');
  });

  it('rejects non-http URLs', () => {
    const text =
      '<<<WIZARD_DASHBOARD_RESULT>>>{"dashboardUrl":"javascript:alert(1)"}<<<END>>>';
    expect(parseDashboardAgentOutput(text)).toBeNull();
  });

  it('returns null when no dashboardUrl is present', () => {
    expect(parseDashboardAgentOutput('nothing here')).toBeNull();
  });
});

describe('extractJsonContaining', () => {
  it('handles nested objects with brace-aware scanning', () => {
    const json = '{"dashboardUrl":"https://x","meta":{"nested":{"deep":true}}}';
    expect(extractJsonContaining(json, '"dashboardUrl"')).toBe(json);
  });

  it('returns null when the needle is missing', () => {
    expect(extractJsonContaining('{"x":1}', '"dashboardUrl"')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Prompt building — assert the plan flows into the prompt body
// ---------------------------------------------------------------------------

describe('buildDashboardAgentPrompt', () => {
  it('embeds the plan JSON and references the chart-dashboard-plan skill', () => {
    const plan = makePlan();
    const prompt = buildDashboardAgentPrompt(plan);
    expect(prompt).toContain('amplitude-chart-dashboard-plan');
    expect(prompt).toContain('"orgId": "org-1"');
    expect(prompt).toContain('"projectId": "12345"');
    expect(prompt).toContain('Signup Funnel');
    // Marker convention must match the parser.
    expect(prompt).toContain('<<<WIZARD_DASHBOARD_RESULT>>>');
    expect(prompt).toContain('<<<END>>>');
  });
});
