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

import { describe, it, expect } from 'vitest';
import { classifyApiErrorSubtype } from '../agent-runner.js';
import { AgentErrorType } from '../agent-interface.js';

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
