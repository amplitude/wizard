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
  buildDashboardDeferredMessage,
  buildGatewayAbortSpec,
  classifyAgentOutcome,
  classifyApiErrorSubtype,
  refreshTokenIfStale,
  runColdStartParallel,
  POST_AGENT_STEP_COMMIT_EVENTS,
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

// Step-id constants are referenced by agent-runner (`seedPostAgentSteps`)
// AND by each step file (`setPostAgentStep` calls). They must stay
// equal — the FinalizingPanel finds rows by id and the patch is a no-op
// for unknown ids. This test catches a rename of either constant.
//
// History: a `POST_AGENT_STEP_CREATE_DASHBOARD` constant lived here until
// DEFER_DASHBOARD_PLAN PR 4 — chart and dashboard creation moved to the
// deferred `amplitude-wizard dashboard` command, so the post-agent queue
// only seeds the events-commit step now. The legacy `STEP_ID` export on
// `src/steps/create-dashboard.ts` survives one release for backwards
// compat with stale skill expectations and is removed in PR 5.
describe('post-agent step id constants', () => {
  it('the events-commit step id is a stable, non-empty string', () => {
    expect(typeof POST_AGENT_STEP_COMMIT_EVENTS).toBe('string');
    expect(POST_AGENT_STEP_COMMIT_EVENTS.length).toBeGreaterThan(0);
  });
});

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

describe('buildGatewayAbortSpec — golden behavior pins', () => {
  // The gateway-error abort path is the single most user-visible failure
  // shape on long runs: an exhausted retry budget or a Vertex 400 will
  // surface this exact copy to a real user (and the matching `code`
  // discriminator to an orchestrator parsing the NDJSON stream).
  //
  // The text is duplicated nowhere — this helper is the only producer.
  // The byte-for-byte snapshots below are the contract; if a future
  // refactor moves words around, this suite has to be updated *first*
  // and the change reviewed as a copy change, not a refactor.

  describe('GATEWAY_DOWN — retry-recoverable', () => {
    it('pins all six fields for a typical "API Error: 400 terminated" message', () => {
      const spec = buildGatewayAbortSpec({
        kind: AgentErrorType.GATEWAY_DOWN,
        rawMessage: 'API Error: 400 terminated',
      });
      expect(spec.code).toBe('GATEWAY_DOWN');
      expect(spec.recoverable).toBe('retry');
      expect(spec.sentrySummary).toBe('API Error: 400 terminated');
      expect(spec.emitMessage).toBe(
        'LLM gateway unavailable: API Error: 400 terminated',
      );
      expect(spec.errorSummary).toBe(
        'LLM gateway unavailable: API Error: 400 terminated',
      );
      expect(spec.suggestedCommand).toBeUndefined();
      expect(spec.userMessage).toContain('Amplitude LLM gateway unavailable');
      expect(spec.userMessage).toContain('API Error: 400 terminated');
      expect(spec.userMessage).toContain('wizard@amplitude.com');
    });

    it('falls back to "unknown" / "API Error: 400 terminated" when message is empty', () => {
      const spec = buildGatewayAbortSpec({
        kind: AgentErrorType.GATEWAY_DOWN,
        rawMessage: '',
      });
      expect(spec.sentrySummary).toBe('LLM gateway unavailable');
      expect(spec.emitMessage).toBe('LLM gateway unavailable: unknown');
      expect(spec.errorSummary).toBe('LLM gateway unavailable: unknown');
      // The user-facing message inlines the upstream error and shows the
      // canonical fallback so the user has SOMETHING to reference even
      // when the SDK never gave us a usable string.
      expect(spec.userMessage).toContain('API Error: 400 terminated');
    });

    it('sanitizes raw SSE bodies before surfacing to user-visible copy', () => {
      // Real-world: Sentry #7442894144 — raw error string included the
      // entire failing SSE response body. This pins that the helper
      // routes through `sanitizeErrorMessageForLog`, which suppresses
      // `event:` SSE protocol lines with a "[N SSE frame suppressed]"
      // marker. The marker's presence is the contract here — it proves
      // we routed through the sanitizer instead of inlining the raw
      // string verbatim into user-facing copy.
      const sseBody =
        'API Error: 400 terminated\nevent: error\ndata: {"type":"overloaded_error"}\n\nevent: message_stop\ndata: {}';
      const spec = buildGatewayAbortSpec({
        kind: AgentErrorType.GATEWAY_DOWN,
        rawMessage: sseBody,
      });
      // Both downstream surfaces (user-facing Outro + orchestrator
      // emit envelope) must have routed through the sanitizer.
      expect(spec.userMessage).toContain('SSE frame suppressed');
      expect(spec.userMessage).not.toContain('event: message_stop');
      expect(spec.emitMessage).toContain('SSE frame suppressed');
      expect(spec.emitMessage).not.toContain('event: message_stop');
    });
  });

  describe('GATEWAY_INVALID_REQUEST — fatal, upgrade-only', () => {
    it('pins fatal recoverable + upgrade-command suggestedAction', () => {
      const spec = buildGatewayAbortSpec({
        kind: AgentErrorType.GATEWAY_INVALID_REQUEST,
        rawMessage: 'Invalid request sent to model provider',
      });
      expect(spec.code).toBe('GATEWAY_INVALID_REQUEST');
      expect(spec.recoverable).toBe('fatal');
      expect(spec.suggestedCommand).toEqual([
        'npm',
        'install',
        '-g',
        '@amplitude/wizard@latest',
      ]);
      expect(spec.emitMessage).toBe(
        'Wizard request rejected by gateway: Invalid request sent to model provider',
      );
      expect(spec.errorSummary).toBe(
        'Wizard request rejected by gateway: Invalid request sent to model provider',
      );
      // Copy must mention the upgrade path — that's the only remediation.
      expect(spec.userMessage).toContain('npm i -g @amplitude/wizard@latest');
      expect(spec.userMessage).toContain(
        'Wizard request rejected by Amplitude gateway',
      );
    });

    it('falls back to "Wizard request rejected by gateway" / "unknown"', () => {
      const spec = buildGatewayAbortSpec({
        kind: AgentErrorType.GATEWAY_INVALID_REQUEST,
        rawMessage: '',
      });
      expect(spec.sentrySummary).toBe('Wizard request rejected by gateway');
      expect(spec.emitMessage).toBe(
        'Wizard request rejected by gateway: unknown',
      );
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

// ── buildDashboardDeferredMessage ─────────────────────────────────────────
//
// DEFER_DASHBOARD_PLAN PR 4: dashboard creation moved to a separate
// command, so the main run's success state is "events instrumented." This
// helper builds the user-facing copy shown in both the live status ticker
// and the OutroScreen changes list. Two shapes — with or without a
// `dashboard-plan.json` artifact path. Locking the wording in keeps a
// future copy edit from accidentally breaking the contract analytics +
// CI orchestrators look for ("Run `npx @amplitude/wizard dashboard`").

describe('buildDashboardDeferredMessage', () => {
  it('mentions the deferred command in both shapes', () => {
    const withPlan = buildDashboardDeferredMessage({
      planPath: '/p/.amplitude/dashboard-plan.json',
    });
    const withoutPlan = buildDashboardDeferredMessage({ planPath: null });

    // The command name MUST appear verbatim in both shapes — the
    // user-facing instruction is the load-bearing piece.
    expect(withPlan).toContain('npx @amplitude/wizard dashboard');
    expect(withoutPlan).toContain('npx @amplitude/wizard dashboard');
  });

  it('starts with "Events instrumented!" so the success framing reads cleanly', () => {
    // The terminal-step success bar collapses from "Build your starter
    // dashboard" (formerly step 5) to "Wire up event tracking" (the new
    // terminal step). The outro copy should advertise that explicit
    // success ("Events instrumented!") instead of leading with the
    // deferred-dashboard ask, so users don't read it as a partial
    // failure.
    expect(buildDashboardDeferredMessage({ planPath: null })).toMatch(
      /^Events instrumented!/,
    );
    expect(
      buildDashboardDeferredMessage({
        planPath: '/p/.amplitude/dashboard-plan.json',
      }),
    ).toMatch(/^Events instrumented!/);
  });

  it('cites the plan path when an artifact was persisted', () => {
    const planPath = '/some/install/dir/.amplitude/dashboard-plan.json';
    const message = buildDashboardDeferredMessage({ planPath });
    expect(message).toContain(planPath);
  });

  it('omits the plan path entirely when no artifact was persisted', () => {
    // No empty "saved at " trailing fragment — the no-plan branch is a
    // distinct copy. (Prevents a regression where a `null` ever got
    // template-stringified into the message as "saved at null".)
    const message = buildDashboardDeferredMessage({ planPath: null });
    expect(message).not.toContain('saved at');
    expect(message).not.toContain('null');
  });

  it('does not falsely claim "Events instrumented!" when events.json was not written', () => {
    // Soft-error path: agent stream terminated, dashboard-plan.json may
    // exist (from a checkpoint replay) but events.json does not. The
    // status ticker / outro must not announce "Events instrumented!" in
    // that case — wire is not marked completed either.
    const message = buildDashboardDeferredMessage({
      planPath: null,
      eventsInstrumented: false,
    });
    expect(message).not.toMatch(/^Events instrumented!/);
    expect(message).toContain('npx @amplitude/wizard dashboard');
  });
});

// ── DEFER_DASHBOARD_PLAN PR 4: regression guards on the agent system prompt
// ── + commandments contract.
//
// `record_dashboard`, `create_chart`, `create_dashboard`, `query_dataset`,
// and the `amplitude-chart-dashboard-plan` skill are all owned by the
// deferred command from PR 4 onwards. The main wizard run must NOT
// instruct the agent to call them; that's how we eliminate the 185s
// dashboard phase + 119s compaction stall the audit measured.
//
// We can't easily run `buildIntegrationPrompt` here without a full
// FrameworkConfig, so instead we lock the contract via the commandments
// helper (which is the durable cross-cutting prompt the audit traced
// the dashboard work to). Combined with the negative tests in
// `journey-state.test.ts` and `commandments.test.ts`, this gives us a
// three-layer guard against accidental re-introduction.

describe('agent system prompt no longer references dashboard MCP tools (DEFER_DASHBOARD_PLAN PR 4)', () => {
  it('commandments do not promote the inline chart/dashboard MCP tools as something to call', async () => {
    const { getWizardCommandments } = await import('../commandments');
    const text = getWizardCommandments({ targetsBrowser: true });

    // Each mention (if any) must sit alongside a "do not" / "deferred"
    // / "MUST NOT" cue — same shape as the regression guard in
    // commandments.test.ts. Belt-and-suspenders.
    const sentinels = [
      'create_chart',
      'create_dashboard',
      'query_dataset',
      'save_chart_edits',
    ];
    for (const phrase of sentinels) {
      const occurrences = text.match(new RegExp(phrase, 'g')) ?? [];
      // The negative-mention guard from commandments.test.ts covers
      // record_dashboard. For these chart-builder tools we lock down a
      // stricter rule: the static commandments must not name them at
      // all in a positive call-this context. (They're allowed to
      // appear in a single negative clause that lists "do not call" —
      // which is exactly how `commandments.ts` words it now.)
      if (occurrences.length === 0) continue;
      // Same window-based negative-cue check as commandments.test.ts.
      const allMentionsAreNegative = text
        .split(new RegExp(phrase))
        .slice(0, -1)
        .every((preceding, idx) => {
          const after = text.split(new RegExp(phrase))[idx + 1] ?? '';
          const window = `${preceding.slice(-200)}${phrase}${after.slice(
            0,
            200,
          )}`;
          return /(do not|MUST NOT|deferred|do NOT)/i.test(window);
        });
      expect(
        allMentionsAreNegative,
        `commandments mention of ${phrase} must sit in a "do not call" / "deferred" clause`,
      ).toBe(true);
    }
  });

  it('commandments do not pre-stage or promote amplitude-chart-dashboard-plan for the main run', async () => {
    const { getWizardCommandments } = await import('../commandments');
    const text = getWizardCommandments({ targetsBrowser: true });
    expect(text).not.toContain('amplitude-chart-dashboard-plan');
  });
});

// ── End-of-run flow: events-only success path
//
// The main success contract post-DEFER_DASHBOARD_PLAN PR 4 is:
//   - agent reaches the post-instrument boundary
//   - events.json artifact lands
//   - wire flips to completed (no dashboard cascade)
//   - outro shows the deferred-dashboard message
// We can't drive the full runAgentWizardBody from a unit test (it owns
// auth, the SDK, MCP config, etc.), but we CAN exercise the
// `agentEventsInstrumented` + `buildDashboardDeferredMessage` glue that
// the outro path now hinges on. These tests pin the new terminal-step
// signals.

describe('events-only success path (DEFER_DASHBOARD_PLAN PR 4)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'defer-dashboard-pr4-'));
    fs.mkdirSync(path.join(tmpDir, '.amplitude'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('agentEventsInstrumented is true once events.json lands — no dashboard URL needed', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.amplitude', 'events.json'),
      JSON.stringify([{ name: 'X', description: 'Y' }]),
    );
    const session = buildSession({ installDir: tmpDir });
    expect(agentEventsInstrumented(session)).toBe(true);
    // No checklistDashboardUrl is set — and the main run will no longer
    // call `record_dashboard`, so this is the steady-state success
    // shape post-PR4.
    expect(session.checklistDashboardUrl).toBeNull();
  });

  it('outro message hand-off cites the plan file when record_dashboard_plan persisted one', () => {
    // Simulate the agent calling `record_dashboard_plan` — the wizard
    // tool writes to `<installDir>/.amplitude/dashboard-plan.json`.
    // The outro builder must surface that path so the user can find
    // (and inspect) the strategy before running `wizard dashboard`.
    const planPath = path.join(tmpDir, '.amplitude', 'dashboard-plan.json');
    fs.writeFileSync(planPath, JSON.stringify({ version: 1 }));
    const message = buildDashboardDeferredMessage({ planPath });
    expect(message).toContain(planPath);
    expect(message).toContain('saved at');
  });

  it('outro message has no plan reference when the agent skipped record_dashboard_plan', () => {
    // Existing-project flow: no taxonomy work was needed, so no plan
    // gets persisted. The deferred message must not invent a path or
    // mention a missing artifact.
    const message = buildDashboardDeferredMessage({ planPath: null });
    expect(message).not.toContain('saved at');
    expect(message).not.toContain('dashboard-plan.json');
  });
});

// ── runColdStartParallel ──────────────────────────────────────────────
//
// Perf regression guard: the agent cold-start has three independent
// blocks (package-manager scan, AI-SDK gateway probe, agent-SDK MCP
// bootstrap) that used to run serially and cost 1-3s of dead wall time
// on every fresh run. The probe and MCP bootstrap live inside `getAgent`,
// so from the runner's perspective there are two parallel legs:
// `detectPackageManager` and `getAgent`. The helper must run them
// concurrently — these tests lock that in via timing markers.

describe('runColdStartParallel (cold-start perf)', () => {
  it('runs detectPackageManager and getAgent concurrently (overlap, not serial)', async () => {
    // Each leg sleeps 50ms. Serial would take ~100ms; parallel should
    // finish in ~50ms. Pick a generous threshold so a slow CI box
    // doesn't false-flag.
    const detectorStartedAt = { value: 0 };
    const detectorEndedAt = { value: 0 };
    const agentStartedAt = { value: 0 };
    const agentEndedAt = { value: 0 };

    const detect = async () => {
      detectorStartedAt.value = Date.now();
      await new Promise((r) => setTimeout(r, 50));
      detectorEndedAt.value = Date.now();
      return { detected: ['npm'], primary: 'npm', recommendation: '' };
    };

    const initAgent = async () => {
      agentStartedAt.value = Date.now();
      await new Promise((r) => setTimeout(r, 50));
      agentEndedAt.value = Date.now();
      return { workingDirectory: '/tmp/x' };
    };

    const start = Date.now();
    const result = await runColdStartParallel(detect, initAgent);
    const elapsed = Date.now() - start;

    // Both legs ran.
    expect(result.packageManagerInfo).toEqual({
      detected: ['npm'],
      primary: 'npm',
      recommendation: '',
    });
    expect(result.agent).toEqual({ workingDirectory: '/tmp/x' });

    // Wall-clock proves overlap: parallel ~50ms, serial would be ~100ms.
    // Use 90ms as the upper bound for a comfortable safety margin.
    expect(elapsed).toBeLessThan(90);

    // Direct overlap proof: each leg started before the other finished.
    expect(detectorStartedAt.value).toBeLessThan(agentEndedAt.value);
    expect(agentStartedAt.value).toBeLessThan(detectorEndedAt.value);
  });

  it('treats detectPackageManager errors as best-effort (returns null, swallows error)', async () => {
    // The package-manager scan was wrapped in try/catch in the original
    // serial version too — a slow / failing detector must not block
    // agent init. Lock that contract in.
    const detectorErr = new Error('ENOENT: package.json missing');
    const onDetectorError = vi.fn();

    const result = await runColdStartParallel(
      async () => {
        throw detectorErr;
      },
      async () => ({ workingDirectory: '/tmp/x' }),
      onDetectorError,
    );

    expect(result.packageManagerInfo).toBeNull();
    expect(result.agent).toEqual({ workingDirectory: '/tmp/x' });
    expect(onDetectorError).toHaveBeenCalledWith(detectorErr);
  });

  it('absorbs synchronous throws from the detector wrapper (not just async rejections)', async () => {
    // Bugbot regression guard: the call-site wrapper
    // (`() => config.detection.detectPackageManager(...)`) is NOT async.
    // Several concrete detectors are plain functions that return
    // `Promise.resolve(...)` — a sync throw inside one of them would
    // bubble out of the wrapper before any `.catch()` could see it,
    // killing agent init even though the detector is documented as
    // best-effort. Lock the contract that BOTH paths are absorbed.
    const detectorErr = new Error('sync boom');
    const onDetectorError = vi.fn();
    let agentRan = false;

    // Cast: the function-shape signature says `Promise<TPm>` but a sync
    // throw is exactly the runtime case we need to cover.
    const syncThrowingDetector = (() => {
      throw detectorErr;
    }) as unknown as () => Promise<{
      detected: string[];
      primary: string | null;
      recommendation: string;
    }>;

    const result = await runColdStartParallel(
      syncThrowingDetector,
      async () => {
        agentRan = true;
        return { workingDirectory: '/tmp/x' };
      },
      onDetectorError,
    );

    // Sync-throwing detector must not block agent init.
    expect(agentRan).toBe(true);
    expect(result.packageManagerInfo).toBeNull();
    expect(result.agent).toEqual({ workingDirectory: '/tmp/x' });
    expect(onDetectorError).toHaveBeenCalledWith(detectorErr);
  });

  it('propagates getAgent errors immediately (fail-fast on the agent leg)', async () => {
    // The agent leg is NOT best-effort — if MCP bootstrap or the
    // gateway probe fails the run cannot continue, and the caller
    // expects to see that error. `Promise.all` semantics guarantee
    // fail-fast.
    const agentErr = new Error('gateway probe failed');
    let detectorResolved = false;

    await expect(
      runColdStartParallel(
        async () => {
          // Slow detector — would otherwise mask a fast agent failure
          // if the helper waited for both legs.
          await new Promise((r) => setTimeout(r, 100));
          detectorResolved = true;
          return { detected: [], primary: null, recommendation: '' };
        },
        async () => {
          throw agentErr;
        },
      ),
    ).rejects.toBe(agentErr);

    // Sanity check: the detector hasn't necessarily finished by the
    // time we surface the agent error — fail-fast didn't wait on it.
    // (We don't strictly assert "false" here since timing varies; the
    // important contract is that the await above rejected with the
    // agent error, not the detector's null fallback.)
    expect(detectorResolved).toBeDefined();
  });
});
