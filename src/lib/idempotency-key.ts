/**
 * Helpers for the `Idempotency-Key` header attached to `POST /projects`.
 *
 * The wizard-proxy validates the header value with a UUID v4 regex (see the
 * proxy's `extractIdempotencyKey`), so callers must use a UUID — not an
 * arbitrary string. The key MUST be generated **per logical attempt** and
 * reused across HTTP retries; the whole point is to dedupe a successful
 * create against a network-blip retry that would otherwise double-create.
 *
 * State lives on `WizardSession.createProject.idempotencyKey` so all
 * surfaces (TUI screen, CLI helper, agent UI) share one key per attempt.
 * Use {@link getOrCreateProjectIdempotencyKey} on the way into the create
 * call and {@link clearProjectIdempotencyKey} after a terminal outcome
 * (successful create or explicit cancel — a recoverable error keeps the
 * key so the user's retry stays idempotent).
 */

import { v4 as uuidv4 } from 'uuid';
import type { WizardSession } from './wizard-session.js';

/**
 * Read the session's current idempotency key, generating one on first
 * access. Mutates `session.createProject.idempotencyKey` in place — safe
 * to call from any code path that's about to make a `POST /projects`
 * request, including HTTP retries from inside `createAmplitudeApp`
 * (returns the same key on the second call).
 */
export function getOrCreateProjectIdempotencyKey(
  session: WizardSession,
): string {
  const existing = session.createProject.idempotencyKey;
  if (existing && isUuidV4(existing)) return existing;
  const key = uuidv4();
  session.createProject.idempotencyKey = key;
  return key;
}

/**
 * Clear the persisted key. Call after a successful create (so a follow-up
 * `/create-project` invocation gets a fresh key) or an explicit user
 * cancel. Recoverable errors (network, 5xx, 401 retry, 409 idempotency
 * conflict) should NOT clear — the user's retry must replay the same key
 * so the proxy can dedupe.
 */
export function clearProjectIdempotencyKey(session: WizardSession): void {
  session.createProject.idempotencyKey = null;
}

/**
 * Lightweight UUID v4 check matching the wizard-proxy's
 * `extractIdempotencyKey` regex. Defensive against a checkpoint replay
 * loading a malformed value from disk — we'd rather mint a fresh UUID
 * than send a header the proxy will reject.
 */
function isUuidV4(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
