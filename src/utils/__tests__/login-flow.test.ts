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

vi.mock('../zone-probe', async () => {
  // Use the real `buildNoOrgsMessage` / `NoOrgsError` so copy-shape tests
  // exercise the actual production logic. Only `probeOtherZoneForOrgs`
  // (the network call) is stubbed.
  const actual = await vi.importActual<typeof import('../zone-probe')>(
    '../zone-probe',
  );
  return {
    ...actual,
    probeOtherZoneForOrgs: vi.fn(),
  };
});

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
import { probeOtherZoneForOrgs, NoOrgsError } from '../zone-probe';
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
const mockProbeOtherZone = probeOtherZoneForOrgs as MockedFunction<
  typeof probeOtherZoneForOrgs
>;
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
    // Default probe: degraded path (no token for other zone)
    mockProbeOtherZone.mockResolvedValue({
      otherZone: 'eu',
      otherOrgCount: null,
    });
  });

  describe('new user — no orgs', () => {
    it('throws a NoOrgsError when the user has no organizations', async () => {
      mockFetchAmplitudeUser.mockResolvedValue(makeUser([]));

      await expect(
        getOrAskForProjectData({ signup: false, ci: false }),
      ).rejects.toThrow(NoOrgsError);

      const ui = getUI();
      expect(ui.log.error).toHaveBeenCalledWith(
        expect.stringContaining('No Amplitude organization found'),
      );
    });

    it('drops the misleading "your account has no organizations" wording', async () => {
      mockFetchAmplitudeUser.mockResolvedValue(makeUser([]));

      await expect(
        getOrAskForProjectData({ signup: false, ci: false }),
      ).rejects.toThrow();

      const ui = getUI();
      const errorCall = (ui.log.error as Mock).mock.calls[0][0] as string;
      // Old wording was confusing when the user just picked the wrong zone
      expect(errorCall).not.toContain('Your account has no organizations');
    });

    it('probes the other zone and surfaces an actionable hint when orgs are found there', async () => {
      mockFetchAmplitudeUser.mockResolvedValue(makeUser([]));
      mockProbeOtherZone.mockResolvedValue({
        otherZone: 'eu',
        otherOrgCount: 2,
      });

      let caught: NoOrgsError | undefined;
      try {
        await getOrAskForProjectData({ signup: false, ci: false });
      } catch (err) {
        caught = err as NoOrgsError;
      }

      expect(caught).toBeInstanceOf(NoOrgsError);
      expect(caught?.otherZone).toBe('eu');
      expect(caught?.otherOrgCount).toBe(2);
      expect(caught?.message).toContain('2 organizations in EU');
      expect(caught?.message).toContain('/region');
      expect(caught?.message).toContain('--zone eu');
    });

    it('falls back to "no orgs anywhere" copy when both zones are empty', async () => {
      mockFetchAmplitudeUser.mockResolvedValue(makeUser([]));
      mockProbeOtherZone.mockResolvedValue({
        otherZone: 'eu',
        otherOrgCount: 0,
      });

      let caught: NoOrgsError | undefined;
      try {
        await getOrAskForProjectData({ signup: false, ci: false });
      } catch (err) {
        caught = err as NoOrgsError;
      }

      expect(caught).toBeInstanceOf(NoOrgsError);
      expect(caught?.message).toContain(
        "couldn't find any Amplitude organizations linked to your account",
      );
      expect(caught?.message).toContain('different account');
    });

    it('falls back to degraded copy without an org count when the other zone is unprobeable', async () => {
      mockFetchAmplitudeUser.mockResolvedValue(makeUser([]));
      mockProbeOtherZone.mockResolvedValue({
        otherZone: 'eu',
        otherOrgCount: null,
      });

      let caught: NoOrgsError | undefined;
      try {
        await getOrAskForProjectData({ signup: false, ci: false });
      } catch (err) {
        caught = err as NoOrgsError;
      }

      expect(caught).toBeInstanceOf(NoOrgsError);
      expect(caught?.otherOrgCount).toBeNull();
      // Degraded copy must NOT advertise a fake count
      expect(caught?.message).not.toMatch(/\d+ organization/);
      // But it MUST point the user at /region for recovery
      expect(caught?.message).toContain('/region');
      expect(caught?.message).toContain('--zone eu');
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
