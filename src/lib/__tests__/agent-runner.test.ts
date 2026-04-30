/**
 * agent-runner — unit coverage for pure helpers exposed from
 * `src/lib/agent-runner.ts`.
 *
 * `runAgentWizard` itself is heavily integrated (auto-detection, OAuth,
 * env-var upload, MCP server install, …) and isn't unit-testable without
 * standing up the full wizard runtime. Pure functions extracted from it
 * — like {@link classifyApiErrorSubtype} — get focused coverage here so
 * we can lock down the contract that downstream consumers (Sentry tags,
 * user-facing copy) depend on.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { vi } from 'vitest';
import {
  agentArtifactsLookComplete,
  agentEventsInstrumented,
  classifyAgentOutcome,
  classifyApiErrorSubtype,
  refreshTokenIfStale,
} from '../agent-runner.js';
import { AgentErrorType } from '../agent-interface.js';
import { buildSession } from '../wizard-session.js';

// Mock the analytics module up here (shared across describe blocks below)
// so refreshTokenIfStale's `analytics.wizardCapture` call doesn't try to
// hit a real backend when a test triggers the refresh path.
vi.mock('../../utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
    setSessionProperty: vi.fn(),
    getAllFlagsForWizard: vi.fn().mockResolvedValue({}),
  },
  captureWizardError: vi.fn(),
}));

vi.mock('../../utils/ampli-settings', () => ({
  getStoredUser: vi.fn(),
  getStoredToken: vi.fn(),
  storeToken: vi.fn(),
}));

vi.mock('../../utils/oauth', () => ({
  refreshAccessToken: vi.fn(),
}));

describe('classifyApiErrorSubtype', () => {
  // Each subtype tag maps to a distinct user-facing message and
  // (post-deploy) a distinct Sentry alert / dashboard. Bad classification
  // would either show the user the wrong copy or hide a meaningful
  // failure mode in the noise. Lock down the rules.

  describe('stream_closed', () => {
    // Issue #297 / PR #298: this is the bridge-race signal. We expect
    // the inner retry loop's defense in depth to catch most of these
    // before they bubble to runAgentWizard, so seeing this surface here
    // tells us the drain isn't fully effective.

    it('classifies "Tool permission request failed: Error: Stream closed" as stream_closed', () => {
      expect(
        classifyApiErrorSubtype({
          errorType: AgentErrorType.API_ERROR,
          message: 'Tool permission request failed: Error: Stream closed',
        }),
      ).toBe('stream_closed');
    });

    it('matches case-insensitively', () => {
      expect(
        classifyApiErrorSubtype({
          errorType: AgentErrorType.API_ERROR,
          message: 'STREAM CLOSED',
        }),
      ).toBe('stream_closed');
    });

    it('matches across whitespace variants', () => {
      expect(
        classifyApiErrorSubtype({
          errorType: AgentErrorType.API_ERROR,
          message: 'pipe error: stream\tclosed',
        }),
      ).toBe('stream_closed');
    });

    it('takes precedence over rate_limit when both signals are present', () => {
      // If a Stream closed error happens to surface alongside a 429
      // signal, the bridge race is the more specific (and more
      // actionable) classification. This isn't expected in production
      // but the ordering is documented.
      expect(
        classifyApiErrorSubtype({
          errorType: AgentErrorType.RATE_LIMIT,
          message: 'API Error: 429 — and Stream closed',
        }),
      ).toBe('stream_closed');
    });
  });

  describe('terminated_400', () => {
    it('classifies "API Error: 400 terminated" as terminated_400', () => {
      expect(
        classifyApiErrorSubtype({
          errorType: AgentErrorType.API_ERROR,
          message: 'API Error: 400 terminated',
        }),
      ).toBe('terminated_400');
    });

    it('matches case-insensitively', () => {
      expect(
        classifyApiErrorSubtype({
          errorType: AgentErrorType.API_ERROR,
          message: 'API ERROR: 400 TERMINATED',
        }),
      ).toBe('terminated_400');
    });

    it('does NOT match a plain 400 without "terminated"', () => {
      // We only want to claim the upstream-bridge-drop framing for the
      // specific synthetic-400 signature. A vanilla 400 is "other".
      expect(
        classifyApiErrorSubtype({
          errorType: AgentErrorType.API_ERROR,
          message: 'API Error: 400 Bad Request',
        }),
      ).toBe('other');
    });
  });

  describe('rate_limit', () => {
    it('classifies RATE_LIMIT errorType as rate_limit when no more specific signal present', () => {
      expect(
        classifyApiErrorSubtype({
          errorType: AgentErrorType.RATE_LIMIT,
          message: 'API Error: 429',
        }),
      ).toBe('rate_limit');
    });

    it('does NOT classify API_ERROR with "429" message as rate_limit (errorType drives it)', () => {
      // RATE_LIMIT is a distinct AgentErrorType — only that errorType
      // should yield the rate_limit subtype, not a substring match on
      // the message. Otherwise we'd misclassify cases where the agent
      // passes through a 429 in passing without the runner having
      // committed to the RATE_LIMIT classification.
      expect(
        classifyApiErrorSubtype({
          errorType: AgentErrorType.API_ERROR,
          message: 'API Error: 429',
        }),
      ).toBe('other');
    });
  });

  describe('other', () => {
    it('returns "other" for unclassified API errors', () => {
      expect(
        classifyApiErrorSubtype({
          errorType: AgentErrorType.API_ERROR,
          message: 'API Error: 500 Internal Server Error',
        }),
      ).toBe('other');
    });

    it('returns "other" when message is empty', () => {
      expect(
        classifyApiErrorSubtype({
          errorType: AgentErrorType.API_ERROR,
          message: '',
        }),
      ).toBe('other');
    });
  });
});

describe('agentArtifactsLookComplete', () => {
  it('returns true when checklistDashboardUrl is set', () => {
    const session = buildSession({ installDir: '/tmp/x' });
    session.checklistDashboardUrl =
      'https://app.amplitude.com/analytics/d/abc123';
    expect(agentArtifactsLookComplete(session)).toBe(true);
  });

  it('returns false when checklistDashboardUrl is null', () => {
    const session = buildSession({ installDir: '/tmp/x' });
    session.checklistDashboardUrl = null;
    expect(agentArtifactsLookComplete(session)).toBe(false);
  });

  it('returns false when checklistDashboardUrl is an empty string', () => {
    const session = buildSession({ installDir: '/tmp/x' });
    // Empty string also indicates "no real dashboard URL captured" —
    // the agent stores the URL returned from the MCP create call, and
    // an empty string is a defensive fallback we should not treat as
    // success. (Boolean('') === false handles this naturally.)
    session.checklistDashboardUrl = '';
    expect(agentArtifactsLookComplete(session)).toBe(false);
  });
});

describe('agentEventsInstrumented', () => {
  // The signal here is "the agent persisted an event plan to
  // .amplitude-events.json with non-empty content." That's the
  // marker for "agent reached the post-confirm phase" — distinct
  // from agentArtifactsLookComplete, which requires the dashboard
  // URL too. The MCP_MISSING soft-error path uses this helper to
  // detect "instrumentation done, dashboard step failed" — the
  // exact shape of the bug Cassie hit.

  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runner-'));
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('returns true when .amplitude-events.json exists with events', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.amplitude-events.json'),
      JSON.stringify([{ name: 'User Signed Up', description: 'after signup' }]),
    );
    const session = buildSession({ installDir: tmpDir });
    expect(agentEventsInstrumented(session)).toBe(true);
  });

  it('returns false when the events file is missing', () => {
    const session = buildSession({ installDir: tmpDir });
    expect(agentEventsInstrumented(session)).toBe(false);
  });

  it('returns false when the events file is an empty array', () => {
    // Empty array means "no plan was persisted" — confirm_event_plan
    // requires min(1) so this is a defensive case (manually-truncated
    // file, partial write, etc.). Treat as "didn't finish" since the
    // user has no instrumented events.
    fs.writeFileSync(path.join(tmpDir, '.amplitude-events.json'), '[]');
    const session = buildSession({ installDir: tmpDir });
    expect(agentEventsInstrumented(session)).toBe(false);
  });

  it('returns false when the events file is malformed JSON', () => {
    // Defensive: a corrupted file shouldn't cause a soft-error
    // misclassification. We'd rather hard-abort the run than show a
    // false-positive "everything succeeded" outro on top of a broken
    // event plan.
    fs.writeFileSync(
      path.join(tmpDir, '.amplitude-events.json'),
      '{ this is not json',
    );
    const session = buildSession({ installDir: tmpDir });
    expect(agentEventsInstrumented(session)).toBe(false);
  });

  it('returns false when the events file is not an array', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.amplitude-events.json'),
      JSON.stringify({ accidentally: 'an object' }),
    );
    const session = buildSession({ installDir: tmpDir });
    expect(agentEventsInstrumented(session)).toBe(false);
  });

  it('handles installDir that does not exist gracefully', () => {
    const session = buildSession({
      installDir: '/dev/null/does-not-exist',
    });
    expect(agentEventsInstrumented(session)).toBe(false);
  });
});

// ── classifyAgentOutcome ─────────────────────────────────────────────
//
// Single decision point used by both the MCP_MISSING / RESOURCE_MISSING
// branch and the API_ERROR / RATE_LIMIT branch in `runAgentWizardBody`.
// Pre-PR these were inlined separately; the API branch only checked
// dashboard URL while the MCP branch checked dashboard OR events. A
// rate limit during dashboard creation hard-aborted even when events
// had been instrumented. Lock down the unified rule.

describe('classifyAgentOutcome', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classify-outcome-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns soft when dashboard URL is set', () => {
    const session = buildSession({ installDir: tmpDir });
    session.checklistDashboardUrl = 'https://app.amplitude.com/x/y';
    const result = classifyAgentOutcome(session);
    expect(result.severity).toBe('soft');
    expect(result.dashboardComplete).toBe(true);
  });

  it('returns soft when events file is present even without dashboard URL', () => {
    fs.mkdirSync(path.join(tmpDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.amplitude', 'events.json'),
      JSON.stringify([{ name: 'X', description: 'Y' }]),
    );
    const session = buildSession({ installDir: tmpDir });
    const result = classifyAgentOutcome(session);
    expect(result.severity).toBe('soft');
    expect(result.eventsInstrumented).toBe(true);
    expect(result.dashboardComplete).toBe(false);
  });

  it('returns hard when neither dashboard nor events are present', () => {
    const session = buildSession({ installDir: tmpDir });
    const result = classifyAgentOutcome(session);
    expect(result.severity).toBe('hard');
    expect(result.dashboardComplete).toBe(false);
    expect(result.eventsInstrumented).toBe(false);
  });
});

// ── refreshTokenIfStale ──────────────────────────────────────────────
//
// The post-run-token-staleness regression guard.
//
// User-visible failure mode pre-fix: a 14-minute Excalidraw run finishes
// the agent loop with a fully-instrumented project, then the post-run
// path hits "Authentication failed while trying to fetch Amplitude user
// data" on `commitPlannedEventsStep`, `createDashboardStep`, and
// `pollForDataIngestion`. The OAuth token was already past its 1-hour
// expiry by the time those steps fired. This test locks down the
// "refresh-near-expiry, even within the 5-minute pre-buffer" behaviour.

describe('refreshTokenIfStale', () => {
  let mockGetStoredUser: ReturnType<typeof vi.fn>;
  let mockGetStoredToken: ReturnType<typeof vi.fn>;
  let mockStoreToken: ReturnType<typeof vi.fn>;
  let mockRefreshAccessToken: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const ampli = await import('../../utils/ampli-settings');
    const oauth = await import('../../utils/oauth');
    mockGetStoredUser = vi.mocked(ampli.getStoredUser);
    mockGetStoredToken = vi.mocked(ampli.getStoredToken);
    mockStoreToken = vi.mocked(ampli.storeToken);
    mockRefreshAccessToken = vi.mocked(oauth.refreshAccessToken);

    mockGetStoredUser.mockReset();
    mockGetStoredToken.mockReset();
    mockStoreToken.mockReset();
    mockRefreshAccessToken.mockReset();
  });

  it('returns the fallback when no stored user / token is found', async () => {
    mockGetStoredUser.mockReturnValue(undefined);
    mockGetStoredToken.mockReturnValue(undefined);
    expect(await refreshTokenIfStale('fallback-tok', 'test')).toBe(
      'fallback-tok',
    );
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it('returns the stored access token unchanged when expiry is far in the future', async () => {
    mockGetStoredUser.mockReturnValue({ id: 'u1', zone: 'us' });
    mockGetStoredToken.mockReturnValue({
      accessToken: 'fresh-token',
      idToken: 'id',
      refreshToken: 'rt',
      // 1 hour out — well past the 5-minute pre-expiry buffer.
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(await refreshTokenIfStale('fallback', 'test')).toBe('fresh-token');
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  // The exact regression: token is "still valid" by a strict expiry check
  // (>now), but within the 5-minute buffer the post-run path needs the
  // refresh anyway because the agent run will push it past expiry before
  // the downstream MCP / data-API call lands.
  it('refreshes a token whose expiry is within the 5-minute pre-expiry buffer', async () => {
    mockGetStoredUser.mockReturnValue({ id: 'u1', zone: 'us' });
    mockGetStoredToken.mockReturnValue({
      accessToken: 'about-to-expire',
      idToken: 'id',
      refreshToken: 'rt',
      // 2 minutes from now — within the 5-minute buffer.
      expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    });
    mockRefreshAccessToken.mockResolvedValue({
      accessToken: 'newly-refreshed',
      idToken: 'new-id',
      refreshToken: 'new-rt',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(await refreshTokenIfStale('fallback', 'post-run')).toBe(
      'newly-refreshed',
    );
    expect(mockStoreToken).toHaveBeenCalledOnce();
  });

  it('passes the user zone to refreshAccessToken (EU regression)', async () => {
    // PR #348 fixed the in-run path's missing zone arg. The post-run
    // helper needs the same treatment so EU users' refresh tokens get
    // posted to auth.eu.amplitude.com instead of auth.amplitude.com.
    mockGetStoredUser.mockReturnValue({ id: 'u1', zone: 'eu' });
    mockGetStoredToken.mockReturnValue({
      accessToken: 'eu-token',
      idToken: 'id',
      refreshToken: 'eu-rt',
      // Already expired.
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    mockRefreshAccessToken.mockResolvedValue({
      accessToken: 'eu-refreshed',
      idToken: 'new-id',
      refreshToken: 'new-eu-rt',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    await refreshTokenIfStale('fallback', 'post-run');
    expect(mockRefreshAccessToken).toHaveBeenCalledWith('eu-rt', 'eu');
  });

  it('returns the stored access token (not the fallback) when refresh throws', async () => {
    // If the refresh itself fails (network blip, revoked refresh token),
    // we still want to hand BACK whatever stored access token we found —
    // it might be live for another minute or two. Returning the
    // module-level fallback would discard that value.
    mockGetStoredUser.mockReturnValue({ id: 'u1', zone: 'us' });
    mockGetStoredToken.mockReturnValue({
      accessToken: 'stored',
      idToken: 'id',
      refreshToken: 'rt',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    mockRefreshAccessToken.mockRejectedValue(new Error('network'));
    expect(await refreshTokenIfStale('fallback', 'post-run')).toBe('stored');
  });
});
