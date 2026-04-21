# Token `expiresAt` Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop overwriting the real OAuth `expiresAt` with a 1-hour hardcoded value at two `storeToken` call sites, without breaking the "upgrade pending sentinel to real user" mechanic that required those re-stores.

**Architecture:** Add a narrow `updateStoredUser(user)` function in `src/utils/ampli-settings.ts` that migrates a pending-sentinel entry to the real-id key while preserving the `OAuth*` fields written earlier by `performAmplitudeAuth` / `performSignupOrAuth`. Swap the two bugged `storeToken(user, fabricatedToken)` call sites in `bin.ts` to call the new function instead. `storeToken` signature stays unchanged for callers with fresh tokens.

**Tech Stack:** TypeScript, vitest, existing in-memory `fs` mock pattern in `src/utils/__tests__/ampli-settings.test.ts`.

**Spec:** `docs/superpowers/specs/2026-04-21-token-expiresat-persistence-design.md`

---

## Execution Prerequisites

Before starting Task 1, set up a dedicated worktree and feature branch. The follow-up PR stacks on top of `feat/direct-signup-v2` (the #165 branch), **not** on `main`.

```bash
# From the main checkout at /Users/michael.bird/repos/wizard
cd /Users/michael.bird/repos/wizard
git worktree add .claude/worktrees/wizard-expiresat-fix -b followup/token-expiresAt-persistence feat/direct-signup-v2
cd .claude/worktrees/wizard-expiresat-fix
pnpm install
```

All subsequent tasks run from `.claude/worktrees/wizard-expiresat-fix`. Verify before Task 1:

```bash
git branch --show-current  # → followup/token-expiresAt-persistence
git log --oneline -1        # → 2709de7 fix: resolve zone from stored state...
```

---

## Task 1: Add `updateStoredUser` — pending → real migration

**Files:**
- Modify: `src/utils/__tests__/ampli-settings.test.ts`
- Modify: `src/utils/ampli-settings.ts`

- [ ] **Step 1: Write the failing test**

Append this `describe` block at the end of `src/utils/__tests__/ampli-settings.test.ts` (before the final line — after the `clearStoredCredentials` block):

```ts
// ── updateStoredUser ───────────────────────────────────────────────────────

describe('updateStoredUser', () => {
  const realUser: StoredUser = {
    id: '42',
    firstName: 'Grace',
    lastName: 'Hopper',
    email: 'grace@example.com',
    zone: 'us',
  };

  beforeEach(() => {
    setupConfig({});
  });

  it('migrates a pending entry to the real-id key, preserving OAuth fields', () => {
    const PRESERVED = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    setupConfig({
      'User-pending': {
        User: {
          id: 'pending',
          firstName: 'Grace',
          lastName: 'Hopper',
          email: 'grace@example.com',
          zone: 'us',
        },
        OAuthAccessToken: 'real-access',
        OAuthIdToken: 'real-id',
        OAuthRefreshToken: 'real-refresh',
        OAuthExpiresAt: PRESERVED,
      },
    });

    updateStoredUser(realUser);

    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written['User-pending']).toBeUndefined();
    expect(written['User-42']).toEqual({
      User: realUser,
      OAuthAccessToken: 'real-access',
      OAuthIdToken: 'real-id',
      OAuthRefreshToken: 'real-refresh',
      OAuthExpiresAt: PRESERVED,
    });
  });
});
```

Also update the import near the top of the test file. Find the existing import block (line 22-30):

```ts
import {
  getStoredUser,
  getStoredToken,
  storeToken,
  clearStoredCredentials,
  type StoredUser,
  type StoredOAuthToken,
} from '../ampli-settings.js';
```

Replace with:

```ts
import {
  getStoredUser,
  getStoredToken,
  storeToken,
  updateStoredUser,
  clearStoredCredentials,
  type StoredUser,
  type StoredOAuthToken,
} from '../ampli-settings.js';
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm vitest run src/utils/__tests__/ampli-settings.test.ts -t "updateStoredUser"
```

Expected: TypeScript error or runtime error — `updateStoredUser` is not exported from `../ampli-settings.js`.

- [ ] **Step 3: Add the minimal implementation**

In `src/utils/ampli-settings.ts`, add the following function immediately after `storeToken` (before `clearStoredCredentials`):

```ts
/**
 * Updates the stored User record without touching OAuth token fields.
 * Migrates a pending-sentinel entry to the real-id key while preserving the
 * OAuth* fields written earlier by performAmplitudeAuth / performSignupOrAuth.
 */
export function updateStoredUser(
  user: StoredUser,
  configPath?: string,
): void {
  const config = readConfig(configPath);
  const pendingKey = userKey('pending', user.zone);
  const realKey = userKey(user.id, user.zone);

  if (config[pendingKey] !== undefined) {
    const entry = config[pendingKey] as Record<string, unknown>;
    if (pendingKey !== realKey) {
      delete config[pendingKey];
    }
    config[realKey] = {
      ...entry,
      User: user,
    };
    writeConfig(config, configPath);
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm vitest run src/utils/__tests__/ampli-settings.test.ts -t "updateStoredUser"
```

Expected: 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add src/utils/ampli-settings.ts src/utils/__tests__/ampli-settings.test.ts
git commit -m "feat(ampli-settings): add updateStoredUser for pending-to-real migration"
```

---

## Task 2: Handle "real-id entry already exists" (repeat-run case)

**Files:**
- Modify: `src/utils/__tests__/ampli-settings.test.ts`
- Modify: `src/utils/ampli-settings.ts`

- [ ] **Step 1: Write the failing test**

Inside the existing `describe('updateStoredUser', …)` block, add this test after the first one:

```ts
it('updates only the User field when a real-id entry already exists', () => {
  const PRESERVED = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  setupConfig({
    'User-42': {
      User: {
        id: '42',
        firstName: 'OldFirst',
        lastName: 'OldLast',
        email: 'grace@example.com',
        zone: 'us',
      },
      OAuthAccessToken: 'existing-access',
      OAuthIdToken: 'existing-id',
      OAuthRefreshToken: 'existing-refresh',
      OAuthExpiresAt: PRESERVED,
    },
  });

  updateStoredUser({ ...realUser, firstName: 'NewFirst' });

  const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
  expect(written['User-42']).toEqual({
    User: { ...realUser, firstName: 'NewFirst' },
    OAuthAccessToken: 'existing-access',
    OAuthIdToken: 'existing-id',
    OAuthRefreshToken: 'existing-refresh',
    OAuthExpiresAt: PRESERVED,
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm vitest run src/utils/__tests__/ampli-settings.test.ts -t "real-id entry already exists"
```

Expected: FAIL — `mockWriteFileSync` has 0 calls (the current implementation only writes when a pending entry exists, so the real-id-only case is a no-op and nothing is written).

- [ ] **Step 3: Extend the implementation**

In `src/utils/ampli-settings.ts`, replace the body of `updateStoredUser` with:

```ts
export function updateStoredUser(
  user: StoredUser,
  configPath?: string,
): void {
  const config = readConfig(configPath);
  const pendingKey = userKey('pending', user.zone);
  const realKey = userKey(user.id, user.zone);

  if (config[pendingKey] !== undefined) {
    const entry = config[pendingKey] as Record<string, unknown>;
    if (pendingKey !== realKey) {
      delete config[pendingKey];
    }
    config[realKey] = {
      ...entry,
      User: user,
    };
    writeConfig(config, configPath);
    return;
  }

  if (config[realKey] !== undefined) {
    const entry = config[realKey] as Record<string, unknown>;
    config[realKey] = {
      ...entry,
      User: user,
    };
    writeConfig(config, configPath);
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm vitest run src/utils/__tests__/ampli-settings.test.ts -t "updateStoredUser"
```

Expected: 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/utils/ampli-settings.ts src/utils/__tests__/ampli-settings.test.ts
git commit -m "feat(ampli-settings): handle existing real-id entry in updateStoredUser"
```

---

## Task 3: Zone isolation — pending entries under different zones don't collide

**Files:**
- Modify: `src/utils/__tests__/ampli-settings.test.ts`

- [ ] **Step 1: Write the test**

Inside the `describe('updateStoredUser', …)` block, add:

```ts
it('only migrates the pending entry matching the target zone', () => {
  const US_EXPIRES = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const EU_EXPIRES = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  setupConfig({
    'User-pending': {
      User: {
        id: 'pending',
        firstName: '',
        lastName: '',
        email: 'us-user@example.com',
        zone: 'us',
      },
      OAuthAccessToken: 'us-access',
      OAuthIdToken: 'us-id',
      OAuthRefreshToken: 'us-refresh',
      OAuthExpiresAt: US_EXPIRES,
    },
    'User[eu]-pending': {
      User: {
        id: 'pending',
        firstName: '',
        lastName: '',
        email: 'eu-user@example.com',
        zone: 'eu',
      },
      OAuthAccessToken: 'eu-access',
      OAuthIdToken: 'eu-id',
      OAuthRefreshToken: 'eu-refresh',
      OAuthExpiresAt: EU_EXPIRES,
    },
  });

  updateStoredUser({ ...realUser, zone: 'eu', id: '99', email: 'eu-user@example.com' });

  const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
  // EU pending migrated to real-id key
  expect(written['User[eu]-pending']).toBeUndefined();
  expect(written['User[eu]-99']).toBeDefined();
  expect(written['User[eu]-99'].OAuthAccessToken).toBe('eu-access');
  expect(written['User[eu]-99'].OAuthExpiresAt).toBe(EU_EXPIRES);
  // US pending untouched
  expect(written['User-pending']).toBeDefined();
  expect(written['User-pending'].OAuthAccessToken).toBe('us-access');
  expect(written['User-pending'].OAuthExpiresAt).toBe(US_EXPIRES);
});
```

- [ ] **Step 2: Run the test, verify it passes**

```bash
pnpm vitest run src/utils/__tests__/ampli-settings.test.ts -t "only migrates the pending entry matching the target zone"
```

Expected: PASS — zone scoping was already correct from Task 1's implementation (via `userKey(…, user.zone)`). This test locks it in.

- [ ] **Step 3: Commit**

```bash
git add src/utils/__tests__/ampli-settings.test.ts
git commit -m "test(ampli-settings): verify updateStoredUser zone isolation"
```

---

## Task 4: No-op when neither pending nor real-id entry exists

**Files:**
- Modify: `src/utils/__tests__/ampli-settings.test.ts`

- [ ] **Step 1: Write the test**

Inside the `describe('updateStoredUser', …)` block, add:

```ts
it('is a no-op when no matching entry exists', () => {
  setupConfig({
    'User-99': {
      User: {
        id: '99',
        firstName: 'Someone',
        lastName: 'Else',
        email: 'someone@example.com',
        zone: 'us',
      },
      OAuthAccessToken: 'other-access',
      OAuthIdToken: 'other-id',
      OAuthRefreshToken: 'other-refresh',
      OAuthExpiresAt: FUTURE,
    },
  });

  updateStoredUser(realUser);

  // No write should occur — neither pending nor real-id-42 exists
  expect(mockWriteFileSync).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test, verify it passes**

```bash
pnpm vitest run src/utils/__tests__/ampli-settings.test.ts -t "no-op when no matching entry exists"
```

Expected: PASS — the current implementation only writes inside the two `if` branches.

- [ ] **Step 3: Commit**

```bash
git add src/utils/__tests__/ampli-settings.test.ts
git commit -m "test(ampli-settings): verify updateStoredUser no-ops when no entry exists"
```

---

## Task 5: Regression test — `expiresAt` survives the full store-then-update round-trip

**Files:**
- Modify: `src/utils/__tests__/ampli-settings.test.ts`

- [ ] **Step 1: Write the test**

Inside the `describe('updateStoredUser', …)` block, add:

```ts
it('regression: real expiresAt survives store-then-update (simulates OAuth → user upgrade)', () => {
  // Simulate performAmplitudeAuth's write: pending user with the real
  // 2-hour expires_in from the token response.
  const REAL_EXPIRES_AT = new Date(Date.now() + 7200 * 1000).toISOString();
  const pendingUser: StoredUser = {
    id: 'pending',
    firstName: '',
    lastName: '',
    email: '',
    zone: 'us',
  };
  storeToken(pendingUser, {
    accessToken: 'a',
    idToken: 'i',
    refreshToken: 'r',
    expiresAt: REAL_EXPIRES_AT,
  });

  // Simulate the TUI else-branch: fetch real user, then upgrade.
  updateStoredUser(realUser);

  const retrieved = getStoredToken('42');
  expect(retrieved?.expiresAt).toBe(REAL_EXPIRES_AT);
});
```

- [ ] **Step 2: Run the test, verify it passes**

```bash
pnpm vitest run src/utils/__tests__/ampli-settings.test.ts -t "real expiresAt survives"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/utils/__tests__/ampli-settings.test.ts
git commit -m "test(ampli-settings): regression test for expiresAt preservation"
```

---

## Task 6: Swap `bin.ts:1264` — TUI else-branch

**Files:**
- Modify: `bin.ts:1264-1280`

- [ ] **Step 1: Update the import**

Find the existing dynamic import at `bin.ts:1157-1159`:

```ts
                const { storeToken } = await import(
                  './src/utils/ampli-settings.js'
                );
```

Replace with:

```ts
                const { storeToken, updateStoredUser } = await import(
                  './src/utils/ampli-settings.js'
                );
```

- [ ] **Step 2: Replace the `storeToken` call at bin.ts:1264-1280**

Find this block:

```ts
                  // Persist to ~/.ampli.json (signup path already did this)
                  storeToken(
                    {
                      id: userInfo.id,
                      firstName: userInfo.firstName,
                      lastName: userInfo.lastName,
                      email: userInfo.email,
                      zone: auth.zone,
                    },
                    {
                      accessToken: auth.accessToken,
                      idToken: auth.idToken,
                      refreshToken: auth.refreshToken,
                      expiresAt: new Date(
                        Date.now() + 3600 * 1000,
                      ).toISOString(),
                    },
                  );
```

Replace with:

```ts
                  // performAmplitudeAuth / performSignupOrAuth already persisted
                  // the tokens with the real expiresAt under the pending sentinel.
                  // Here we only need to upgrade the User record to the real user;
                  // OAuth fields (including expiresAt) must be preserved untouched.
                  updateStoredUser({
                    id: userInfo.id,
                    firstName: userInfo.firstName,
                    lastName: userInfo.lastName,
                    email: userInfo.email,
                    zone: auth.zone,
                  });
```

Note: `storeToken` is still imported because `storeToken` is still referenced elsewhere — do not remove the import.

- [ ] **Step 3: Verify the file compiles**

```bash
pnpm tsc --noEmit
```

Expected: No TypeScript errors related to `bin.ts`.

- [ ] **Step 4: Run the full test suite**

```bash
pnpm test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add bin.ts
git commit -m "fix(bin): use updateStoredUser in TUI else-branch to preserve real expiresAt"
```

---

## Task 7: Swap `bin.ts:1592` — `/login` slash command

**Files:**
- Modify: `bin.ts:1592-1606`

- [ ] **Step 1: Check the existing import for the `/login` command**

Look at the top of the `/login` command handler (search for `/login` handler or the nearby `performAmplitudeAuth({ zone })` at `bin.ts:1590`) for an existing `storeToken` import. If `storeToken` is imported from `./src/utils/ampli-settings.js` nearby, add `updateStoredUser` to the same import. If the import happens at `bin.ts` top-level (static), update that import instead.

Run this command to find the import used by this call site:

```bash
grep -n "from '\./src/utils/ampli-settings" bin.ts
```

Add `updateStoredUser` to whichever `ampli-settings.js` import governs the `/login` handler scope.

- [ ] **Step 2: Replace the `storeToken` call at bin.ts:1592-1606**

Find this block:

```ts
          const auth = await performAmplitudeAuth({ zone });
          const user = await fetchAmplitudeUser(auth.idToken, auth.zone);
          storeToken(
            {
              id: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email,
              zone: auth.zone,
            },
            {
              accessToken: auth.accessToken,
              idToken: auth.idToken,
              refreshToken: auth.refreshToken,
              expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
            },
          );
```

Replace with:

```ts
          const auth = await performAmplitudeAuth({ zone });
          const user = await fetchAmplitudeUser(auth.idToken, auth.zone);
          // performAmplitudeAuth already wrote tokens with the real expiresAt
          // under the pending sentinel. Upgrade the User record only; leave
          // OAuth fields (including expiresAt) untouched.
          updateStoredUser({
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            zone: auth.zone,
          });
```

- [ ] **Step 3: Verify the file compiles**

```bash
pnpm tsc --noEmit
```

Expected: No TypeScript errors.

- [ ] **Step 4: Run the full test suite**

```bash
pnpm test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add bin.ts
git commit -m "fix(bin): use updateStoredUser in /login to preserve real expiresAt"
```

---

## Task 8: Final verification + lint + PR prep

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
```

Expected: All tests pass.

- [ ] **Step 2: Run lint**

```bash
pnpm lint
```

Expected: No errors. If there are auto-fixable issues:

```bash
pnpm fix
```

Then re-run `pnpm lint` to confirm clean.

- [ ] **Step 3: Run TypeScript build to catch any remaining type errors**

```bash
pnpm build
```

Expected: Clean build.

- [ ] **Step 4: Verify no other 1h-hardcode `storeToken` call sites remain**

```bash
grep -rn "3600 \* 1000" bin.ts src/
```

Expected: No matches (or only unrelated matches — verify each).

- [ ] **Step 5: Verify no other `storeToken` call supplies a fabricated `expiresAt` that should have used the real one**

```bash
grep -rn "storeToken(" bin.ts src/ | grep -v "test"
```

Expected: Three remaining call sites, all legitimate:
- `src/utils/oauth.ts` — uses `tokenResponse.expires_in` (correct)
- `src/utils/signup-or-auth.ts` — uses `result.tokens.expiresAt` from DirectSignup (correct)
- Test files — excluded by grep

- [ ] **Step 6: Review the full diff**

```bash
git log --oneline feat/direct-signup-v2..HEAD
git diff feat/direct-signup-v2...HEAD
```

Expected: Seven commits (one per task 1-7), clean focused diff in `src/utils/ampli-settings.ts`, `src/utils/__tests__/ampli-settings.test.ts`, and `bin.ts`.

- [ ] **Step 7: Push and open PR**

```bash
git push -u origin followup/token-expiresAt-persistence
gh pr create --base feat/direct-signup-v2 --title "fix(token-persistence): persist real expiresAt instead of 1h hardcode" --body "$(cat <<'EOF'
## Summary

Follow-up to #165. Two TUI-mode credential-persistence call sites (`bin.ts:1264` and `bin.ts:1592`) hardcoded a 1-hour `expiresAt` when calling `storeToken`, overwriting the real OAuth expiry that had just been written by `performAmplitudeAuth` / `performSignupOrAuth`.

**Approach:** Added `updateStoredUser(user)` for the pending-sentinel → real-user migration. It preserves the `OAuth*` fields written earlier, so callers without fresh tokens can upgrade the User record without fabricating token metadata.

**Scope:**
- `src/utils/ampli-settings.ts` — new `updateStoredUser` function
- `bin.ts:1264` — TUI else-branch, covers Case B (signup → pending upgrade) and Case C (plain browser OAuth)
- `bin.ts:1592` — `/login` slash command (third call site with identical hardcode)

**Not in scope:** `token-refresh.ts` logic, `AmplitudeAuthResult` shape, `storeToken` signature — all unchanged.

Severity was Low in practice (refresh absorbed the inaccuracy), but worth fixing for correctness hygiene and to prevent future readers of `expiresAt` from inheriting the wrong value.

## Test plan

- [x] Unit tests for `updateStoredUser` (pending migration, real-id overwrite, zone isolation, no-op cases)
- [x] Regression test: `storeToken` with real `expiresAt` → `updateStoredUser` → `getStoredToken` preserves `expiresAt` byte-identical
- [x] Full suite passes
- [ ] Manual: run through TUI signup flow, verify `~/.ampli.json` `OAuthExpiresAt` reflects real value (not now+1h)
- [ ] Manual: run `/login` slash command, same verification

## Design doc

`docs/superpowers/specs/2026-04-21-token-expiresat-persistence-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR created, URL returned.

---

## Self-Review Notes

Coverage map (spec requirement → task):

- "New `updateStoredUser(user)` function" → Tasks 1-2 (build + extend)
- "Pending migration, preserve OAuth*" → Task 1
- "Real-id already-exists, partial update" → Task 2
- "Zone scoping" → Task 3
- "Neither exists: log-and-no-op" → Task 4 (no-op; logging deemed unnecessary — the condition is unreachable in practice and a silent no-op is fine)
- "Atomic write via writeConfig" → inherited from existing `writeConfig` (used in Task 1 impl)
- "bin.ts:1264 swap" → Task 6
- "bin.ts:1592 swap" → Task 7
- "signup-or-auth.ts:184 unchanged" → verified in Task 8 Step 5
- "storeToken signature unchanged" → never touched in any task
- "Unit test: pending migration preserves OAuth*" → Task 1
- "Unit test: existing real-id entry" → Task 2
- "Unit test: zone isolation" → Task 3
- "Regression test at persistence boundary" → Task 5 (uses real `storeToken` → `updateStoredUser` → `getStoredToken` round-trip, which exercises the same invariant as the spec's "stub `exchangeCodeForToken`" version with far less test infrastructure)
- "token-refresh.ts untouched" → never touched
- "AmplitudeAuthResult shape unchanged" → never touched
