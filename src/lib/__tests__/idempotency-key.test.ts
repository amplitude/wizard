/**
 * Unit tests for the project-create idempotency key helpers. Pin the
 * UUID-v4 contract that the wizard-proxy validates with a regex
 * (`extractIdempotencyKey`) and the per-attempt persistence semantics
 * that prevent a network blip from double-creating a project.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearProjectIdempotencyKey,
  getOrCreateProjectIdempotencyKey,
} from '../idempotency-key.js';
import type { WizardSession } from '../wizard-session.js';

function makeSessionStub(initial: string | null = null): WizardSession {
  // Minimal partial session — only the fields the helpers touch. The
  // helpers don't read anything else, so no need to construct the full
  // ~80-field shape.
  const stub = {
    createProject: {
      pending: false,
      source: null,
      suggestedName: null,
      idempotencyKey: initial,
    },
  };
  return stub as unknown as WizardSession;
}

describe('getOrCreateProjectIdempotencyKey', () => {
  let session: WizardSession;
  beforeEach(() => {
    session = makeSessionStub();
  });

  it('mints a new UUID v4 on first call', () => {
    const key = getOrCreateProjectIdempotencyKey(session);
    // RFC 4122 v4 shape — proxy regex requires this.
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(session.createProject.idempotencyKey).toBe(key);
  });

  it('returns the same key on subsequent calls (HTTP retry path)', () => {
    const first = getOrCreateProjectIdempotencyKey(session);
    const second = getOrCreateProjectIdempotencyKey(session);
    expect(second).toBe(first);
  });

  it('replaces a malformed persisted value with a fresh UUID', () => {
    // Defensive against a checkpoint replay loading garbage from disk —
    // we'd rather mint a new UUID than send a header the proxy rejects.
    const stale = makeSessionStub('not-a-uuid');
    const key = getOrCreateProjectIdempotencyKey(stale);
    expect(key).not.toBe('not-a-uuid');
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('preserves a valid persisted UUID across calls', () => {
    // Carrying an in-flight key through a flow re-entry is the whole
    // point of session persistence — must NOT regenerate.
    const persisted = '11111111-1111-4111-8111-111111111111';
    const stub = makeSessionStub(persisted);
    expect(getOrCreateProjectIdempotencyKey(stub)).toBe(persisted);
  });
});

describe('clearProjectIdempotencyKey', () => {
  it('drops the persisted key', () => {
    const session = makeSessionStub('11111111-1111-4111-8111-111111111111');
    clearProjectIdempotencyKey(session);
    expect(session.createProject.idempotencyKey).toBeNull();
  });
});
