import { type Mock, type MockedFunction } from 'vitest';
/**
 * Tests for the login flow org-resolution logic added in askForWizardLogin:
 *
 * - New user (0 orgs) → abort with guidance
 * - Single org → auto-select, no prompt
 * - Multiple orgs → select prompt shown, chosen org used
 * - Zone detection → cloudRegion from detectRegionFromToken, not hardcoded 'us'
 * - Zone detection failure → falls back to 'us'
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

vi.mock('../../lib/api', () => ({
  fetchAmplitudeUser: vi.fn(),
}));

vi.mock('../ampli-settings', () => ({
  storeToken: vi.fn(),
}));

vi.mock('../urls', () => ({
  detectRegionFromToken: vi.fn(),
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
import { fetchAmplitudeUser } from '../../lib/api';
import { detectRegionFromToken } from '../urls';
import { storeToken } from '../ampli-settings';
import { getUI } from '../../ui';
import type { AmplitudeUserInfo } from '../../lib/api';
import * as inquirer from '@inquirer/prompts';

const mockPerformAmplitudeAuth = performAmplitudeAuth as MockedFunction<
  typeof performAmplitudeAuth
>;
const mockFetchAmplitudeUser = fetchAmplitudeUser as MockedFunction<
  typeof fetchAmplitudeUser
>;
const mockDetectRegion = detectRegionFromToken as MockedFunction<
  typeof detectRegionFromToken
>;
const mockStoreToken = storeToken as MockedFunction<typeof storeToken>;
const mockSelect = inquirer.select as MockedFunction<typeof inquirer.select>;
const mockInput = inquirer.input as MockedFunction<typeof inquirer.input>;

const AUTH_RESULT = {
  idToken: 'id-token',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  zone: 'us' as const,
};

function makeUser(orgs: AmplitudeUserInfo['orgs']): AmplitudeUserInfo {
  return {
    id: 'user-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    orgs,
  };
}

const ORG_A = { id: 'org-a', name: 'Acme', projects: [] };
const ORG_B = { id: 'org-b', name: 'Globex', projects: [] };

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('login flow — org resolution', () => {
  beforeEach(() => {
    mockPerformAmplitudeAuth.mockResolvedValue(AUTH_RESULT);
    mockDetectRegion.mockResolvedValue('us');
    // Default: API key prompt returns a key
    mockInput.mockResolvedValue('amp-api-key-123');
  });

  describe('new user — no orgs', () => {
    it('logs an error and aborts when the user has no organizations', async () => {
      mockFetchAmplitudeUser.mockResolvedValue(makeUser([]));

      await expect(
        getOrAskForProjectData({ signup: false, ci: false }),
      ).rejects.toThrow('wizard aborted');

      const ui = getUI();
      expect(ui.log.error).toHaveBeenCalledWith(
        expect.stringContaining('No Amplitude organization found'),
      );
    });

    it('includes signup guidance in the error message', async () => {
      mockFetchAmplitudeUser.mockResolvedValue(makeUser([]));

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
      mockFetchAmplitudeUser.mockResolvedValue(makeUser([ORG_A]));

      await getOrAskForProjectData({ signup: false, ci: false });

      expect(mockSelect).not.toHaveBeenCalled();
    });

    it('shows the org name in the success message', async () => {
      mockFetchAmplitudeUser.mockResolvedValue(makeUser([ORG_A]));

      await getOrAskForProjectData({ signup: false, ci: false });

      const ui = getUI();
      expect(ui.log.success).toHaveBeenCalledWith(
        expect.stringContaining('Acme'),
      );
    });
  });

  describe('multiple orgs', () => {
    it('prompts the user to select an org', async () => {
      mockFetchAmplitudeUser.mockResolvedValue(makeUser([ORG_A, ORG_B]));
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
      mockFetchAmplitudeUser.mockResolvedValue(makeUser([ORG_A, ORG_B]));
      mockSelect.mockResolvedValue(ORG_B);

      await getOrAskForProjectData({ signup: false, ci: false });

      const ui = getUI();
      expect(ui.log.success).toHaveBeenCalledWith(
        expect.stringContaining('Globex'),
      );
    });
  });

  describe('token persistence', () => {
    it('calls storeToken with user details after successful auth', async () => {
      mockFetchAmplitudeUser.mockResolvedValue(makeUser([ORG_A]));

      await getOrAskForProjectData({ signup: false, ci: false });

      expect(mockStoreToken).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'user-1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
        }),
        expect.objectContaining({
          accessToken: AUTH_RESULT.accessToken,
          idToken: AUTH_RESULT.idToken,
          refreshToken: AUTH_RESULT.refreshToken,
        }),
      );
    });
  });
});

describe('login flow — zone / region detection', () => {
  beforeEach(() => {
    mockPerformAmplitudeAuth.mockResolvedValue(AUTH_RESULT);
    mockFetchAmplitudeUser.mockResolvedValue(makeUser([ORG_A]));
    mockInput.mockResolvedValue('amp-api-key-123');
  });

  it('returns the detected cloud region in the result', async () => {
    mockDetectRegion.mockResolvedValue('eu');

    const result = await getOrAskForProjectData({ signup: false, ci: false });

    expect(result.cloudRegion).toBe('eu');
  });

  it('passes the detected region to fetchAmplitudeUser', async () => {
    mockDetectRegion.mockResolvedValue('eu');

    await getOrAskForProjectData({ signup: false, ci: false });

    expect(mockFetchAmplitudeUser).toHaveBeenCalledWith(
      AUTH_RESULT.idToken,
      'eu',
    );
  });

  it('falls back to "us" when region detection throws', async () => {
    mockDetectRegion.mockRejectedValue(new Error('network error'));

    const result = await getOrAskForProjectData({ signup: false, ci: false });

    expect(result.cloudRegion).toBe('us');
  });

  it('uses "us" region by default when detection succeeds with us', async () => {
    mockDetectRegion.mockResolvedValue('us');

    const result = await getOrAskForProjectData({ signup: false, ci: false });

    expect(result.cloudRegion).toBe('us');
  });
});

describe('login flow — fetchAmplitudeUser failure', () => {
  beforeEach(() => {
    mockPerformAmplitudeAuth.mockResolvedValue(AUTH_RESULT);
    mockDetectRegion.mockResolvedValue('us');
    mockInput.mockResolvedValue('amp-api-key-123');
  });

  it('logs a warning and continues when user info fetch fails', async () => {
    mockFetchAmplitudeUser.mockRejectedValue(new Error('API unavailable'));

    const result = await getOrAskForProjectData({ signup: false, ci: false });

    const ui = getUI();
    expect(ui.log.warn).toHaveBeenCalled();
    // Still returns a result with the api key
    expect(result.projectApiKey).toBe('amp-api-key-123');
  });

  it('does not call storeToken when user info fetch fails', async () => {
    mockFetchAmplitudeUser.mockRejectedValue(new Error('API unavailable'));

    await getOrAskForProjectData({ signup: false, ci: false });

    expect(mockStoreToken).not.toHaveBeenCalled();
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
    expect(mockFetchAmplitudeUser).not.toHaveBeenCalled();
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
