/**
 * Registry self-test.
 *
 * Catches CALL_SITES entries whose fixture/scorer/golden was renamed
 * or deleted without a corresponding registry update — the most
 * common drift mode. Also verifies the source-glob map covers the
 * three bootstrap call sites.
 */

import { describe, expect, it } from 'vitest';

import {
  CALL_SITES,
  CALL_SITE_SOURCE_GLOBS,
  assertCallSiteArtifactsExist,
  getCallSite,
} from '../registry.js';

describe('call-site registry', () => {
  it('lists at least the three bootstrap call sites from §7.4', () => {
    const ids = CALL_SITES.map((c) => c.id);
    expect(ids).toContain('propose_event_plan');
    expect(ids).toContain('select_skill');
    expect(ids).toContain('inner-loop-streamtext');
  });

  it('every entry has a non-empty source location and fixture/scorer path', () => {
    for (const cs of CALL_SITES) {
      expect(cs.id).toBeTruthy();
      expect(cs.sourceLocation, `sourceLocation for ${cs.id}`).toMatch(
        /.+:\d+/,
      );
      expect(cs.fixture, `fixture for ${cs.id}`).toMatch(
        /^evals\/call-sites\//,
      );
      expect(cs.scorer, `scorer for ${cs.id}`).toMatch(/^evals\/call-sites\//);
    }
  });

  it('every registered call site has its fixture + scorer + (optional) golden on disk', () => {
    expect(() => assertCallSiteArtifactsExist()).not.toThrow();
  });

  it('CALL_SITE_SOURCE_GLOBS covers every registered call site', () => {
    for (const cs of CALL_SITES) {
      const globs = CALL_SITE_SOURCE_GLOBS[cs.id];
      expect(
        globs,
        `${cs.id} missing from CALL_SITE_SOURCE_GLOBS`,
      ).toBeDefined();
      expect(globs.length).toBeGreaterThan(0);
    }
  });

  it('getCallSite throws on unknown id', () => {
    expect(() => getCallSite('does-not-exist')).toThrow(/unknown call-site id/);
  });

  it('streaming sites declare a golden.ndjson; one-shot sites may omit it', () => {
    const streaming = CALL_SITES.filter((c) => c.model === 'standard');
    for (const cs of streaming) {
      expect(
        cs.golden,
        `${cs.id} is standard tier and must declare golden`,
      ).toBeTruthy();
    }
  });
});
