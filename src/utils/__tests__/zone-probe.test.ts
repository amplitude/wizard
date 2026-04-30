/**
 * Tests for the cross-zone org probe helper.
 *
 * Covers:
 *  - `otherZone` flips us↔eu correctly
 *  - `probeOtherZoneForOrgs` returns null count when no token exists
 *  - `probeOtherZoneForOrgs` returns the org count when probe succeeds
 *  - `probeOtherZoneForOrgs` swallows API errors and returns null
 *  - `buildNoOrgsMessage` renders the three recovery copy variants
 */

import { type MockedFunction } from 'vitest';

vi.mock('../ampli-settings', () => ({
  getStoredToken: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  fetchAmplitudeUser: vi.fn(),
}));

vi.mock('../debug', () => ({
  logToFile: vi.fn(),
}));

import {
  otherZone,
  probeOtherZoneForOrgs,
  buildNoOrgsMessage,
  NoOrgsError,
} from '../zone-probe';
import { getStoredToken } from '../ampli-settings';
import { fetchAmplitudeUser } from '../../lib/api';

const mockGetStoredToken = getStoredToken as MockedFunction<
  typeof getStoredToken
>;
const mockFetchUser = fetchAmplitudeUser as MockedFunction<
  typeof fetchAmplitudeUser
>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('otherZone', () => {
  it('flips us → eu', () => {
    expect(otherZone('us')).toBe('eu');
  });

  it('flips eu → us', () => {
    expect(otherZone('eu')).toBe('us');
  });
});

describe('probeOtherZoneForOrgs', () => {
  it('returns null orgCount when no stored token exists for the other zone', async () => {
    mockGetStoredToken.mockReturnValue(undefined);

    const result = await probeOtherZoneForOrgs('us');

    expect(result).toEqual({ otherZone: 'eu', otherOrgCount: null });
    expect(mockFetchUser).not.toHaveBeenCalled();
  });

  it('returns the org count when probe succeeds', async () => {
    mockGetStoredToken.mockReturnValue({
      accessToken: 'a',
      idToken: 'id-eu',
      refreshToken: 'r',
      expiresAt: '2099-01-01T00:00:00Z',
    });
    mockFetchUser.mockResolvedValue({
      id: 'u',
      firstName: 'A',
      lastName: 'B',
      email: 'x@y',
      orgs: [
        { id: '1', name: 'one', projects: [] },
        { id: '2', name: 'two', projects: [] },
      ],
    });

    const result = await probeOtherZoneForOrgs('us');

    expect(result).toEqual({ otherZone: 'eu', otherOrgCount: 2 });
    expect(mockFetchUser).toHaveBeenCalledWith('id-eu', 'eu');
  });

  it('returns 0 when probe succeeds but other zone has no orgs', async () => {
    mockGetStoredToken.mockReturnValue({
      accessToken: 'a',
      idToken: 'id',
      refreshToken: 'r',
      expiresAt: '2099-01-01T00:00:00Z',
    });
    mockFetchUser.mockResolvedValue({
      id: 'u',
      firstName: 'A',
      lastName: 'B',
      email: 'x@y',
      orgs: [],
    });

    const result = await probeOtherZoneForOrgs('eu');

    expect(result).toEqual({ otherZone: 'us', otherOrgCount: 0 });
  });

  it('degrades to null orgCount when the API call throws', async () => {
    mockGetStoredToken.mockReturnValue({
      accessToken: 'a',
      idToken: 'id',
      refreshToken: 'r',
      expiresAt: '2099-01-01T00:00:00Z',
    });
    mockFetchUser.mockRejectedValue(new Error('network down'));

    const result = await probeOtherZoneForOrgs('us');

    expect(result).toEqual({ otherZone: 'eu', otherOrgCount: null });
  });
});

describe('buildNoOrgsMessage', () => {
  it('renders an actionable hint with the org count when other zone has orgs', () => {
    const msg = buildNoOrgsMessage('us', {
      otherZone: 'eu',
      otherOrgCount: 3,
    });

    expect(msg).toContain('US');
    expect(msg).toContain('3 organizations in EU');
    expect(msg).toContain('/region');
    expect(msg).toContain('--zone eu');
  });

  it('uses singular "organization" when other zone has exactly one', () => {
    const msg = buildNoOrgsMessage('us', {
      otherZone: 'eu',
      otherOrgCount: 1,
    });

    expect(msg).toContain('1 organization in EU');
  });

  it('renders the "different account" copy when both zones are empty', () => {
    const msg = buildNoOrgsMessage('eu', {
      otherZone: 'us',
      otherOrgCount: 0,
    });

    expect(msg).toContain(
      "couldn't find any Amplitude organizations linked to your account",
    );
    expect(msg).toContain('different account');
    // Crucially, must NOT advertise a (zero) count back at the user
    expect(msg).not.toContain('0 organization');
  });

  it('renders the degraded copy without an org count when probe was unavailable', () => {
    const msg = buildNoOrgsMessage('us', {
      otherZone: 'eu',
      otherOrgCount: null,
    });

    expect(msg).toContain('No organizations found in US');
    expect(msg).toContain('If your team uses EU');
    expect(msg).toContain('/region');
    expect(msg).toContain('--zone eu');
    // Must NOT advertise a fake org count
    expect(msg).not.toMatch(/\d+ organization/);
  });
});

describe('NoOrgsError', () => {
  it('carries zone metadata for the TUI/outro to render recovery actions', () => {
    const err = new NoOrgsError('msg', 'us', 'eu', 4);

    expect(err.name).toBe('NoOrgsError');
    expect(err.currentZone).toBe('us');
    expect(err.otherZone).toBe('eu');
    expect(err.otherOrgCount).toBe(4);
    expect(err.message).toBe('msg');
  });

  it('accepts null orgCount for the degraded path', () => {
    const err = new NoOrgsError('msg', 'eu', 'us', null);

    expect(err.otherOrgCount).toBeNull();
  });
});
