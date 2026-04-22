import { type Mock, type MockedFunction } from 'vitest';
/**
 * Tests for the login flow org-resolution logic added in askForWizardLogin:
 *
 * - New user (0 orgs) → abort with guidance
 * - Single org → auto-select, no prompt
 * - Multiple orgs → select prompt shown, chosen org used
 * - performAmplitudeAuth returns pending-recovery → warn + fall through to API-key prompt
 *
 * Under the bundled-auth contract, `performAmplitudeAuth` is responsible for
 * fetching userInfo, detecting region, and persisting to disk — so these tests
 * only mock the auth function's outcome and verify setup-utils' own logic
 * (org selection, CI-mode shortcut, graceful degradation).
 */

import { getOrAskForProjectData } from '../setup-utils';

// ── Mock all external dependencies ───────────────────────────────────────────

vi.mock('../../ui', () => ({
  getUI: vi.fn().mockReturnValue({
    log: {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      step: vi.fn(),
    },
    spinner: vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() }),
    setLoginUrl: vi.fn(),
    setCredentials: vi.fn(),
    cancel: vi.fn(),
  }),
}));

vi.mock('../oauth', () => ({
  performAmplitudeAuth: vi.fn(),
}));

vi.mock('../../telemetry', () => ({
  traceStep: vi.fn((_step: string, fn: () => unknown) => fn()),
}));

vi.mock('../../utils/wizard-abort', () => ({
  wizardAbort: vi.fn().mockRejectedValue(new Error('wizard aborted')),
}));

// @inquirer/prompts is dynamically imported inside the function
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  input: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { performAmplitudeAuth } from '../oauth';
import { getUI } from '../../ui';
import type { AmplitudeUserInfo } from '../../lib/api';
import type { StoredUser, StoredOAuthToken } from '../ampli-settings';
import * as inquirer from '@inquirer/prompts';

const mockPerformAmplitudeAuth = performAmplitudeAuth as MockedFunction<
  typeof performAmplitudeAuth
>;
const mockSelect = inquirer.select as MockedFunction<typeof inquirer.select>;
const mockInput = inquirer.input as MockedFunction<typeof inquirer.input>;

const TOKENS: StoredOAuthToken = {
  idToken: 'id-token',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
};

const STORED_USER: StoredUser = {
  id: 'user-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  zone: 'us',
};

function makeCompleteOutcome(
  orgs: AmplitudeUserInfo['orgs'],
): ReturnType<typeof performAmplitudeAuth> extends Promise<infer T>
  ? T
  : never {
  return {
    status: 'complete',
    user: STORED_USER,
    userInfo: {
      id: STORED_USER.id,
      firstName: STORED_USER.firstName,
      lastName: STORED_USER.lastName,
      email: STORED_USER.email,
      orgs,
    },
    tokens: TOKENS,
    zone: 'us',
  };
}

const ORG_A = { id: 'org-a', name: 'Acme', workspaces: [] };
const ORG_B = { id: 'org-b', name: 'Globex', workspaces: [] };

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('login flow — org resolution', () => {
  beforeEach(() => {
    mockInput.mockResolvedValue('amp-api-key-123');
  });

  describe('new user — no orgs', () => {
    it('logs an error and aborts when the user has no organizations', async () => {
      mockPerformAmplitudeAuth.mockResolvedValue(makeCompleteOutcome([]));

      await expect(
        getOrAskForProjectData({ signup: false, ci: false }),
      ).rejects.toThrow('wizard aborted');

      const ui = getUI();
      expect(ui.log.error).toHaveBeenCalledWith(
        expect.stringContaining('No Amplitude organization found'),
      );
    });

    it('includes signup guidance in the error message', async () => {
      mockPerformAmplitudeAuth.mockResolvedValue(makeCompleteOutcome([]));

      await expect(
        getOrAskForProjectData({ signup: false, ci: false }),
      ).rejects.toThrow();

      const ui = getUI();
      const errorCall = (ui.log.error as Mock).mock.calls[0][0] as string;
      expect(errorCall).toContain('app.amplitude.com');
    });
  });

  describe('single org', () => {
    it('auto-selects the org without prompting', async () => {
      mockPerformAmplitudeAuth.mockResolvedValue(makeCompleteOutcome([ORG_A]));

      await getOrAskForProjectData({ signup: false, ci: false });

      expect(mockSelect).not.toHaveBeenCalled();
    });

    it('shows the org name in the success message', async () => {
      mockPerformAmplitudeAuth.mockResolvedValue(makeCompleteOutcome([ORG_A]));

      await getOrAskForProjectData({ signup: false, ci: false });

      const ui = getUI();
      expect(ui.log.success).toHaveBeenCalledWith(
        expect.stringContaining('Acme'),
      );
    });
  });

  describe('multiple orgs', () => {
    it('prompts the user to select an org', async () => {
      mockPerformAmplitudeAuth.mockResolvedValue(
        makeCompleteOutcome([ORG_A, ORG_B]),
      );
      mockSelect.mockResolvedValue(ORG_B);

      await getOrAskForProjectData({ signup: false, ci: false });

      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('organization'),
          choices: expect.arrayContaining([
            expect.objectContaining({ name: 'Acme', value: ORG_A }),
            expect.objectContaining({ name: 'Globex', value: ORG_B }),
          ]),
        }),
      );
    });

    it('uses the selected org name in the success message', async () => {
      mockPerformAmplitudeAuth.mockResolvedValue(
        makeCompleteOutcome([ORG_A, ORG_B]),
      );
      mockSelect.mockResolvedValue(ORG_B);

      await getOrAskForProjectData({ signup: false, ci: false });

      const ui = getUI();
      expect(ui.log.success).toHaveBeenCalledWith(
        expect.stringContaining('Globex'),
      );
    });
  });
});

describe('login flow — pending-recovery fallback', () => {
  beforeEach(() => {
    mockInput.mockResolvedValue('amp-api-key-123');
  });

  it('warns and falls through to manual API-key prompt when userInfo unresolvable', async () => {
    mockPerformAmplitudeAuth.mockResolvedValue({
      status: 'pending-recovery',
      tokens: TOKENS,
      zone: 'us',
    });

    const result = await getOrAskForProjectData({ signup: false, ci: false });

    const ui = getUI();
    expect(ui.log.warn).toHaveBeenCalled();
    expect(result.projectApiKey).toBe('amp-api-key-123');
  });

  it('surfaces the tokens.accessToken from pending-recovery', async () => {
    mockPerformAmplitudeAuth.mockResolvedValue({
      status: 'pending-recovery',
      tokens: TOKENS,
      zone: 'us',
    });

    const result = await getOrAskForProjectData({ signup: false, ci: false });

    expect(result.accessToken).toBe(TOKENS.accessToken);
  });
});

describe('login flow — CI mode', () => {
  it('bypasses OAuth and returns the provided API key directly', async () => {
    const result = await getOrAskForProjectData({
      ci: true,
      apiKey: 'phx_test_key',
      signup: false,
    });

    expect(mockPerformAmplitudeAuth).not.toHaveBeenCalled();
    expect(result.projectApiKey).toBe('phx_test_key');
  });

  it('returns cloudRegion "us" in CI mode', async () => {
    const result = await getOrAskForProjectData({
      ci: true,
      apiKey: 'phx_test_key',
      signup: false,
    });

    expect(result.cloudRegion).toBe('us');
  });
});
