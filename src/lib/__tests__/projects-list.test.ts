import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the cached-token + fetchAmplitudeUser layer so the test doesn't need
// network access or a real ~/.ampli.json. Mocks are hoisted so they apply
// before agent-ops imports the modules.
vi.mock('../../utils/ampli-settings', async () => {
  return {
    getStoredUser: vi.fn(),
    getStoredToken: vi.fn(),
  };
});

vi.mock('../api', async () => {
  return {
    fetchAmplitudeUser: vi.fn(),
  };
});

import { runProjectsList } from '../agent-ops.js';
import { getStoredUser, getStoredToken } from '../../utils/ampli-settings.js';
import { fetchAmplitudeUser } from '../api.js';

const mockedGetUser = vi.mocked(getStoredUser);
const mockedGetToken = vi.mocked(getStoredToken);
const mockedFetch = vi.mocked(fetchAmplitudeUser);

const FIXTURE = {
  id: 'user-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  orgs: [
    {
      id: 'org-amplitude',
      name: 'Amplitude',
      workspaces: [
        {
          id: 'ws-growth',
          name: 'Growth',
          environments: [
            {
              name: 'Production',
              rank: 1,
              app: { id: '769610', apiKey: 'k1' },
            },
            {
              name: 'Development',
              rank: 2,
              app: { id: '769611', apiKey: 'k2' },
            },
          ],
        },
        {
          id: 'ws-data',
          name: 'Data',
          environments: [
            {
              name: 'Production',
              rank: 1,
              app: { id: '769612', apiKey: 'k3' },
            },
            {
              // no apiKey — should be filtered out
              name: 'Development',
              rank: 2,
              app: { id: '769613', apiKey: null },
            },
          ],
        },
      ],
    },
    {
      id: 'org-customer',
      name: 'Customer Co',
      workspaces: [
        {
          id: 'ws-default',
          name: 'Default',
          environments: [
            {
              name: 'Production',
              rank: 1,
              app: { id: '999001', apiKey: 'k4' },
            },
          ],
        },
      ],
    },
  ],
};

describe('runProjectsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetUser.mockReturnValue({
      id: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      zone: 'us',
    });
    mockedGetToken.mockReturnValue({
      accessToken: 'a',
      idToken: 'i',
      refreshToken: 'r',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    mockedFetch.mockResolvedValue(FIXTURE);
  });

  it('returns one choice per environment with an apiKey', async () => {
    const result = await runProjectsList();
    expect(result.warning).toBeUndefined();
    expect(result.total).toBe(4); // 2 + 1 (filtered) + 1 = 4
    expect(result.returned).toBe(4);
    expect(result.choices.map((c) => c.appId).sort()).toEqual([
      '769610',
      '769611',
      '769612',
      '999001',
    ]);
  });

  it('builds breadcrumb description and per-choice resumeFlags', async () => {
    const result = await runProjectsList();
    const sample = result.choices.find((c) => c.appId === '769610');
    expect(sample).toMatchObject({
      label: 'Amplitude / Growth / Production',
      description: 'Amplitude > Growth > Production',
      orgId: 'org-amplitude',
      orgName: 'Amplitude',
      workspaceName: 'Growth',
      envName: 'Production',
      rank: 1,
      resumeFlags: ['--app-id', '769610'],
    });
  });

  it('filters by query case-insensitively across all label fields', async () => {
    const r = await runProjectsList({ query: 'GROWTH' });
    expect(r.total).toBe(2);
    expect(r.choices.every((c) => c.label.includes('Growth'))).toBe(true);
  });

  it('matches against app id', async () => {
    const r = await runProjectsList({ query: '999001' });
    expect(r.total).toBe(1);
    expect(r.choices[0].appId).toBe('999001');
  });

  it('paginates with limit + offset, deterministically ordered', async () => {
    const page1 = await runProjectsList({ limit: 2, offset: 0 });
    const page2 = await runProjectsList({ limit: 2, offset: 2 });
    expect(page1.returned).toBe(2);
    expect(page2.returned).toBe(2);
    // No overlap, full coverage
    const seen = [...page1.choices, ...page2.choices].map((c) => c.appId);
    expect(new Set(seen).size).toBe(4);
  });

  it('clamps limit to [1, 200]', async () => {
    const r1 = await runProjectsList({ limit: -10 });
    expect(r1.returned).toBeLessThanOrEqual(1);
    const r2 = await runProjectsList({ limit: 9999 });
    expect(r2.returned).toBe(4); // total fixture size
  });

  it('returns warning when not logged in (no user)', async () => {
    mockedGetUser.mockReturnValue(null);
    const r = await runProjectsList();
    expect(r.warning).toMatch(/Not logged in/);
    expect(r.choices).toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('returns warning for the pending-sentinel user', async () => {
    mockedGetUser.mockReturnValue({
      id: 'pending',
      firstName: '',
      lastName: '',
      email: '',
      zone: 'us',
    });
    const r = await runProjectsList();
    expect(r.warning).toMatch(/Not logged in/);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('returns warning when no idToken is stored', async () => {
    mockedGetToken.mockReturnValue(null);
    const r = await runProjectsList();
    expect(r.warning).toMatch(/id_token/);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('echoes back the lowercased query for paginator cursor reasoning', async () => {
    const r = await runProjectsList({ query: '  Growth  ' });
    expect(r.query).toBe('growth');
  });

  it('orders by rank then label for deterministic pagination', async () => {
    const r = await runProjectsList();
    // rank=1 entries first, alphabetized by label
    expect(r.choices[0].rank).toBe(1);
    const ranks = r.choices.map((c) => c.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});
