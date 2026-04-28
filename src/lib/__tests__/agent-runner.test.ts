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
import {
  agentArtifactsLookComplete,
  agentEventsInstrumented,
  classifyApiErrorSubtype,
} from '../agent-runner.js';
import { AgentErrorType } from '../agent-interface.js';
import { buildSession } from '../wizard-session.js';

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
