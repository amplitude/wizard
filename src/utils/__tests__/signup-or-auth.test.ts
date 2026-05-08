import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  performSignupOrAuth,
  AGENTIC_SIGNUP_ATTEMPTED_EVENT,
} from '../signup-or-auth';

vi.mock('../direct-signup.js', () => ({
  performDirectSignup: vi.fn(),
}));
vi.mock('../ampli-settings.js', () => ({
  replaceStoredUser: vi.fn(),
}));
vi.mock('../../lib/api.js', () => ({
  fetchAmplitudeUser: vi.fn(),
}));
vi.mock('../analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
  },
}));

// Minimal provisioned-account shape: one org / workspace / env with an
// apiKey. Having this is the signal that backend provisioning finished,
// so fetchUserWithProvisioningRetry returns on the first call (no delays).
const provisionedOrgs = [
  {
    id: 'org-1',
    name: 'Org',
    projects: [
      {
        id: 'ws-1',
        name: 'Default',
        environments: [
          { name: 'Production', rank: 0, app: { id: 'p1', apiKey: 'key-1' } },
        ],
      },
    ],
  },
];

describe('performSignupOrAuth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when email is missing', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    const { analytics } = await import('../analytics');

    const result = await performSignupOrAuth({
      email: null,
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
    expect(result.kind).toBe('error');
    expect(analytics.wizardCapture).not.toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      expect.anything(),
    );
  });

  it('probes with email-only when fullName is missing (server decides)', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'needs_information',
      requiredFields: ['full_name'],
    });

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: null,
      zone: 'us',
    });

    // The wrapper now POSTs even without fullName, letting the server route
    // brand-new emails to needs_information so the TUI can collect the field.
    expect(performDirectSignup).toHaveBeenCalledOnce();
    expect(performDirectSignup).toHaveBeenCalledWith(
      expect.not.objectContaining({ fullName: expect.anything() }),
    );
    expect(result.kind).toBe('needs_information');
    if (result.kind === 'needs_information') {
      expect(result.requiredFields).toEqual(['full_name']);
    }
  });

  // ── needs_information_unsupported telemetry mapping ───────────────────
  //
  // Schema-layer rejection of unsupported `required` shapes (anything
  // other than exactly `['full_name']`) lives in
  // `direct-signup.ts:NeedsInformationSchema.refine()` and is tested
  // there with real MSW responses. The wrapper's job is just to map the
  // resulting `code: 'unsupported_required_shape'` error to the distinct
  // `needs_information_unsupported` telemetry status, separate from the
  // generic `signup_error`.

  it('maps code "unsupported_required_shape" → needs_information_unsupported telemetry', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'error',
      code: 'unsupported_required_shape',
      message: 'unsupported',
    });
    const { analytics } = await import('../analytics');

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: null,
      zone: 'us',
    });

    expect(result.kind).toBe('error');
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      {
        status: 'needs_information_unsupported',
        zone: 'us',
        'legal document source': 'unused',
      },
    );
  });

  it('errors without the special code map to plain signup_error telemetry', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'error',
      code: 'invalid_parameters',
      message: 'bad email',
    });
    const { analytics } = await import('../analytics');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: null,
      zone: 'us',
    });

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      {
        status: 'signup_error',
        zone: 'us',
        'legal document source': 'unused',
      },
    );
  });

  it('returns redirect when direct signup returns requires_redirect', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'requires_redirect',
    });

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performDirectSignup).toHaveBeenCalledOnce();
    expect(result.kind).toBe('redirect');
  });

  it('emits agentic signup attempted with status=requires_redirect on redirect path', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'requires_redirect',
    });
    const { analytics } = await import('../analytics');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      {
        status: 'requires_redirect',
        zone: 'us',
        'legal document source': 'unused',
      },
    );
  });

  it('returns error when direct signup returns error', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'error',
      message: 'boom',
    });

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('boom');
    }
  });

  it('emits agentic signup attempted with status=signup_error on error kind', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'error',
      message: 'boom',
    });
    const { analytics } = await import('../analytics');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      {
        status: 'signup_error',
        zone: 'us',
        'legal document source': 'unused',
      },
    );
  });

  it('emits agentic signup attempted with status=wrapper_exception when performDirectSignup throws', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockRejectedValue(new Error('network'));
    const { analytics } = await import('../analytics');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    // Distinguishing wrapper_exception (an unexpected throw) from
    // signup_error (an `error`-arm response) lets us tell network/transport
    // failures apart from the server's clean error path in telemetry.
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      {
        status: 'wrapper_exception',
        zone: 'us',
        'legal document source': 'unused',
      },
    );
  });

  it('returns tokens on success without calling OAuth', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'success',
      tokens: {
        accessToken: 'direct-access',
        idToken: 'direct-id',
        refreshToken: 'direct-refresh',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        zone: 'us',
      },
    });
    const { fetchAmplitudeUser } = await import('../../lib/api.js');
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      id: 'user-123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      orgs: provisionedOrgs,
    });
    const { replaceStoredUser } = await import('../ampli-settings.js');

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(result).toMatchObject({
      kind: 'success',
      accessToken: 'direct-access',
      dashboardUrl: null,
    });
    expect(replaceStoredUser).toHaveBeenCalledOnce();
  });

  it('forwards dashboardUrl from performDirectSignup on success', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    const magic = 'https://app.amplitude.com/magic?x=1';
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'success',
      tokens: {
        accessToken: 'a',
        idToken: 'i',
        refreshToken: 'r',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        zone: 'us',
      },
      dashboardUrl: magic,
    });
    const { fetchAmplitudeUser } = await import('../../lib/api.js');
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      id: 'user-123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      orgs: provisionedOrgs,
    });

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(result).toMatchObject({ dashboardUrl: magic });
  });

  it('emits agentic signup attempted with status=success on the success path', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'success',
      tokens: {
        accessToken: 'a',
        idToken: 'i',
        refreshToken: 'r',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        zone: 'us',
      },
    });
    const { fetchAmplitudeUser } = await import('../../lib/api.js');
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      id: 'user-123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      orgs: provisionedOrgs,
    });
    const { analytics } = await import('../analytics');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      {
        status: 'success',
        zone: 'us',
        'has env with api key': true,
        'user fetch retry count': 0,
        'legal document source': 'unused',
      },
    );
  });

  it('persists StoredUser with real user id from fetchAmplitudeUser', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'success',
      tokens: {
        accessToken: 'a',
        idToken: 'i',
        refreshToken: 'r',
        expiresAt: new Date().toISOString(),
        zone: 'us',
      },
    });
    const { fetchAmplitudeUser } = await import('../../lib/api.js');
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      id: 'user-123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      orgs: provisionedOrgs,
    });
    const { replaceStoredUser } = await import('../ampli-settings.js');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(replaceStoredUser).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'user-123',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        zone: 'us',
      }),
      expect.anything(),
    );
  });

  it('normalizes extra whitespace in fullName before splitting', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'success',
      tokens: {
        accessToken: 'a',
        idToken: 'i',
        refreshToken: 'r',
        expiresAt: new Date().toISOString(),
        zone: 'us',
      },
    });
    const { fetchAmplitudeUser } = await import('../../lib/api.js');
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      id: 'user-123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      orgs: provisionedOrgs,
    });
    const { replaceStoredUser } = await import('../ampli-settings.js');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: '  Ada   Lovelace  ',
      zone: 'us',
    });

    expect(replaceStoredUser).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'user-123',
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
      expect.anything(),
    );
  });

  it('falls back to pending sentinel when fetchAmplitudeUser fails after direct-signup success', async () => {
    vi.useFakeTimers();
    try {
      const { performDirectSignup } = await import('../direct-signup.js');
      vi.mocked(performDirectSignup).mockResolvedValue({
        kind: 'success',
        tokens: {
          accessToken: 'direct-access',
          idToken: 'direct-id',
          refreshToken: 'direct-refresh',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          zone: 'us',
        },
      });
      const { fetchAmplitudeUser } = await import('../../lib/api.js');
      vi.mocked(fetchAmplitudeUser).mockRejectedValue(new Error('network'));
      const { replaceStoredUser } = await import('../ampli-settings.js');

      const pending = performSignupOrAuth({
        email: 'ada@example.com',
        fullName: 'Ada Lovelace',
        zone: 'us',
      });
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(replaceStoredUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pending' }),
        expect.anything(),
      );
      expect(result).toMatchObject({ accessToken: 'direct-access' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits agentic signup attempted with status=user_fetch_failed when fetch retries exhaust', async () => {
    vi.useFakeTimers();
    try {
      const { performDirectSignup } = await import('../direct-signup.js');
      vi.mocked(performDirectSignup).mockResolvedValue({
        kind: 'success',
        tokens: {
          accessToken: 'a',
          idToken: 'i',
          refreshToken: 'r',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          zone: 'us',
        },
      });
      const { fetchAmplitudeUser } = await import('../../lib/api.js');
      vi.mocked(fetchAmplitudeUser).mockRejectedValue(new Error('network'));
      const { analytics } = await import('../analytics');

      const pending = performSignupOrAuth({
        email: 'ada@example.com',
        fullName: 'Ada Lovelace',
        zone: 'us',
      });
      await vi.runAllTimersAsync();
      await pending;

      expect(analytics.wizardCapture).toHaveBeenCalledWith(
        AGENTIC_SIGNUP_ATTEMPTED_EVENT,
        {
          status: 'user_fetch_failed',
          zone: 'us',
          'user fetch retry count': 3,
          'legal document source': 'unused',
        },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not emit signup_error telemetry when direct signup reports caller abort', async () => {
    // User-initiated cancels (Esc, /exit, screen unmount) surface as
    // `code: 'aborted'` from performDirectSignup. The wrapper must
    // pass them through as a clean error arm but skip the
    // signup_error telemetry — aborts aren't funnel failures and
    // would otherwise inflate the signup_error counter.
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'error',
      code: 'aborted',
      message: 'aborted',
    });
    const { analytics } = await import('../analytics');

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(result).toEqual({ kind: 'error', message: 'aborted' });
    expect(analytics.wizardCapture).not.toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      { status: 'signup_error', zone: 'us' },
    );
  });

  it('retries fetchAmplitudeUser when the new account has no env with an API key yet', async () => {
    vi.useFakeTimers();
    try {
      const { performDirectSignup } = await import('../direct-signup.js');
      vi.mocked(performDirectSignup).mockResolvedValue({
        kind: 'success',
        tokens: {
          accessToken: 'a',
          idToken: 'i',
          refreshToken: 'r',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          zone: 'us',
        },
      });
      const { fetchAmplitudeUser } = await import('../../lib/api.js');
      vi.mocked(fetchAmplitudeUser)
        .mockResolvedValueOnce({
          id: 'u',
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.com',
          orgs: [],
        })
        .mockResolvedValueOnce({
          id: 'u',
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.com',
          orgs: [
            {
              id: 'org-1',
              name: 'Org',
              projects: [{ id: 'ws-1', name: 'Default', environments: [] }],
            },
          ],
        })
        .mockResolvedValueOnce({
          id: 'u',
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.com',
          orgs: provisionedOrgs,
        });

      const pending = performSignupOrAuth({
        email: 'a@b.com',
        fullName: 'A B',
        zone: 'us',
      });
      await vi.runAllTimersAsync();
      await pending;

      expect(fetchAmplitudeUser).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Abort-signal contract ────────────────────────────────────────────
  //
  // The wrapper threads `signal` through to axios (in `direct-signup`)
  // AND gates `replaceStoredUser` behind a final `signal.aborted` check.
  // Without that gate, a cancelled ceremony leaks tokens to disk: user
  // navigates away mid-POST → in-flight wrapper still completes the
  // success arm → tokens persist → next launch sees the user as signed
  // in even though they explicitly backed out. This is exactly the
  // "POST-after-unmount disk write" failure the reviewer flagged on
  // PR #539.

  it('aborting the signal pre-call returns error without persisting tokens', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    // Even with success arm mocked, the pre-replaceStoredUser guard
    // catches the abort and bails before persistence.
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'success',
      tokens: {
        accessToken: 'a',
        idToken: 'i',
        refreshToken: 'r',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        zone: 'us',
      },
      dashboardUrl: null,
    });
    const { fetchAmplitudeUser } = await import('../../lib/api.js');
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      id: 'user-123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      orgs: provisionedOrgs,
    });
    const { replaceStoredUser } = await import('../ampli-settings.js');

    const controller = new AbortController();
    controller.abort();

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
      signal: controller.signal,
    });

    // Wrapper returned the abort sentinel and skipped persistence.
    expect(result.kind).toBe('error');
    expect(replaceStoredUser).not.toHaveBeenCalled();
  });

  it('threads signal through to performDirectSignup', async () => {
    // Pin the wire-level contract: whatever signal we pass to the
    // wrapper must reach the underlying axios calls. Without this,
    // the screen's useAsyncEffect AbortController couldn't actually
    // cancel in-flight requests on unmount.
    const { performDirectSignup } = await import('../direct-signup.js');
    // direct-signup returns `requires_redirect` (wire vocabulary); the
    // wrapper maps it to `redirect`. Mocking the inner kind here lets
    // us short-circuit the wrapper before it reaches the success-arm
    // tokens path while still exercising the signal pass-through.
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'requires_redirect',
    });

    const controller = new AbortController();

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
      signal: controller.signal,
    });

    expect(performDirectSignup).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
