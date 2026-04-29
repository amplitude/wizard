/**
 * jwt-exp — defensive decoder for JWT `exp` claims.
 *
 * Why this exists:
 *
 *   The wizard's `~/.ampli.json` stores ONE `expiresAt` field per stored
 *   token entry. Until 2026-04, that field was stamped with one of three
 *   numbers depending on which code path persisted the entry:
 *
 *     - `bin.ts` login subcommand: `Date.now() + 3600 * 1000` (1 hour
 *       hardcode — accidentally aligned to id_token TTL)
 *     - `oauth.ts` initial OAuth flow: `Date.now() + tokenResponse.expires_in
 *       * 1000` (access_token TTL — 24 hours from Ory)
 *     - `setup-utils.ts` hosted-signup flow: another 1-hour hardcode
 *
 *   The wizard authenticates with the id_token (not the access_token) for
 *   every `fetchAmplitudeUser` / `getAPIKey` call. The id_token's TTL is
 *   1 hour (Ory default for OIDC); the access_token's TTL is 24 hours.
 *   Storing the access_token TTL meant the proactive-refresh trigger at
 *   `tryRefreshToken` could miss a stale id_token by up to 23 hours.
 *
 *   This module pulls `exp` directly from the id_token JWT so the stored
 *   `expiresAt` reflects the binding constraint (id_token expiry) rather
 *   than whichever number happened to be in scope at the call site.
 *
 * Security note:
 *
 *   We do NOT verify the JWT signature here. The wizard receives these
 *   tokens directly from Ory over TLS and only uses them as bearer
 *   credentials in subsequent requests; signature validation is the
 *   server's job. This decoder is for reading our own already-trusted
 *   tokens, not for accepting tokens from external callers.
 */

import { logToFile } from './debug.js';

/**
 * Lower bound on a sensible id_token TTL. If a JWT decodes to an `exp`
 * that's already past or trivially close to now, treat it as malformed
 * and fall back. Prevents a clock-skewed token from triggering refresh
 * storms.
 */
const MIN_VALID_TTL_MS = 30 * 1000;

/**
 * Upper bound on a sensible id_token TTL. Ory's OIDC id_tokens are
 * minutes-to-hours; a 30-day TTL would be a misconfiguration on the
 * server. Cap so we don't store a year-long expiry from a corrupted
 * token and skip refresh entirely.
 */
const MAX_VALID_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Decode the `exp` claim from a JWT and return it as Unix epoch ms.
 *
 * Returns `null` when the token can't be decoded, doesn't carry an
 * `exp` claim, or the claim is outside a sane range. The caller should
 * fall back to a TTL it computes another way (server `expires_in`, or
 * a conservative hardcoded default) — never throw.
 *
 * @param token Compact JWT (`<header>.<payload>.<signature>`)
 * @param now Reference time for sanity checks. Override for tests.
 */
export function decodeJwtExpiryMs(
  token: string | undefined | null,
  now: number = Date.now(),
): number | null {
  if (typeof token !== 'string' || token.length === 0) return null;

  // JWT shape: three base64url segments separated by `.`. We only need
  // segment 1 (the payload). Anything else is malformed.
  const parts = token.split('.');
  if (parts.length !== 3) {
    logToFile('[jwt-exp] not a 3-segment JWT', { segments: parts.length });
    return null;
  }

  let payloadJson: string;
  try {
    // base64url → utf-8. Node's Buffer accepts base64url natively in 16+.
    payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
  } catch (err) {
    logToFile(
      '[jwt-exp] failed to base64-decode payload',
      err instanceof Error ? err.message : 'unknown',
    );
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch (err) {
    logToFile(
      '[jwt-exp] payload is not valid JSON',
      err instanceof Error ? err.message : 'unknown',
    );
    return null;
  }

  if (typeof payload !== 'object' || payload === null || !('exp' in payload)) {
    return null;
  }

  const exp = (payload as { exp: unknown }).exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return null;
  }

  // RFC 7519 §4.1.4: `exp` is seconds since the epoch. Convert to ms.
  const expMs = exp * 1000;

  // Sanity: must be sufficiently in the future. A token whose `exp` is
  // already past (or expires in <30s) is either malformed or so stale
  // that the caller should fall back to triggering a refresh anyway.
  if (expMs - now < MIN_VALID_TTL_MS) {
    logToFile('[jwt-exp] exp is in the past or trivially close', {
      expIso: new Date(expMs).toISOString(),
      nowIso: new Date(now).toISOString(),
    });
    return null;
  }

  // Sanity: cap absurdly long TTLs. Defends against a corrupted /
  // misconfigured token persuading the wizard to skip refresh for a year.
  if (expMs - now > MAX_VALID_TTL_MS) {
    logToFile('[jwt-exp] exp is implausibly far in the future', {
      expIso: new Date(expMs).toISOString(),
      nowIso: new Date(now).toISOString(),
    });
    return null;
  }

  return expMs;
}

/**
 * Convenience helper for the common write-time pattern: prefer the
 * id_token's `exp`, fall back to a server-supplied `expires_in`
 * (seconds), fall back to a 1-hour conservative default.
 *
 * Returns Unix epoch ms.
 */
export function resolveStoredExpiryMs(opts: {
  /** OIDC id_token, when available. Authoritative when present. */
  idToken?: string | null;
  /** OAuth `expires_in` from the token endpoint, in seconds. */
  expiresInSeconds?: number;
  /** Reference time for sanity checks. Override for tests. */
  now?: number;
}): number {
  const now = opts.now ?? Date.now();
  const fromJwt = decodeJwtExpiryMs(opts.idToken, now);
  if (fromJwt !== null) return fromJwt;

  if (
    typeof opts.expiresInSeconds === 'number' &&
    Number.isFinite(opts.expiresInSeconds) &&
    opts.expiresInSeconds > 0
  ) {
    // Cap at the same MAX bound so a server bug can't push us past it.
    const fromServer = now + opts.expiresInSeconds * 1000;
    if (fromServer - now <= MAX_VALID_TTL_MS) return fromServer;
  }

  // Final fallback: 1 hour. Matches the historical behavior of the call
  // sites this helper replaces — never strictly worse than what was
  // there before.
  return now + 60 * 60 * 1000;
}
