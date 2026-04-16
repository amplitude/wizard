# Direct Signup — PR 4: Classic Mode

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.
>
> **This is PR 4 of 5.** Requires PR 1 (Foundation) merged; independent of PRs 2–3.

**Goal:** In classic mode (`--classic` or `AMPLITUDE_WIZARD_CLASSIC=1`), route the auth call through `performSignupOrAuth()` so direct signup is attempted when `--signup` + `--email` + `--full-name` + flag are all present.

**Architecture:** Classic mode invokes `lazyRunWizard(options)` directly (bin.ts:375), which triggers `runWizard()` in `src/run.ts`. The OAuth call happens downstream in `src/utils/setup-utils.ts` or equivalent. Replace the `performAmplitudeAuth()` call site with `performSignupOrAuth()`, passing `session.signup`, `session.signupEmail`, `session.signupFullName`.

**Tech Stack:** TypeScript, vitest.

---

## File Structure

**Modify:**
- Classic-mode auth call site (location determined in Task 1; likely `src/utils/setup-utils.ts` — grep to confirm)

**Tests:**
- `src/__tests__/signup-classic.test.ts` (new)

---

## Task 1: Locate the Classic-Mode OAuth Call Site

- [ ] **Step 1: Grep for OAuth call sites outside bin.ts**

Run:

```bash
grep -rn "performAmplitudeAuth\|performOAuthFlow" src/ | grep -v __tests__ | grep -v bin.ts
```

Expected: one or two hits. Note the file and line number — this is where classic mode enters the OAuth flow.

- [ ] **Step 2: Read the call site in context**

Open the file identified in Step 1. Read ~20 lines around the call to understand how `zone` and `forceFresh` are determined, and what the returned `auth` value is used for.

- [ ] **Step 3: Record findings**

Add a note at the top of this plan (or in your PR description) with:
- File path + line number
- Variables passed to `performAmplitudeAuth` today
- Variables available in scope for `session.signup`, `session.signupEmail`, `session.signupFullName`

---

## Task 2: Integration Test — Classic Mode with Direct Signup

**Files:**
- Create: `src/__tests__/signup-classic.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/signup-classic.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/feature-flags.js', () => ({
  FLAG_DIRECT_SIGNUP: 'wizard-direct-signup',
  isFlagEnabled: vi.fn((key: string) => key === 'wizard-direct-signup'),
  initFeatureFlags: vi.fn(async () => {}),
}));

vi.mock('../utils/direct-signup.js', () => ({
  performDirectSignup: vi.fn(async () => ({
    kind: 'success',
    tokens: {
      accessToken: 'classic-access',
      idToken: 'classic-id',
      refreshToken: 'classic-refresh',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      zone: 'us',
    },
  })),
}));

describe('classic mode + --signup + direct signup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses direct signup when flag on and email/fullName provided', async () => {
    const { performSignupOrAuth } = await import('../utils/signup-or-auth.js');

    const auth = await performSignupOrAuth({
      signup: true,
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    const { performDirectSignup } = await import('../utils/direct-signup.js');
    expect(performDirectSignup).toHaveBeenCalledOnce();
    expect(auth.accessToken).toBe('classic-access');
  });

  it('falls through to OAuth when --signup not set (parity)', async () => {
    const { performDirectSignup } = await import('../utils/direct-signup.js');
    vi.mocked(performDirectSignup).mockClear();

    const { performSignupOrAuth } = await import('../utils/signup-or-auth.js');
    // Mock oauth to avoid an actual browser flow
    vi.doMock('../utils/oauth.js', () => ({
      performAmplitudeAuth: vi.fn(async () => ({
        accessToken: 'oauth',
        idToken: 'oauth',
        refreshToken: 'oauth',
        zone: 'us' as const,
      })),
    }));

    await performSignupOrAuth({
      signup: false,
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — PASS**

Run: `pnpm vitest run src/__tests__/signup-classic.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/signup-classic.test.ts
git commit -m "test: add classic-mode signup integration test"
```

---

## Task 3: Replace Classic-Mode OAuth Call With Wrapper

**Files:**
- Modify: the file identified in Task 1 Step 1

- [ ] **Step 1: Swap the call**

At the call site identified in Task 1, replace:

```typescript
const auth = await performAmplitudeAuth({ zone, forceFresh });
```

with:

```typescript
const { performSignupOrAuth } = await import('./signup-or-auth.js');
const auth = await performSignupOrAuth({
  signup: session.signup,
  email: session.signupEmail,
  fullName: session.signupFullName,
  zone,
  forceFresh,
});
```

Adjust the relative import path as needed for the file's location. The return shape is identical to `performAmplitudeAuth`, so no downstream code changes.

If `session` is not already in scope at the call site, pass it through from the caller — classic mode threads the session object through `runWizard(options, session)`, so it should be accessible. Grep to confirm:

```bash
grep -n "session:" src/utils/setup-utils.ts | head
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: clean.

- [ ] **Step 3: Full test suite**

Run: `pnpm test`
Expected: all pass. Any existing test that mocks `performAmplitudeAuth` may need to also mock `performSignupOrAuth` — update as needed.

- [ ] **Step 4: BDD suite**

Run: `pnpm test:bdd`
Expected: all pass.

- [ ] **Step 5: Manual smoke test — flag off (parity)**

```bash
node dist/bin.js --classic --signup --email ada@example.com --full-name "Ada Lovelace"
```

Expected: browser opens for OAuth as it does today; no direct-signup network call.

- [ ] **Step 6: Manual smoke test — flag on**

```bash
AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP=1 node dist/bin.js --classic --signup --email ada@example.com --full-name "Ada Lovelace"
```

Expected:
- On success: no browser opens; classic flow proceeds with tokens from direct signup.
- On `requires_redirect`: browser opens for OAuth as a fallback.

- [ ] **Step 7: Commit**

```bash
git add <file-from-task-1>
git commit -m "feat: wire direct signup into classic mode"
```

---

## Task 4: Verify Flag-Off Parity

**Files:** none.

- [ ] **Step 1: Baseline diff**

Capture the classic-mode stdout from a pre-PR-4 build and a post-PR-4 build with the flag off, and diff:

```bash
git stash  # stash PR 4 changes
pnpm build
node dist/bin.js --classic --signup --email ... --full-name ... > /tmp/before.txt 2>&1
git stash pop  # restore PR 4 changes
pnpm build
node dist/bin.js --classic --signup --email ... --full-name ... > /tmp/after.txt 2>&1
diff /tmp/before.txt /tmp/after.txt
```

Expected: no substantive diff (timestamps and run IDs may differ).

---

## Self-Review

**Spec coverage for this PR:**
- ✅ Classic mode routes through wrapper (Task 3)
- ✅ Flag-off parity verified (Task 4)
- ✅ Integration test (Task 2)

**Non-goals:** other modes.

**Placeholder scan:** one deliberate — Task 1 asks the engineer to locate the exact OAuth call site because classic mode's entry point has moved over time. If you already know the file, skip to Task 3.

**Type consistency:** matches PR 1.
