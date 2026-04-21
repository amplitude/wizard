# Agentic Signup Attempted Telemetry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit a `wizard cli: agentic signup attempted` Amplitude event once per actual direct-signup attempt, with a `status` property covering every attempt exit, plus a `signup` boolean on the existing `session started` event so attempt-rate and end-to-end conversion funnels can be computed.

**Architecture:** Wrapper-internal emission in `src/utils/signup-or-auth.ts` (the only layer with visibility into every exit). The post-signup `fetchUserWithProvisioningRetry` helper is refactored to return a discriminated union (never throws) so the wrapper can drive both `success` and `user_fetch_failed` emissions without duplicating try/catch. `bin.ts:runDirectSignupIfRequested` adds a single belt-and-suspenders `wrapper_exception` emission in its outer catch. `src/run.ts` gets a one-line addition to `session started`. No other files touched.

**Tech Stack:** TypeScript, vitest, existing `analytics.wizardCapture` infrastructure in `src/utils/analytics.ts`.

**Spec:** `docs/superpowers/specs/2026-04-21-signup-outcome-telemetry-design.md`

---

## File Structure

| File | Responsibility | Change type |
|---|---|---|
| `src/run.ts` | Add `signup` prop to `session started` event | Modify (one line) |
| `src/__tests__/run.test.ts` | Assert `signup` prop on `session started` | Modify (add test) |
| `src/utils/signup-or-auth.ts` | Refactor fetch helper; add `emitAttempted` helper; emit at each exit | Modify |
| `src/utils/__tests__/signup-or-auth.test.ts` | Assert emission at each status path + non-emission on gated paths | Modify |
| `bin.ts` | Emit `wrapper_exception` in the outer catch of `runDirectSignupIfRequested` | Modify (small) |
| `src/__tests__/cli.test.ts` | Assert `wrapper_exception` emission when wrapper throws | Modify (add test) |

No new files. No renames.

---

## Task 1: Add `signup` prop to `session started`

**Files:**
- Modify: `src/run.ts:81-84`
- Modify: `src/__tests__/run.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `src/__tests__/run.test.ts` inside the existing `describe('runWizard error handling', ...)` block (or a new adjacent `describe`). Place it AFTER the two existing `it(...)` blocks, before the final closing `});` of the describe:

```ts
  it('passes signup=true to session started when session.signup is set', async () => {
    mockAnalytics.wizardCapture = vi.fn();
    const testArgs = {
      integration: Integration.nextjs,
      signup: true,
    };

    mockRunAgentWizard.mockResolvedValue(undefined);

    await runWizard(testArgs);

    expect(mockAnalytics.wizardCapture).toHaveBeenCalledWith(
      'session started',
      expect.objectContaining({ signup: true }),
    );
  });

  it('passes signup=false to session started when session.signup is unset', async () => {
    mockAnalytics.wizardCapture = vi.fn();
    const testArgs = {
      integration: Integration.nextjs,
    };

    mockRunAgentWizard.mockResolvedValue(undefined);

    await runWizard(testArgs);

    expect(mockAnalytics.wizardCapture).toHaveBeenCalledWith(
      'session started',
      expect.objectContaining({ signup: false }),
    );
  });
```

The `buildSession` mock at the top of the file already defaults `signup: false` and spreads `...args`, so passing `signup: true` through `testArgs` reaches `session.signup`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/run.test.ts`

Expected: both new tests FAIL with something like `expected "session started", { integration, ci } to match { signup: true }` — because `session started` is currently emitted without the `signup` property.

- [ ] **Step 3: Add the `signup` prop to the emission**

In `src/run.ts`, update the `session started` wizardCapture call (currently at line 81):

```ts
  analytics.wizardCapture('session started', {
    integration,
    ci: session.ci ?? false,
    signup: session.signup ?? false,
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/__tests__/run.test.ts`

Expected: all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add src/run.ts src/__tests__/run.test.ts
git commit -m "feat(telemetry): add signup prop to session started event"
```

---

## Task 2: Refactor `fetchUserWithProvisioningRetry` to return `{ ok, ... }` discriminated union

**Files:**
- Modify: `src/utils/signup-or-auth.ts`

No test changes in this task — the existing tests already cover the behavior and must continue to pass. This refactor is a prerequisite for Tasks 3 and 5 (it surfaces `retryCount` and `hasEnvWithApiKey` to the caller so they can be emitted).

- [ ] **Step 1: Replace `fetchUserWithProvisioningRetry` with the new discriminated-union version**

In `src/utils/signup-or-auth.ts`, replace lines 22-64 (the `fetchUserWithProvisioningRetry` function and its JSDoc) with:

```ts
type FetchUserResult =
  | {
      ok: true;
      userInfo: AmplitudeUserInfo;
      retryCount: number;
      hasEnvWithApiKey: boolean;
    }
  | { ok: false; retryCount: number; error: unknown };

/**
 * After a successful direct signup, the backend may not have finished
 * provisioning the default org/workspace/environment. Retry the user
 * fetch a few times so downstream credential resolution finds an env
 * with a project API key, instead of mis-reporting "no_stored_credentials".
 *
 * Retries on both "returned but no env with apiKey" and "threw" — the
 * Data API throws "No user data returned" when orgs is empty, which is
 * the most-likely brand-new-signup race condition. Returns a discriminated
 * union so the caller can drive telemetry (retry count, env-with-apikey
 * flag) without duplicating try/catch. Never throws.
 */
async function fetchUserWithProvisioningRetry(
  idToken: string,
  zone: AmplitudeZone,
): Promise<FetchUserResult> {
  let userInfo: AmplitudeUserInfo | null = null;
  let lastError: unknown = null;
  let retryCount = 0;
  try {
    userInfo = await fetchAmplitudeUser(idToken, zone);
  } catch (err) {
    lastError = err;
  }
  for (const delayMs of PROVISIONING_RETRY_DELAYS_MS) {
    if (userInfo && hasEnvWithApiKey(userInfo)) {
      return { ok: true, userInfo, retryCount, hasEnvWithApiKey: true };
    }
    log.debug('signup provisioning incomplete; retrying user fetch', {
      delayMs,
      threw: lastError !== null,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    retryCount += 1;
    try {
      userInfo = await fetchAmplitudeUser(idToken, zone);
      lastError = null;
    } catch (err) {
      // Keep any prior successful userInfo — losing it here would make us
      // fall back to the pending sentinel when we already have real user
      // data from an earlier attempt that just didn't yet have an env.
      lastError = err;
    }
  }
  if (userInfo) {
    return {
      ok: true,
      userInfo,
      retryCount,
      hasEnvWithApiKey: hasEnvWithApiKey(userInfo),
    };
  }
  return { ok: false, retryCount, error: lastError };
}
```

- [ ] **Step 2: Update the caller in `performSignupOrAuth`**

In `src/utils/signup-or-auth.ts`, replace the block currently at lines 157-183 (the `try { userInfo = await fetchUserWithProvisioningRetry(...); user = {...} } catch { ... pending sentinel ... }`) with:

```ts
  let userInfo: AmplitudeUserInfo | null = null;
  let user: StoredUser;
  const fetchResult = await fetchUserWithProvisioningRetry(
    tokens.idToken,
    input.zone,
  );
  if (fetchResult.ok) {
    userInfo = fetchResult.userInfo;
    user = {
      id: userInfo.id,
      firstName: userInfo.firstName,
      lastName: userInfo.lastName,
      email: userInfo.email,
      zone: input.zone,
    };
  } else {
    log.warn(
      'fetchAmplitudeUser failed after direct signup; falling back to pending sentinel',
      {
        zone: input.zone,
      },
    );
    const parts = input.fullName.trim().split(/\s+/);
    user = {
      id: 'pending',
      firstName: parts[0] ?? '',
      lastName: parts.slice(1).join(' '),
      email: input.email,
      zone: input.zone,
    };
  }
  storeToken(user, tokens);
```

- [ ] **Step 3: Run existing tests to verify no behavior regression**

Run: `pnpm test src/utils/__tests__/signup-or-auth.test.ts`

Expected: all 10 existing tests pass. If any fail, the refactor introduced a regression — fix before committing.

- [ ] **Step 4: Commit**

```bash
git add src/utils/signup-or-auth.ts
git commit -m "refactor(signup-or-auth): return discriminated union from fetch retry helper"
```

---

## Task 3: Add `emitAttempted` helper and emit `status: success`

**Files:**
- Modify: `src/utils/signup-or-auth.ts`
- Modify: `src/utils/__tests__/signup-or-auth.test.ts`

- [ ] **Step 1: Add analytics mock setup to the test file**

In `src/utils/__tests__/signup-or-auth.test.ts`, after the existing `vi.mock` calls at the top (after line 16), add:

```ts
vi.mock('../analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
  },
}));
```

- [ ] **Step 2: Write the failing test for success emission**

In `src/utils/__tests__/signup-or-auth.test.ts`, add this test inside the existing `describe('performSignupOrAuth', ...)` block, immediately after the test titled `'returns tokens on success without calling OAuth'` (around line 152):

```ts
  it('emits agentic signup attempted with status=success on the success path', async () => {
    const { isFlagEnabled } = await import('../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(true);
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'success',
      tokens: {
        accessToken: 'a',
        idToken: 'i',
        refreshToken: 'r',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        zone: 'us',
      },
    });
    const { fetchAmplitudeUser } = await import('../../lib/api.js');
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      id: 'user-123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      orgs: provisionedOrgs,
    });
    const { analytics } = await import('../analytics');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'agentic signup attempted',
      {
        status: 'success',
        zone: 'us',
        'has env with api key': true,
        'user fetch retry count': 0,
      },
    );
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/utils/__tests__/signup-or-auth.test.ts -t "status=success"`

Expected: FAIL — `analytics.wizardCapture` was not called (the emission helper doesn't exist yet).

- [ ] **Step 4: Add the `emitAttempted` helper**

In `src/utils/signup-or-auth.ts`, add this import near the top (next to existing imports from `./` or `../lib/`):

```ts
import { analytics } from './analytics.js';
```

Then add this helper and its type just above the `export interface SignupOrAuthInput` block (around line 66):

```ts
type SignupAttemptStatus =
  | 'success'
  | 'requires_redirect'
  | 'signup_error'
  | 'user_fetch_failed';

function emitAttempted(
  status: SignupAttemptStatus,
  zone: AmplitudeZone,
  extras: { hasEnvWithApiKey?: boolean; userFetchRetryCount?: number } = {},
): void {
  const props: Record<string, unknown> = { status, zone };
  if (extras.hasEnvWithApiKey !== undefined) {
    props['has env with api key'] = extras.hasEnvWithApiKey;
  }
  if (extras.userFetchRetryCount !== undefined) {
    props['user fetch retry count'] = extras.userFetchRetryCount;
  }
  analytics.wizardCapture('agentic signup attempted', props);
}
```

- [ ] **Step 5: Emit on the success branch**

In `src/utils/signup-or-auth.ts`, inside the `if (fetchResult.ok) { ... }` block (added in Task 2, Step 2), after building `user` and before the `else` branch is entered, add an emission call. The modified block:

```ts
  if (fetchResult.ok) {
    userInfo = fetchResult.userInfo;
    user = {
      id: userInfo.id,
      firstName: userInfo.firstName,
      lastName: userInfo.lastName,
      email: userInfo.email,
      zone: input.zone,
    };
    emitAttempted('success', input.zone, {
      hasEnvWithApiKey: fetchResult.hasEnvWithApiKey,
      userFetchRetryCount: fetchResult.retryCount,
    });
  } else {
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test src/utils/__tests__/signup-or-auth.test.ts -t "status=success"`

Expected: PASS. Also run the full file to ensure no regression: `pnpm test src/utils/__tests__/signup-or-auth.test.ts` — all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/utils/signup-or-auth.ts src/utils/__tests__/signup-or-auth.test.ts
git commit -m "feat(telemetry): emit agentic signup attempted status=success"
```

---

## Task 4: Emit `status: requires_redirect`

**Files:**
- Modify: `src/utils/signup-or-auth.ts`
- Modify: `src/utils/__tests__/signup-or-auth.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/utils/__tests__/signup-or-auth.test.ts`, immediately after the existing test `'returns null when direct signup returns requires_redirect'` (around line 99), add:

```ts
  it('emits agentic signup attempted with status=requires_redirect on redirect path', async () => {
    const { isFlagEnabled } = await import('../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(true);
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'requires_redirect',
    });
    const { analytics } = await import('../analytics');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'agentic signup attempted',
      { status: 'requires_redirect', zone: 'us' },
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/utils/__tests__/signup-or-auth.test.ts -t "status=requires_redirect"`

Expected: FAIL — no emission at that path yet.

- [ ] **Step 3: Split the `result.kind !== 'success'` branch to emit**

In `src/utils/signup-or-auth.ts`, replace the current non-success branch:

```ts
  if (result.kind !== 'success') {
    log.debug('direct signup did not succeed', { kind: result.kind });
    return null;
  }
```

with:

```ts
  if (result.kind === 'requires_redirect') {
    log.debug('direct signup did not succeed', { kind: result.kind });
    emitAttempted('requires_redirect', input.zone);
    return null;
  }
  if (result.kind === 'error') {
    log.debug('direct signup did not succeed', { kind: result.kind });
    emitAttempted('signup_error', input.zone);
    return null;
  }
```

(The `signup_error` case here is implemented in this same step but its test lives in Task 5. Both branches are needed now because the wrapper's `result` type only admits `success | requires_redirect | error`, and TypeScript narrowing requires handling all of them.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/utils/__tests__/signup-or-auth.test.ts -t "status=requires_redirect"`

Expected: PASS.

Run the full file too: `pnpm test src/utils/__tests__/signup-or-auth.test.ts` — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/signup-or-auth.ts src/utils/__tests__/signup-or-auth.test.ts
git commit -m "feat(telemetry): emit agentic signup attempted status=requires_redirect"
```

---

## Task 5: Emit `status: signup_error` (both direct-signup error kind AND wrapper-caught throw)

**Files:**
- Modify: `src/utils/signup-or-auth.ts`
- Modify: `src/utils/__tests__/signup-or-auth.test.ts`

The `result.kind === 'error'` branch emission was already added in Task 4 to satisfy exhaustive narrowing. Task 5 adds the test for it, then the wrapper-caught-throw emission and its test.

- [ ] **Step 1: Write the test for `result.kind === 'error'` path**

In `src/utils/__tests__/signup-or-auth.test.ts`, immediately after the existing test `'returns null when direct signup returns error'`, add:

```ts
  it('emits agentic signup attempted with status=signup_error on error kind', async () => {
    const { isFlagEnabled } = await import('../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(true);
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'error',
      message: 'boom',
    });
    const { analytics } = await import('../analytics');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'agentic signup attempted',
      { status: 'signup_error', zone: 'us' },
    );
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm test src/utils/__tests__/signup-or-auth.test.ts -t "status=signup_error on error kind"`

Expected: PASS (the branch emission was added in Task 4 Step 3).

- [ ] **Step 3: Write the failing test for the thrown-exception path**

Immediately after the test from Step 1, add:

```ts
  it('emits agentic signup attempted with status=signup_error when performDirectSignup throws', async () => {
    const { isFlagEnabled } = await import('../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(true);
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockRejectedValue(new Error('network'));
    const { analytics } = await import('../analytics');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'agentic signup attempted',
      { status: 'signup_error', zone: 'us' },
    );
  });
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test src/utils/__tests__/signup-or-auth.test.ts -t "when performDirectSignup throws"`

Expected: FAIL — the wrapper's existing try/catch around `performDirectSignup` returns null without emitting.

- [ ] **Step 5: Add emission to the wrapper's try/catch around `performDirectSignup`**

In `src/utils/signup-or-auth.ts`, update the existing try/catch (currently lines 127-138):

```ts
  let result: Awaited<ReturnType<typeof performDirectSignup>>;
  try {
    result = await performDirectSignup({
      email: input.email,
      fullName: input.fullName,
      zone: input.zone,
    });
  } catch (err) {
    log.warn('direct signup threw unexpectedly', {
      message: err instanceof Error ? err.message : String(err),
    });
    emitAttempted('signup_error', input.zone);
    return null;
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test src/utils/__tests__/signup-or-auth.test.ts -t "when performDirectSignup throws"`

Expected: PASS.

Run the full file: `pnpm test src/utils/__tests__/signup-or-auth.test.ts` — all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/utils/signup-or-auth.ts src/utils/__tests__/signup-or-auth.test.ts
git commit -m "feat(telemetry): emit agentic signup attempted status=signup_error"
```

---

## Task 6: Emit `status: user_fetch_failed`

**Files:**
- Modify: `src/utils/signup-or-auth.ts`
- Modify: `src/utils/__tests__/signup-or-auth.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/utils/__tests__/signup-or-auth.test.ts`, immediately after the existing test `'falls back to pending sentinel when fetchAmplitudeUser fails after direct-signup success'`, add:

```ts
  it('emits agentic signup attempted with status=user_fetch_failed when fetch retries exhaust', async () => {
    vi.useFakeTimers();
    try {
      const { isFlagEnabled } = await import('../../lib/feature-flags.js');
      vi.mocked(isFlagEnabled).mockReturnValue(true);
      const { performDirectSignup } = await import('../direct-signup.js');
      vi.mocked(performDirectSignup).mockResolvedValue({
        kind: 'success',
        tokens: {
          accessToken: 'a',
          idToken: 'i',
          refreshToken: 'r',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          zone: 'us',
        },
      });
      const { fetchAmplitudeUser } = await import('../../lib/api.js');
      vi.mocked(fetchAmplitudeUser).mockRejectedValue(new Error('network'));
      const { analytics } = await import('../analytics');

      const pending = performSignupOrAuth({
        email: 'ada@example.com',
        fullName: 'Ada Lovelace',
        zone: 'us',
      });
      await vi.runAllTimersAsync();
      await pending;

      expect(analytics.wizardCapture).toHaveBeenCalledWith(
        'agentic signup attempted',
        {
          status: 'user_fetch_failed',
          zone: 'us',
          'user fetch retry count': 3,
        },
      );
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/utils/__tests__/signup-or-auth.test.ts -t "status=user_fetch_failed"`

Expected: FAIL — the pending-sentinel branch doesn't emit.

- [ ] **Step 3: Add emission to the pending-sentinel branch**

In `src/utils/signup-or-auth.ts`, inside the `else` branch of `if (fetchResult.ok)` (the pending-sentinel branch), after the `user = { id: 'pending', ... }` assignment and before the branch closes, add:

```ts
    emitAttempted('user_fetch_failed', input.zone, {
      userFetchRetryCount: fetchResult.retryCount,
    });
```

The updated `else` branch:

```ts
  } else {
    log.warn(
      'fetchAmplitudeUser failed after direct signup; falling back to pending sentinel',
      {
        zone: input.zone,
      },
    );
    const parts = input.fullName.trim().split(/\s+/);
    user = {
      id: 'pending',
      firstName: parts[0] ?? '',
      lastName: parts.slice(1).join(' '),
      email: input.email,
      zone: input.zone,
    };
    emitAttempted('user_fetch_failed', input.zone, {
      userFetchRetryCount: fetchResult.retryCount,
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/utils/__tests__/signup-or-auth.test.ts -t "status=user_fetch_failed"`

Expected: PASS.

Run the full file: `pnpm test src/utils/__tests__/signup-or-auth.test.ts` — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/signup-or-auth.ts src/utils/__tests__/signup-or-auth.test.ts
git commit -m "feat(telemetry): emit agentic signup attempted status=user_fetch_failed"
```

---

## Task 7: Lock in non-emission for `flag_off` and `missing_inputs`

**Files:**
- Modify: `src/utils/__tests__/signup-or-auth.test.ts`

- [ ] **Step 1: Extend the three existing gating tests to assert non-emission**

In `src/utils/__tests__/signup-or-auth.test.ts`, find the three existing tests:
1. `'returns null when flag is off'`
2. `'returns null when flag is on but email is missing'`
3. `'returns null when flag is on but fullName is missing'`

For each, add an assertion that `analytics.wizardCapture` was not called with `'agentic signup attempted'`. Example updated first test:

```ts
  it('returns null when flag is off', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    const { analytics } = await import('../analytics');

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
    expect(result).toBeNull();
    expect(analytics.wizardCapture).not.toHaveBeenCalledWith(
      'agentic signup attempted',
      expect.anything(),
    );
  });
```

Apply the same `expect(...).not.toHaveBeenCalledWith('agentic signup attempted', ...)` assertion to the two missing-input tests.

- [ ] **Step 2: Run the three tests**

Run: `pnpm test src/utils/__tests__/signup-or-auth.test.ts -t "returns null when"`

Expected: PASS for all three. If any fail, the wrapper is erroneously emitting on a gated path — fix before committing.

- [ ] **Step 3: Commit**

```bash
git add src/utils/__tests__/signup-or-auth.test.ts
git commit -m "test(telemetry): lock in non-emission on flag_off and missing_inputs paths"
```

---

## Task 8: Emit `status: wrapper_exception` from `bin.ts`

**Files:**
- Modify: `bin.ts`
- Modify: `src/__tests__/cli.test.ts`

Context: `bin.ts:runDirectSignupIfRequested` has an outer try/catch around `performSignupOrAuth` that currently only logs a warning. A wrapper-internal throw (rare — essentially only `storeToken` failure) skips the in-wrapper emission entirely. One emission here closes that gap.

- [ ] **Step 1: Add the emission line to `bin.ts:runDirectSignupIfRequested`**

In `bin.ts`, find the outer catch inside `runDirectSignupIfRequested` (currently around line 506). Update the catch body to emit before the existing `log.warn`:

```ts
  } catch (err) {
    analytics.wizardCapture('agentic signup attempted', {
      status: 'wrapper_exception',
      zone,
    });
    getUI().log.warn(
      `Direct signup errored: ${
        err instanceof Error ? err.message : String(err)
      }. Continuing to ${fallbackLabel}.`,
    );
  }
```

Note: `analytics` is already imported in `bin.ts` (it's used earlier in the file for `analytics.setSessionProperty`, `analytics.applyOptOut`, etc.). No new import needed — verify by scanning the top of `bin.ts` for `import { analytics }`. If not imported at the top level, add: `import { analytics } from './src/utils/analytics.js';` near the other top-level imports.

- [ ] **Step 2: Add a mock for `signup-or-auth` to `cli.test.ts`**

In `src/__tests__/cli.test.ts`, find the block of `vi.mock(...)` calls near the top of the file (around lines 100-150). Add this mock alongside the others:

```ts
vi.mock('../utils/signup-or-auth', () => ({
  performSignupOrAuth: vi.fn(),
}));
```

- [ ] **Step 3: Write the failing test**

In `src/__tests__/cli.test.ts`, find the `describe` block that contains the existing `--email` / `--full-name` tests (the one containing `test('accepts --email and --full-name on the default command', ...)` around line 840). Add this test inside that block, after the existing `'accepts --email and --full-name'` test, before the block's closing `});`:

```ts
  test('emits agentic signup attempted with status=wrapper_exception when wrapper throws', async () => {
    const { performSignupOrAuth } = await import('../utils/signup-or-auth');
    const { analytics } = await import('../utils/analytics');
    vi.mocked(performSignupOrAuth).mockRejectedValueOnce(new Error('boom'));

    await runCLI([
      '--signup',
      '--ci',
      '--email',
      'ada@example.com',
      '--full-name',
      'Ada Lovelace',
      '--install-dir',
      '/tmp/test',
    ]);

    await waitFor(() =>
      (analytics.wizardCapture as ReturnType<typeof vi.fn>).mock.calls.some(
        (c) => c[0] === 'agentic signup attempted',
      ),
    );

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'agentic signup attempted',
      expect.objectContaining({ status: 'wrapper_exception' }),
    );
  });
```

The `runCLI` and `waitFor` helpers are already defined at the top of `cli.test.ts` (lines 158 and 166). No new helpers needed.

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test src/__tests__/cli.test.ts -t "wrapper_exception"`

Expected: FAIL (or timeout on `waitFor`) — the emission line isn't in `bin.ts` yet or Step 1 wasn't applied.

If Step 1 was already applied and the test still fails, `runDirectSignupIfRequested` may not be reached under the test harness. In that case, move the test to a targeted file `src/__tests__/run-direct-signup-if-requested.test.ts` that imports and invokes the helper directly — but prefer the `cli.test.ts` location if it works.

- [ ] **Step 5: Run test to verify it passes**

After Step 1 has been applied, run: `pnpm test src/__tests__/cli.test.ts -t "wrapper_exception"`

Expected: PASS.

Also run the full CLI test file to catch regressions: `pnpm test src/__tests__/cli.test.ts` — all tests pass.

- [ ] **Step 6: Commit**

```bash
git add bin.ts src/__tests__/cli.test.ts
git commit -m "feat(telemetry): emit agentic signup attempted status=wrapper_exception"
```

---

## Task 9: Final verification

**Files:** none modified — this task is the final safety net.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`

Expected: all tests pass (including the baseline 1120 from before this work, plus the ~9 new tests added across Tasks 1, 3, 4, 5, 6, 8). No skipped tests beyond the pre-existing skipped count.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`

Expected: clean. If failures, run `pnpm fix` and re-check.

- [ ] **Step 3: Verify no PII properties were introduced**

Run:

```bash
grep -n "email\|fullName\|full_name\|full name" src/utils/signup-or-auth.ts | grep -v "^//\|\* "
```

Confirm no hits reference event properties — the only allowed references are to `input.email`, `input.fullName`, `userInfo.email`, `userInfo.firstName`, `userInfo.lastName` used to build `StoredUser` (not analytics). If any line looks like it's being passed to `wizardCapture`, stop and remove.

- [ ] **Step 4: Build to confirm TypeScript clean**

Run: `pnpm build`

Expected: clean build, no TS errors.

- [ ] **Step 5: Final commit (if any cleanup)**

If Steps 1-4 produced no changes, skip. Otherwise:

```bash
git add -A
git commit -m "chore(telemetry): final cleanup"
```

---

## Post-implementation (not part of the plan)

After the plan is executed:

1. Push the branch.
2. Open a PR against `feat/direct-signup-v2` (not `main`).
3. Close or retarget draft PR #181 with a link to the new PR.
4. In the PR description: name a dashboard owner who will stand up the "direct signup ramp health" Amplitude chart set before the flag moves off 0%.
