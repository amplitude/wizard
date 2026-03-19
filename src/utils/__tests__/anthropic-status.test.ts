import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkAnthropicStatus } from '../anthropic-status.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function mockFetch(indicator: string, description = 'All good', ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      // eslint-disable-next-line @typescript-eslint/require-await
      json: async () => ({
        page: {
          id: 'p',
          name: 'Claude',
          url: 'https://status.claude.com',
          time_zone: 'UTC',
          updated_at: '',
        },
        status: { indicator, description },
      }),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── checkAnthropicStatus ──────────────────────────────────────────────────────

describe('checkAnthropicStatus', () => {
  it('returns operational for indicator "none"', async () => {
    mockFetch('none');
    const result = await checkAnthropicStatus();
    expect(result).toEqual({ status: 'operational' });
  });

  it('returns degraded for indicator "minor"', async () => {
    mockFetch('minor', 'Partial service disruption');
    const result = await checkAnthropicStatus();
    expect(result.status).toBe('degraded');
    if (result.status === 'degraded') {
      expect(result.description).toBe('Partial service disruption');
    }
  });

  it('capitalises the first letter and lowercases the rest of the description', async () => {
    mockFetch('minor', 'PARTIAL SERVICE DISRUPTION');
    const result = await checkAnthropicStatus();
    if (result.status === 'degraded') {
      expect(result.description).toBe('Partial service disruption');
    }
  });

  it('returns down for indicator "major"', async () => {
    mockFetch('major', 'Major outage');
    const result = await checkAnthropicStatus();
    expect(result.status).toBe('down');
  });

  it('returns down for indicator "critical"', async () => {
    mockFetch('critical', 'Critical failure');
    const result = await checkAnthropicStatus();
    expect(result.status).toBe('down');
  });

  it('returns unknown for an unrecognised indicator', async () => {
    mockFetch('mystery' as string);
    const result = await checkAnthropicStatus();
    expect(result.status).toBe('unknown');
    if (result.status === 'unknown') {
      expect(result.error).toContain('Unknown indicator');
    }
  });

  it('returns unknown when the response status is not ok', async () => {
    mockFetch('none', '', false);
    const result = await checkAnthropicStatus();
    expect(result.status).toBe('unknown');
    if (result.status === 'unknown') {
      expect(result.error).toContain('500');
    }
  });

  it('returns unknown with "timed out" message on AbortError', async () => {
    const abortError = new DOMException(
      'The operation was aborted.',
      'AbortError',
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));
    const result = await checkAnthropicStatus();
    expect(result.status).toBe('unknown');
    if (result.status === 'unknown') {
      expect(result.error).toBe('Request timed out');
    }
  });

  it('returns unknown with error message for other errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network failure')),
    );
    const result = await checkAnthropicStatus();
    expect(result.status).toBe('unknown');
    if (result.status === 'unknown') {
      expect(result.error).toBe('network failure');
    }
  });

  it('returns unknown with "Unknown error" for non-Error throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('string error'));
    const result = await checkAnthropicStatus();
    expect(result.status).toBe('unknown');
    if (result.status === 'unknown') {
      expect(result.error).toBe('Unknown error');
    }
  });
});
