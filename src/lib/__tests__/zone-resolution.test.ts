import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveZone, tryResolveZone } from '../zone-resolution.js';
import { buildSession } from '../wizard-session.js';

vi.mock('../ampli-config.js', () => ({
  readAmpliConfig: vi.fn(() => ({ ok: false, error: 'not_found' })),
}));

vi.mock('../../utils/ampli-settings.js', () => ({
  getStoredUser: vi.fn(() => undefined),
}));

describe('resolveZone', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the fallback when no zone signal is present', async () => {
    const { readAmpliConfig } = await import('../ampli-config.js');
    const { getStoredUser } = await import('../../utils/ampli-settings.js');
    vi.mocked(readAmpliConfig).mockReturnValue({
      ok: false,
      error: 'not_found',
    });
    vi.mocked(getStoredUser).mockReturnValue(undefined);

    const session = buildSession({});
    expect(resolveZone(session, 'us')).toBe('us');
  });

  it('returns session.region when set — beats every lower tier', async () => {
    const { readAmpliConfig } = await import('../ampli-config.js');
    const { getStoredUser } = await import('../../utils/ampli-settings.js');
    vi.mocked(readAmpliConfig).mockReturnValue({
      ok: true,
      config: { Zone: 'us' },
    });
    vi.mocked(getStoredUser).mockReturnValue({
      id: 'user-123',
      email: 'x@x',
      firstName: 'x',
      lastName: 'x',
      zone: 'us',
    });

    const session = buildSession({});
    session.region = 'eu';
    expect(resolveZone(session, 'us')).toBe('eu');
  });

  it('returns ampli.json Zone when session.region is null', async () => {
    const { readAmpliConfig } = await import('../ampli-config.js');
    vi.mocked(readAmpliConfig).mockReturnValue({
      ok: true,
      config: { Zone: 'eu' },
    });

    const session = buildSession({});
    expect(resolveZone(session, 'us')).toBe('eu');
  });

  it('returns real storedUser zone when no intent and no ampli.json Zone', async () => {
    const { readAmpliConfig } = await import('../ampli-config.js');
    const { getStoredUser } = await import('../../utils/ampli-settings.js');
    vi.mocked(readAmpliConfig).mockReturnValue({
      ok: false,
      error: 'not_found',
    });
    vi.mocked(getStoredUser).mockReturnValue({
      id: 'user-123',
      email: 'x@x',
      firstName: 'x',
      lastName: 'x',
      zone: 'eu',
    });

    const session = buildSession({});
    expect(resolveZone(session, 'us')).toBe('eu');
  });

  it('returns pending storedUser zone as recovery fallback (#165)', async () => {
    const { readAmpliConfig } = await import('../ampli-config.js');
    const { getStoredUser } = await import('../../utils/ampli-settings.js');
    vi.mocked(readAmpliConfig).mockReturnValue({
      ok: false,
      error: 'not_found',
    });
    vi.mocked(getStoredUser).mockReturnValue({
      id: 'pending',
      email: '',
      firstName: '',
      lastName: '',
      zone: 'eu',
    });

    const session = buildSession({});
    expect(resolveZone(session, 'us')).toBe('eu');
  });

  it('honors the caller-supplied fallback (not hardcoded to us)', async () => {
    const { readAmpliConfig } = await import('../ampli-config.js');
    const { getStoredUser } = await import('../../utils/ampli-settings.js');
    vi.mocked(readAmpliConfig).mockReturnValue({
      ok: false,
      error: 'not_found',
    });
    vi.mocked(getStoredUser).mockReturnValue(undefined);

    const session = buildSession({});
    expect(resolveZone(session, 'eu')).toBe('eu');
  });
});

describe('tryResolveZone', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns null when no zone signal is present', async () => {
    const { readAmpliConfig } = await import('../ampli-config.js');
    const { getStoredUser } = await import('../../utils/ampli-settings.js');
    vi.mocked(readAmpliConfig).mockReturnValue({
      ok: false,
      error: 'not_found',
    });
    vi.mocked(getStoredUser).mockReturnValue(undefined);

    const session = buildSession({});
    expect(tryResolveZone(session)).toBeNull();
  });

  it('returns session.region when --region pre-populates it', async () => {
    const { readAmpliConfig } = await import('../ampli-config.js');
    const { getStoredUser } = await import('../../utils/ampli-settings.js');
    vi.mocked(readAmpliConfig).mockReturnValue({
      ok: false,
      error: 'not_found',
    });
    vi.mocked(getStoredUser).mockReturnValue(undefined);

    const session = buildSession({ region: 'eu' });
    expect(tryResolveZone(session)).toBe('eu');
  });

  it('returns ampli.json Zone when set and no explicit flag', async () => {
    const { readAmpliConfig } = await import('../ampli-config.js');
    vi.mocked(readAmpliConfig).mockReturnValue({
      ok: true,
      config: { Zone: 'eu' },
    });

    const session = buildSession({});
    expect(tryResolveZone(session)).toBe('eu');
  });
});

describe('buildSession with --region flag', () => {
  it('pre-populates session.region from the region arg', () => {
    const session = buildSession({ region: 'eu' });
    expect(session.region).toBe('eu');
  });

  it('leaves session.region null when region is omitted', () => {
    const session = buildSession({});
    expect(session.region).toBeNull();
  });
});
