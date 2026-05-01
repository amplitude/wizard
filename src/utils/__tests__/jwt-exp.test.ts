import { describe, it, expect, vi } from 'vitest';
import {
  decodeJwtExpiryMs,
  decodeJwtZone,
  resolveStoredExpiryMs,
} from '../jwt-exp.js';

vi.mock('../debug.js', () => ({ logToFile: vi.fn() }));

/**
 * Build a minimal compact JWT with the given payload. We don't care about
 * signature validity — the wizard's decoder doesn't verify signatures.
 */
function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesignature`;
}

const NOW = 1_700_000_000_000; // 2023-11-14T22:13:20Z — fixed for determinism

describe('decodeJwtExpiryMs', () => {
  it('returns the exp claim as Unix epoch ms', () => {
    // exp 30 minutes in the future — well within sanity bounds.
    const expSec = Math.floor((NOW + 30 * 60 * 1000) / 1000);
    const token = makeJwt({ exp: expSec, sub: 'user@example.com' });
    expect(decodeJwtExpiryMs(token, NOW)).toBe(expSec * 1000);
  });

  it('returns null for an undefined / empty token', () => {
    expect(decodeJwtExpiryMs(undefined, NOW)).toBeNull();
    expect(decodeJwtExpiryMs(null, NOW)).toBeNull();
    expect(decodeJwtExpiryMs('', NOW)).toBeNull();
  });

  it('returns null for a non-3-segment string', () => {
    expect(decodeJwtExpiryMs('not.a-jwt', NOW)).toBeNull();
    expect(decodeJwtExpiryMs('a.b.c.d', NOW)).toBeNull();
    expect(decodeJwtExpiryMs('plain-string', NOW)).toBeNull();
  });

  it('returns null when the payload is not valid JSON', () => {
    const garbage = `header.${Buffer.from('not json').toString(
      'base64url',
    )}.sig`;
    expect(decodeJwtExpiryMs(garbage, NOW)).toBeNull();
  });

  it('returns null when the payload has no exp claim', () => {
    const token = makeJwt({ sub: 'user@example.com' });
    expect(decodeJwtExpiryMs(token, NOW)).toBeNull();
  });

  it('returns null when exp is not a finite number', () => {
    const stringExp = makeJwt({ exp: '1700000000' as unknown as number });
    const nullExp = makeJwt({ exp: null as unknown as number });
    expect(decodeJwtExpiryMs(stringExp, NOW)).toBeNull();
    expect(decodeJwtExpiryMs(nullExp, NOW)).toBeNull();
  });

  it('returns null when exp is already past (server clock skew)', () => {
    const token = makeJwt({ exp: Math.floor((NOW - 60 * 1000) / 1000) });
    expect(decodeJwtExpiryMs(token, NOW)).toBeNull();
  });

  it('returns null when exp is implausibly far in the future', () => {
    // 365 days out — beyond the 7-day cap. Defends against corrupted /
    // misconfigured tokens persuading the wizard to skip refresh.
    const token = makeJwt({
      exp: Math.floor((NOW + 365 * 24 * 60 * 60 * 1000) / 1000),
    });
    expect(decodeJwtExpiryMs(token, NOW)).toBeNull();
  });
});

describe('resolveStoredExpiryMs', () => {
  it('prefers the id_token JWT exp when valid', () => {
    const expSec = Math.floor((NOW + 45 * 60 * 1000) / 1000);
    const idToken = makeJwt({ exp: expSec });
    // expires_in is much longer (24h) — the id_token's 45min must win.
    const result = resolveStoredExpiryMs({
      idToken,
      expiresInSeconds: 24 * 60 * 60,
      now: NOW,
    });
    expect(result).toBe(expSec * 1000);
  });

  it("falls back to expires_in when the id_token can't be decoded", () => {
    const result = resolveStoredExpiryMs({
      idToken: 'malformed',
      expiresInSeconds: 30 * 60, // 30 min
      now: NOW,
    });
    expect(result).toBe(NOW + 30 * 60 * 1000);
  });

  it('falls back to 1-hour default when neither input is usable', () => {
    const result = resolveStoredExpiryMs({
      idToken: null,
      expiresInSeconds: undefined,
      now: NOW,
    });
    expect(result).toBe(NOW + 60 * 60 * 1000);
  });

  it('caps an absurd expires_in at the conservative default', () => {
    // Server bug: claims expires_in = 30 days. We don't trust it.
    const result = resolveStoredExpiryMs({
      idToken: null,
      expiresInSeconds: 30 * 24 * 60 * 60, // 30 days
      now: NOW,
    });
    // Out-of-range expires_in falls through to the 1-hour default.
    expect(result).toBe(NOW + 60 * 60 * 1000);
  });

  it('ignores a malformed id_token even when expires_in is also bad and uses default', () => {
    const result = resolveStoredExpiryMs({
      idToken: 'definitely.not.a-jwt',
      expiresInSeconds: 0,
      now: NOW,
    });
    expect(result).toBe(NOW + 60 * 60 * 1000);
  });
});

describe('decodeJwtZone', () => {
  it('returns "us" for an auth.amplitude.com issuer', () => {
    const token = makeJwt({ iss: 'https://auth.amplitude.com' });
    expect(decodeJwtZone(token)).toBe('us');
  });

  it('returns "us" when the issuer carries a trailing slash (Ory default)', () => {
    const token = makeJwt({ iss: 'https://auth.amplitude.com/' });
    expect(decodeJwtZone(token)).toBe('us');
  });

  it('returns "eu" for an auth.eu.amplitude.com issuer', () => {
    const token = makeJwt({ iss: 'https://auth.eu.amplitude.com' });
    expect(decodeJwtZone(token)).toBe('eu');
  });

  it('returns null for unknown issuer hosts', () => {
    const token = makeJwt({ iss: 'https://auth.example.com' });
    expect(decodeJwtZone(token)).toBeNull();
  });

  it('returns null when the iss claim is absent', () => {
    const token = makeJwt({ sub: 'user@example.com' });
    expect(decodeJwtZone(token)).toBeNull();
  });

  it('returns null for a malformed iss URL', () => {
    const token = makeJwt({ iss: 'not a url' });
    expect(decodeJwtZone(token)).toBeNull();
  });

  it('returns null for unparseable tokens', () => {
    expect(decodeJwtZone(undefined)).toBeNull();
    expect(decodeJwtZone(null)).toBeNull();
    expect(decodeJwtZone('')).toBeNull();
    expect(decodeJwtZone('not.a-jwt')).toBeNull();
  });
});
