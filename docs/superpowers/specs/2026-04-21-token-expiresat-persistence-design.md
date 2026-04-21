# Token `expiresAt` Persistence — Design

**Status:** Approved, ready for implementation
**Date:** 2026-04-21
**Follow-up to:** [PR #165](https://github.com/amplitude/wizard/pull/165) — direct signup
**PR placeholder:** [PR #185](https://github.com/amplitude/wizard/pull/185)

## Problem

Two TUI-mode credential-persistence paths (`bin.ts:1264` and `bin.ts:1592`) hardcode a 1-hour `expiresAt` when calling `storeToken`, rather than using the real expiry returned by the OAuth token exchange. In both cases the real expiry has already been written to `~/.ampli.json` by a prior call inside `performAmplitudeAuth` or `performSignupOrAuth`. The re-store then **overwrites** the correct record with the fabricated 1h value.

### Three affected flows

1. **Signup → pending sentinel → TUI upgrade** (net-new to #165). When `performSignupOrAuth`'s internal `fetchAmplitudeUser` throws, the wrapper persists `{id:'pending'}` as the `StoredUser` alongside the real tokens, and returns `{ ..., userInfo: null }`. The TUI else-branch then re-fetches userInfo and re-stores with a fabricated 1h `expiresAt`, overwriting the real expiry.
2. **Plain browser OAuth through TUI** (pre-existing). Same TUI else-branch runs after `performAmplitudeAuth`, which already wrote a pending entry with the real expiry. The re-store again overwrites with 1h.
3. **`/login` slash command** (pre-existing). `bin.ts:1592` re-stores after browser OAuth with the same 1h hardcode. This site was not explicitly in PR #185's original scope but has identical shape, identical severity, and is included here per design review.

### Why it matters

Severity is **Low** today — token refresh absorbs the inaccuracy in both directions. It's worth fixing because:

- Correctness hygiene: the real value is available; fabricating it is structurally wrong.
- Latent footgun: any future code that reads `expiresAt` (proactive refresh, stale-state UX, telemetry on token age) inherits the wrong value silently.
- Refresh lead-time math: `token-refresh.ts` uses `expiresAt` to decide when to refresh proactively. That decision is off by whatever the divergence is.

## Core insight

The TUI re-store isn't rewriting tokens because it has fresh ones — it's upgrading the `User` record from the `{id:'pending'}` sentinel to a real user. The tokens are collateral damage of `storeToken(user, token)` being a single op that forces both to be re-supplied.

The bug is that a caller which only has fresh user data is forced to fabricate token metadata it doesn't have. Threading `expiresAt` through `AmplitudeAuthResult` treats the symptom. Splitting the user-upgrade from token persistence fixes the cause.

## Design

### New API — `updateStoredUser(user)`

Add to `src/utils/ampli-settings.ts`, alongside existing `updateStoredUserZone` which demonstrates the same partial-update mechanic.

```ts
export function updateStoredUser(
  user: StoredUser,
  configPath?: string,
): void;
```

Behavior:

1. Read config.
2. Look for a pending entry at `userKey('pending', user.zone)`. If found, delete that key and write a new entry at `userKey(user.id, user.zone)` with the pending entry's existing `OAuth*` fields preserved and the new `User` object.
3. If no pending entry but the real-id key already exists (repeat run, same user), overwrite the `User` field only; leave `OAuth*` untouched.
4. If neither exists: log and no-op. This state means no prior `storeToken` call — shouldn't happen in practice, but crashing here is worse than doing nothing.
5. Atomic write via the existing `writeConfig` / `atomicWriteJSON`.

Zone is keyed into the lookup, so a `pending` entry under `eu` doesn't collide with one under `us`.

### Call-site changes

**Three sites, same shape.**

1. `bin.ts:1264-1280` — TUI else-branch after plain OAuth or pending upgrade. Replace `storeToken(user, { …, expiresAt: fabricated })` with `updateStoredUser(user)`.
2. `bin.ts:1592-1606` — `/login` slash command. Same replacement.
3. `signup-or-auth.ts:184` — **no change.** This call has a real token and writes the record initially. `storeToken(user, token)` remains valid for callers with fresh tokens.

`storeToken` signature is unchanged; this is purely additive.

### Tests

1. **Unit test on `updateStoredUser`:** seed a pending entry with a non-1h `expiresAt` (e.g. 2h); call `updateStoredUser(realUser)`; assert the real-id key exists with `expiresAt` byte-identical to the seeded value, and the pending key is gone.
2. **Unit test:** seed an existing real-id entry; call `updateStoredUser(realUser)`; assert `User` field updated, `OAuth*` fields untouched.
3. **Unit test:** seed two pending entries under different zones (us, eu); call `updateStoredUser(realUser)` with zone=eu; assert only the eu entry migrated, us pending entry untouched.
4. **Regression test at the persistence boundary:** stub `exchangeCodeForToken` to return `expires_in: 7200`; exercise the TUI else-branch flow (or a focused equivalent) such that `performAmplitudeAuth` → `updateStoredUser` runs; assert stored `expiresAt ≈ now+7200s` within a few seconds. Locks in correctness so future refactors can't silently reintroduce the hardcode.

During implementation, briefly check whether `performAmplitudeAuth` already has persistence-side-effect coverage. If not, test #4 fills that gap.

## Out of scope

- `token-refresh.ts` logic. Refresh math will inherit correctness once `expiresAt` is accurate; no further changes needed.
- `AmplitudeAuthResult` shape.
- `storeToken` signature.
- Signup response parsing in `direct-signup.ts` (already correct).
- The pending-sentinel mechanism itself.

## Constraints (preserved from PR #185)

- Don't break the plain browser-OAuth path — common path, regressions highly visible.
- Don't remove the user-record upgrade in the TUI else-branch — it's the mechanism that turns the pending sentinel back into a real `StoredUser` on the same wizard run. This design preserves that mechanism and makes it cleaner.
- Preserve atomic-write semantics in `updateStoredUser`.
- No telemetry, behavior, or UI changes beyond what's necessary for persistence correctness.

## Gating

Not a merge blocker for #165. Severity is Low in practice. Land before the `wizard-direct-signup` flag ramps off 0% so Case 1 (the net-new case this introduces) is cleaned up before real users exercise it.

## Anchors

- `bin.ts:1264-1280` — TUI else-branch `storeToken` with 1h hardcode.
- `bin.ts:1592-1606` — `/login` command `storeToken` with 1h hardcode.
- `src/utils/oauth.ts:performAmplitudeAuth` — already persists real `expiresAt` (oauth.ts:327-342).
- `src/utils/signup-or-auth.ts:184` — already persists real `expiresAt` from `DirectSignupResult`.
- `src/utils/ampli-settings.ts:storeToken` — persistence boundary; unchanged.
- `src/utils/ampli-settings.ts:updateStoredUserZone` — reference for the partial-update mechanic.
- `src/utils/token-refresh.ts` — downstream consumer of `expiresAt`; unchanged.
