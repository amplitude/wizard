/**
 * Direct tests for the `runCallSite` runner extension.
 *
 * Covers fixture loading, the three source modes, and the
 * gateway-auth refusal. We do NOT exercise live mode here (per the
 * constraint that the unit-test path must not make live LLM calls);
 * instead we assert that live mode without `WIZARD_OAUTH_TOKEN`
 * throws a clear error.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { getCallSite } from '../registry.js';
import {
  loadFixture,
  loadGoldenNdjson,
  runCallSite,
} from '../run-call-site.js';

describe('runCallSite', () => {
  describe('loadFixture', () => {
    it('loads a structured-output fixture and validates the meta block', () => {
      const callSite = getCallSite('propose_event_plan');
      const fixture = loadFixture(callSite);
      expect(fixture.callSiteId).toBe('propose_event_plan');
      expect(fixture.kind).toBe('structured-output');
      expect(fixture.recordedOutput).toBeDefined();
    });

    it('loads a streaming fixture (recordedOutput optional)', () => {
      const callSite = getCallSite('inner-loop-streamtext');
      const fixture = loadFixture(callSite);
      expect(fixture.kind).toBe('streaming');
    });

    it('throws when fixture id does not match registry id', () => {
      const callSite = getCallSite('propose_event_plan');
      // Point the fixture path at a different fixture so the meta
      // mismatch fires.
      expect(() =>
        loadFixture(callSite, {
          fixturePathOverride: 'evals/call-sites/select-skill/fixture.json',
        }),
      ).toThrow(/mismatch/);
    });
  });

  describe('source: mock', () => {
    it('returns the mockInvoker output as the artifact', async () => {
      const callSite = getCallSite('propose_event_plan');
      const artifact = await runCallSite({
        callSite,
        source: 'mock',
        mockInvoker: () => ({ events: [{ name: 'page_viewed' }] }),
      });
      expect(artifact.source).toBe('mock');
      expect(artifact.callSiteId).toBe('propose_event_plan');
      expect(artifact.output).toEqual({ events: [{ name: 'page_viewed' }] });
    });

    it('throws when mock source is requested without a mockInvoker', async () => {
      const callSite = getCallSite('propose_event_plan');
      await expect(runCallSite({ callSite, source: 'mock' })).rejects.toThrow(
        /requires mockInvoker/,
      );
    });
  });

  describe('source: golden', () => {
    it('reads recordedOutput for structured-output sites', async () => {
      const callSite = getCallSite('propose_event_plan');
      const artifact = await runCallSite({ callSite, source: 'golden' });
      expect(artifact.source).toBe('golden');
      expect(artifact.output).toMatchObject({ events: expect.any(Array) });
    });

    it('reads golden.ndjson for streaming sites', async () => {
      const callSite = getCallSite('inner-loop-streamtext');
      const artifact = await runCallSite({ callSite, source: 'golden' });
      expect(Array.isArray(artifact.output)).toBe(true);
      const events = artifact.output as unknown[];
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('source: live', () => {
    let savedToken: string | undefined;
    beforeEach(() => {
      savedToken = process.env.WIZARD_OAUTH_TOKEN;
      delete process.env.WIZARD_OAUTH_TOKEN;
    });
    afterEach(() => {
      if (savedToken !== undefined) process.env.WIZARD_OAUTH_TOKEN = savedToken;
    });

    it('refuses to run live without WIZARD_OAUTH_TOKEN', async () => {
      const callSite = getCallSite('propose_event_plan');
      await expect(
        runCallSite({
          callSite,
          source: 'live',
          liveInvoker: async () => ({ events: [] }),
        }),
      ).rejects.toThrow(/WIZARD_OAUTH_TOKEN/);
    });

    it('refuses to run live without a liveInvoker even when token is set', async () => {
      process.env.WIZARD_OAUTH_TOKEN = 'fake-token-for-test';
      const callSite = getCallSite('propose_event_plan');
      await expect(runCallSite({ callSite, source: 'live' })).rejects.toThrow(
        /requires liveInvoker/,
      );
    });
  });

  describe('loadGoldenNdjson', () => {
    it('returns [] when the call site has no golden', () => {
      const callSite = getCallSite('propose_event_plan');
      expect(loadGoldenNdjson(callSite)).toEqual([]);
    });

    it('parses golden.ndjson lines', () => {
      const callSite = getCallSite('inner-loop-streamtext');
      const events = loadGoldenNdjson(callSite);
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect((e as { v?: number }).v).toBe(1);
      }
    });
  });
});
