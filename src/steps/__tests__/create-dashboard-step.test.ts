/**
 * Unit tests for createDashboardStep.
 *
 * The underlying REST helper is mocked so we focus on the step's orchestration:
 * idempotency key lifecycle, short-circuit paths, session mutation on success,
 * IDEMPOTENCY_CONFLICT handling, and terminal-failure swallowing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildSession, RunPhase } from '../../lib/wizard-session';
import type { WizardSession } from '../../lib/wizard-session';
import { ApiError } from '../../lib/api';

const createWizardDashboardMock = vi.fn();
const setDashboardUrlMock = vi.fn();
const wizardCaptureMock = vi.fn();
const captureExceptionMock = vi.fn();
const captureWizardErrorMock = vi.fn();
const saveCheckpointMock = vi.fn();

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>(
    '../../lib/api',
  );
  return {
    ...actual,
    createWizardDashboard: (...args: unknown[]) =>
      createWizardDashboardMock(...args),
  };
});

vi.mock('../../lib/session-checkpoint', () => ({
  saveCheckpoint: (...args: unknown[]) => saveCheckpointMock(...args),
}));

vi.mock('../../utils/analytics', () => ({
  analytics: {
    wizardCapture: (...args: unknown[]) => wizardCaptureMock(...args),
    captureException: (...args: unknown[]) => captureExceptionMock(...args),
    setSessionProperty: vi.fn(),
  },
  captureWizardError: (...args: unknown[]) => captureWizardErrorMock(...args),
}));

vi.mock('../../ui', () => ({
  getUI: () => ({
    setDashboardUrl: (url: string) => setDashboardUrlMock(url),
  }),
}));

// Import AFTER mocks so the module resolves against them.
import { createDashboardStep } from '../create-dashboard-step';

function makeSession(overrides: Partial<WizardSession> = {}): WizardSession {
  const session = buildSession({ installDir: '/tmp/wizard-test' });
  session.runPhase = RunPhase.Running;
  session.credentials = {
    accessToken: 'token',
    projectApiKey: 'key',
    host: 'https://api2.amplitude.com',
    appId: 12345,
  };
  session.selectedOrgId = 'org-1';
  session.selectedEnvName = 'Production';
  session.selectedWorkspaceName = 'Wizard Workspace';
  session.integration = 'nextjs' as WizardSession['integration'];
  session.autocaptureEnabled = true;
  return Object.assign(session, overrides);
}

const EVENTS = [
  { name: 'user signed up', description: 'auth complete' },
  { name: 'product viewed', description: 'detail view' },
];

describe('createDashboardStep', () => {
  beforeEach(() => {
    createWizardDashboardMock.mockReset();
    setDashboardUrlMock.mockReset();
    wizardCaptureMock.mockReset();
    captureExceptionMock.mockReset();
    captureWizardErrorMock.mockReset();
    saveCheckpointMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('short-circuits when no events are present', async () => {
    const session = makeSession();
    const result = await createDashboardStep({
      session,
      events: [],
      accessToken: 'tok',
      zone: 'us',
    });
    expect(result).toEqual({ dashboardUrl: null, skipped: true });
    expect(createWizardDashboardMock).not.toHaveBeenCalled();
  });

  it('short-circuits when credentials are missing', async () => {
    const session = makeSession();
    session.credentials = null;
    const result = await createDashboardStep({
      session,
      events: EVENTS,
      accessToken: 'tok',
      zone: 'us',
    });
    expect(result.skipped).toBe(true);
    expect(createWizardDashboardMock).not.toHaveBeenCalled();
  });

  it('short-circuits when selectedOrgId is missing', async () => {
    const session = makeSession({ selectedOrgId: null });
    const result = await createDashboardStep({
      session,
      events: EVENTS,
      accessToken: 'tok',
      zone: 'us',
    });
    expect(result.skipped).toBe(true);
    expect(createWizardDashboardMock).not.toHaveBeenCalled();
  });

  it('generates and persists an idempotency key before the network call', async () => {
    const session = makeSession();
    createWizardDashboardMock.mockResolvedValueOnce({
      dashboard: { id: 'd1', url: 'https://app/dash', name: 'Dash' },
      charts: [
        {
          id: 'c1',
          title: 'x',
          type: 'FUNNELS',
          section: 'ACTIVATION',
          skipped: false,
        },
      ],
      warnings: [],
    });

    const result = await createDashboardStep({
      session,
      events: EVENTS,
      accessToken: 'tok',
      zone: 'us',
    });

    expect(session.dashboardIdempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(saveCheckpointMock).toHaveBeenCalled();
    expect(result).toEqual({
      dashboardUrl: 'https://app/dash',
      skipped: false,
    });
    expect(session.dashboardId).toBe('d1');
    expect(session.dashboardUrl).toBe('https://app/dash');
    expect(session.dashboardWarnings).toEqual([]);
    expect(setDashboardUrlMock).toHaveBeenCalledWith('https://app/dash');
    expect(wizardCaptureMock).toHaveBeenCalledWith(
      'dashboard created',
      expect.objectContaining({
        'dashboard id': 'd1',
        'chart count': 1,
        framework: 'nextjs',
        autocapture: true,
      }),
    );
  });

  it('reuses an existing idempotency key on re-invocation', async () => {
    const session = makeSession();
    session.dashboardIdempotencyKey = 'existing-key-abc';
    createWizardDashboardMock.mockResolvedValueOnce({
      dashboard: { id: 'd1', url: 'https://app/dash', name: 'Dash' },
      charts: [],
      warnings: [],
    });

    await createDashboardStep({
      session,
      events: EVENTS,
      accessToken: 'tok',
      zone: 'us',
    });

    expect(session.dashboardIdempotencyKey).toBe('existing-key-abc');
    const [, , , key] = createWizardDashboardMock.mock.calls[0];
    expect(key).toBe('existing-key-abc');
  });

  it('treats IDEMPOTENCY_CONFLICT as success when the cached dashboardId matches', async () => {
    const session = makeSession();
    session.dashboardId = 'd1';
    session.dashboardUrl = 'https://app/dash';
    createWizardDashboardMock.mockRejectedValueOnce(
      new ApiError('conflict', 409, 'url', 'IDEMPOTENCY_CONFLICT'),
    );

    const result = await createDashboardStep({
      session,
      events: EVENTS,
      accessToken: 'tok',
      zone: 'us',
    });
    expect(result).toEqual({
      dashboardUrl: 'https://app/dash',
      skipped: false,
    });
    expect(setDashboardUrlMock).toHaveBeenCalledWith('https://app/dash');
  });

  it('swallows terminal failures and keeps the agent run successful', async () => {
    const session = makeSession();
    createWizardDashboardMock.mockRejectedValueOnce(
      new ApiError('bad request', 400, 'url', 'INVALID_REQUEST'),
    );

    const result = await createDashboardStep({
      session,
      events: EVENTS,
      accessToken: 'tok',
      zone: 'us',
    });
    expect(result).toEqual({ dashboardUrl: null, skipped: true });
    expect(captureWizardErrorMock).toHaveBeenCalledWith(
      'Dashboard Creation',
      'bad request',
      'create-dashboard-step',
      expect.objectContaining({
        'error code': 'INVALID_REQUEST',
        'http status': 400,
      }),
    );
    expect(wizardCaptureMock).toHaveBeenCalledWith(
      'dashboard create failed',
      expect.objectContaining({
        'error code': 'INVALID_REQUEST',
        'http status': 400,
      }),
    );
  });

  it('sends autocaptureEnabled=false when session flag is null', async () => {
    const session = makeSession();
    session.autocaptureEnabled = null;
    createWizardDashboardMock.mockResolvedValueOnce({
      dashboard: { id: 'd1', url: 'https://app/dash', name: 'Dash' },
      charts: [],
      warnings: [],
    });

    await createDashboardStep({
      session,
      events: EVENTS,
      accessToken: 'tok',
      zone: 'us',
    });

    const [, , body] = createWizardDashboardMock.mock.calls[0];
    expect((body as { autocaptureEnabled: boolean }).autocaptureEnabled).toBe(
      false,
    );
  });
});
