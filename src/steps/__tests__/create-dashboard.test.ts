/**
 * Regression tests for the create-dashboard step.
 *
 * 1. The events-file reader delegates to parseEventPlanContent (the canonical
 *    parser) so it tolerates every field-name variant the agent emits in the
 *    wild — `name`, `event`, `eventName`, `event_name`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ApiError } from '../../lib/api.js';
import { Integration } from '../../lib/constants.js';
import { __test__, createDashboardStep } from '../create-dashboard.js';

const { readEventsFromContent } = __test__;

vi.mock('../../lib/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.js')>();
  return {
    ...actual,
    createWizardDashboard: vi.fn(),
  };
});

vi.mock('../../lib/wizard-tools', () => ({
  persistDashboard: vi.fn(() => true),
}));
vi.mock('../../utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));
vi.mock('../../utils/debug', () => ({ logToFile: vi.fn() }));
vi.mock('../../ui', () => {
  const ui = {
    pushStatus: vi.fn(),
    setDashboardUrl: vi.fn(),
    setPostAgentStep: vi.fn(),
    applyJourneyTransition: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
    })),
    log: { warn: vi.fn() },
  };
  return { getUI: () => ui, __ui: ui };
});

import { createWizardDashboard } from '../../lib/api.js';
import { persistDashboard } from '../../lib/wizard-tools';
import { analytics } from '../../utils/analytics';

import * as uiModule from '../../ui';

const mockedCreateWizardDashboard =
  createWizardDashboard as unknown as ReturnType<typeof vi.fn>;

describe('readEventsFromContent', () => {
  it('accepts canonical `name` key with bare top-level array', () => {
    const out = readEventsFromContent(
      JSON.stringify([
        { name: 'Signup Completed', description: 'User finished signup' },
      ]),
    );
    expect(out?.events[0].name).toBe('Signup Completed');
    expect(out?.events[0].description).toBe('User finished signup');
  });

  it('unwraps a `{ events: [...] }` wrapper object', () => {
    const out = readEventsFromContent(
      JSON.stringify({ events: [{ name: 'Project Created' }] }),
    );
    expect(out?.events[0].name).toBe('Project Created');
  });

  it('accepts legacy `event` key and normalizes to `name`', () => {
    const out = readEventsFromContent(
      JSON.stringify([{ event: 'Project Created' }]),
    );
    expect(out?.events[0].name).toBe('Project Created');
  });

  it('accepts `eventName` (camelCase) key', () => {
    const out = readEventsFromContent(
      JSON.stringify([{ eventName: 'Checkout Started' }]),
    );
    expect(out?.events[0].name).toBe('Checkout Started');
  });

  it('accepts `event_name` (snake_case) key — observed in the wild', () => {
    const out = readEventsFromContent(
      JSON.stringify([{ event_name: 'External Resource Opened' }]),
    );
    expect(out?.events[0].name).toBe('External Resource Opened');
  });

  it('prefers `name` when multiple keys are present', () => {
    const out = readEventsFromContent(
      JSON.stringify([{ name: 'Canonical', event: 'Legacy' }]),
    );
    expect(out?.events[0].name).toBe('Canonical');
  });

  it('returns null when no entry has a recognizable name key', () => {
    const out = readEventsFromContent(
      JSON.stringify([{ description: 'orphan' }]),
    );
    expect(out).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(readEventsFromContent('[]')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(readEventsFromContent('{not json')).toBeNull();
  });

  it('filters out entries whose name is whitespace-only', () => {
    const out = readEventsFromContent(
      JSON.stringify([
        { name: 'Real Event' },
        { name: '   ' },
        { name: '\t\n' },
      ]),
    );
    expect(out?.events).toHaveLength(1);
    expect(out?.events[0].name).toBe('Real Event');
  });

  it('returns null when every entry has a whitespace-only name', () => {
    const out = readEventsFromContent(
      JSON.stringify([{ name: ' ' }, { name: '   ' }]),
    );
    expect(out).toBeNull();
  });

  it('trims surrounding whitespace from event names', () => {
    const out = readEventsFromContent(
      JSON.stringify([{ name: '  Signup Completed  ' }]),
    );
    expect(out?.events[0].name).toBe('Signup Completed');
  });

  it('accepts `eventDescriptionAndReasoning` as description alias', () => {
    const out = readEventsFromContent(
      JSON.stringify([
        {
          name: 'Foo',
          eventDescriptionAndReasoning: 'Fires when users foo',
        },
      ]),
    );
    expect(out?.events[0].description).toBe('Fires when users foo');
  });
});

describe('createDashboardStep', () => {
  let installDir: string;

  const mockedPersistDashboard = persistDashboard as unknown as ReturnType<
    typeof vi.fn
  >;

  const mockedWizardCapture = analytics.wizardCapture as unknown as ReturnType<
    typeof vi.fn
  >;

  const ui = (
    uiModule as unknown as {
      __ui: { applyJourneyTransition: ReturnType<typeof vi.fn> };
    }
  ).__ui;

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-dashboard-'));
    fs.writeFileSync(
      path.join(installDir, '.amplitude-events.json'),
      JSON.stringify([{ name: 'Hello API Called' }]),
    );
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  function baseSession(
    overrides: Partial<{
      selectedOrgId: string | null;
      selectedAppId: string | null;
      selectedProjectName: string | null;
    }> = {},
  ): Record<string, unknown> {
    return {
      installDir,
      selectedOrgId: overrides.selectedOrgId ?? '123',
      selectedAppId: overrides.selectedAppId ?? '456',
      selectedProjectName: overrides.selectedProjectName ?? 'My App',
      ...overrides,
    };
  }

  it('reuses legacy `.amplitude-dashboard.json` without calling the API', async () => {
    const dashboard = {
      dashboardUrl:
        'https://app.amplitude.com/analytics/amplitude/dashboard/y3qux0l8',
      dashboardId: 'y3qux0l8',
      charts: [{ id: 'c1', title: 'Top pages', type: 'line' }],
    };
    fs.writeFileSync(
      path.join(installDir, '.amplitude-dashboard.json'),
      JSON.stringify(dashboard),
    );

    await createDashboardStep({
      session: baseSession() as never,
      accessToken: 'token',
      integration: Integration.nextjs,
    });

    expect(mockedCreateWizardDashboard).not.toHaveBeenCalled();
    expect(mockedPersistDashboard).toHaveBeenCalledWith(installDir, dashboard);
    expect(mockedWizardCapture).toHaveBeenCalledWith(
      'dashboard created',
      expect.objectContaining({
        source: 'cached',
        'chart count': 1,
      }),
    );
    expect(ui.applyJourneyTransition).toHaveBeenCalledWith(
      'dashboard',
      'completed',
    );
  });

  it('reuses canonical `.amplitude/dashboard.json` without calling the API', async () => {
    const dashboard = {
      dashboardUrl:
        'https://app.amplitude.com/analytics/amplitude/dashboard/canonical-id',
      dashboardId: 'canonical-id',
      charts: [{ id: 'c1', title: 'Onboarding Funnel', type: 'funnel' }],
    };
    fs.mkdirSync(path.join(installDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      path.join(installDir, '.amplitude', 'dashboard.json'),
      JSON.stringify(dashboard),
    );

    await createDashboardStep({
      session: baseSession() as never,
      accessToken: 'token',
      integration: Integration.nextjs,
    });

    expect(mockedCreateWizardDashboard).not.toHaveBeenCalled();
    expect(mockedWizardCapture).toHaveBeenCalledWith(
      'dashboard created',
      expect.objectContaining({ source: 'cached' }),
    );
  });

  it('skips API when org/app are missing', async () => {
    await createDashboardStep({
      session: baseSession({
        selectedOrgId: null,
        selectedAppId: '456',
      }) as never,
      accessToken: 'token',
      integration: Integration.nextjs,
    });

    expect(mockedCreateWizardDashboard).not.toHaveBeenCalled();
    expect(mockedWizardCapture).toHaveBeenCalledWith(
      'dashboard skipped',
      expect.objectContaining({ reason: 'missing org or app' }),
    );
  });

  it('calls createWizardDashboard and persists the result on success', async () => {
    const apiResult = {
      dashboardUrl: 'https://app.amplitude.com/org/1/dashboard/abc',
      dashboardId: 'abc',
      charts: [{ id: 'c1', title: 'Funnel', type: 'FUNNELS' }],
    };
    mockedCreateWizardDashboard.mockResolvedValue(apiResult);

    const session = baseSession() as never;
    await createDashboardStep({
      session,
      accessToken: 'token',
      integration: Integration.nextjs,
    });

    expect(mockedCreateWizardDashboard).toHaveBeenCalledTimes(1);
    expect(mockedPersistDashboard).toHaveBeenCalledWith(installDir, apiResult);
    expect(session.checklistDashboardUrl).toBe(apiResult.dashboardUrl);
    expect(mockedWizardCapture).toHaveBeenCalledWith(
      'dashboard created',
      expect.objectContaining({
        source: 'wizard-proxy',
        'chart count': 1,
      }),
    );
    expect(ui.applyJourneyTransition).toHaveBeenCalledWith(
      'dashboard',
      'in_progress',
    );
    expect(ui.applyJourneyTransition).toHaveBeenCalledWith(
      'dashboard',
      'completed',
    );
  });

  it('surfaces failure when createWizardDashboard throws ApiError', async () => {
    mockedCreateWizardDashboard.mockRejectedValue(
      new ApiError('nope', 403, 'https://x/dashboards', 'FORBIDDEN'),
    );

    await createDashboardStep({
      session: baseSession() as never,
      accessToken: 'token',
      integration: Integration.nextjs,
    });

    expect(mockedWizardCapture).toHaveBeenCalledWith(
      'dashboard failed',
      expect.objectContaining({ reason: 'FORBIDDEN' }),
    );
    expect(ui.applyJourneyTransition).toHaveBeenCalledWith(
      'dashboard',
      'completed',
    );
  });

  it('falls through to API when legacy dashboard JSON is malformed', async () => {
    fs.writeFileSync(
      path.join(installDir, '.amplitude-dashboard.json'),
      '{ not json',
    );
    mockedCreateWizardDashboard.mockResolvedValue({
      dashboardUrl: 'https://app.amplitude.com/org/1/dashboard/abc',
      dashboardId: 'abc',
      charts: [],
    });

    await createDashboardStep({
      session: baseSession() as never,
      accessToken: 'token',
      integration: Integration.nextjs,
    });

    expect(mockedCreateWizardDashboard).toHaveBeenCalledTimes(1);
  });

  it('always clears dashboardFallbackPhase after the REST path', async () => {
    mockedCreateWizardDashboard.mockResolvedValue({
      dashboardUrl: 'https://app.amplitude.com/org/1/dashboard/abc',
      dashboardId: 'abc',
      charts: [],
    });
    const session = baseSession() as Record<string, unknown>;

    await createDashboardStep({
      session: session as never,
      accessToken: 'token',
      integration: Integration.nextjs,
    });

    expect(session.dashboardFallbackPhase).toBe('completed');
  });
});
