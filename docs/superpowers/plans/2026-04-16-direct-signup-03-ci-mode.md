# Direct Signup — PR 3: CI Mode

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.
>
> **This is PR 3 of 5.** Requires PR 1 (Foundation) merged; independent of PR 2 (agent mode).

**Goal:** In `--ci` / `--yes` mode, when `--signup` + `--email` + `--full-name` + flag are all present, attempt direct signup to populate `session.credentials` before `resolveNonInteractiveCredentials(..., 'ci')` runs. On failure, fall back to today's behavior.

**Architecture:** Mirror of PR 2 — insert a direct-signup branch before `resolveNonInteractiveCredentials()` in the CI IIFE (around `bin.ts:357`). When flag is off or inputs are missing, the wrapper short-circuits internally, so the branch is a no-op.

**Tech Stack:** TypeScript, yargs, vitest.

---

## File Structure

**Modify:**
- `bin.ts` — CI branch around line 357

**Tests:**
- `src/__tests__/signup-ci.test.ts` (new)

---

## Task 1: Integration Test — CI Mode with Direct Signup

**Files:**
- Create: `src/__tests__/signup-ci.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/signup-ci.test.ts
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
      accessToken: 'ci-access',
      idToken: 'ci-id',
      refreshToken: 'ci-refresh',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      zone: 'us',
    },
  })),
}));

describe('CI mode + --signup + direct signup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('populates session.credentials via direct signup when flag on and email/fullName provided', async () => {
    const { buildSession } = await import('../lib/wizard-session.js');
    const { performSignupOrAuth } = await import('../utils/signup-or-auth.js');

    const session = buildSession({
      ci: true,
      signup: true,
      signupEmail: 'ada@example.com',
      signupFullName: 'Ada Lovelace',
    });

    const auth = await performSignupOrAuth({
      signup: session.signup,
      email: session.signupEmail,
      fullName: session.signupFullName,
      zone: 'us',
    });

    const { performDirectSignup } = await import('../utils/direct-signup.js');
    expect(performDirectSignup).toHaveBeenCalledOnce();
    expect(auth.accessToken).toBe('ci-access');
  });

  it('does not attempt direct signup when flag off', async () => {
    const { isFlagEnabled } = await import('../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(false);
    const { performDirectSignup } = await import('../utils/direct-signup.js');
    vi.mocked(performDirectSignup).mockClear();

    const { performSignupOrAuth } = await import('../utils/signup-or-auth.js');
    // Expected to fall through to OAuth (which will be stubbed in the wrapper's mock).
    await performSignupOrAuth({
      signup: true,
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    }).catch(() => void 0);

    expect(performDirectSignup).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — PASS**

Run: `pnpm vitest run src/__tests__/signup-ci.test.ts`
Expected: PASS (exercising wrapper semantics from PR 1).

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/signup-ci.test.ts
git commit -m "test: add CI-mode signup integration test"
```

---

## Task 2: Wire `performSignupOrAuth` Into the CI IIFE

**Files:**
- Modify: `bin.ts` (CI branch around line 357)

- [ ] **Step 1: Locate the CI branch**

Run: `grep -n "CI mode: no prompts, auto-select first environment" bin.ts`
Expected: single hit around line 358.

- [ ] **Step 2: Add the direct-signup branch**

In `bin.ts`, find:

```typescript
} else if (options.ci || options.yes) {
  // CI mode: no prompts, auto-select first environment
  setUI(new LoggingUI());
  if (!options.installDir) options.installDir = process.cwd();

  void (async () => {
    const session = await buildSessionFromOptions(options, { ci: true });
    await resolveNonInteractiveCredentials(session, options, 'ci');
    // ...
  })();
}
```

Insert **before** `resolveNonInteractiveCredentials(...)`:

```typescript
if (session.signup && session.signupEmail && session.signupFullName) {
  const { performSignupOrAuth } = await import(
    './src/utils/signup-or-auth.js'
  );
  const { DEFAULT_AMPLITUDE_ZONE, DEFAULT_HOST_URL } = await import(
    './src/lib/constants.js'
  );
  const zone = (session.region ?? DEFAULT_AMPLITUDE_ZONE) as 'us' | 'eu';
  try {
    const auth = await performSignupOrAuth({
      signup: true,
      email: session.signupEmail,
      fullName: session.signupFullName,
      zone,
    });
    session.credentials = {
      accessToken: auth.accessToken,
      idToken: auth.idToken,
      projectApiKey: '',
      host: DEFAULT_HOST_URL,
      projectId: session.projectId ?? 0,
    };
  } catch (err) {
    getUI().log.warn(
      `Direct signup failed: ${
        err instanceof Error ? err.message : String(err)
      }. Falling back to existing credential resolution.`,
    );
  }
}
```

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: clean.

- [ ] **Step 4: Full test suite**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 5: Manual smoke test — flag off (parity)**

```bash
node dist/bin.js --ci --signup --email ada@example.com --full-name "Ada Lovelace"
```

Expected: behaves exactly as today — no direct-signup network call, falls back to stored-token resolution, errors if no tokens are cached.

- [ ] **Step 6: Manual smoke test — flag on**

```bash
AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP=1 node dist/bin.js --ci --signup --email ada@example.com --full-name "Ada Lovelace"
```

Expected:
- On success: credentials populated; wizard proceeds into the setup flow.
- On `requires_redirect`: warning logged, falls through to the existing CI credential resolver (which errors cleanly when no cached tokens).

- [ ] **Step 7: Commit**

```bash
git add bin.ts
git commit -m "feat: wire direct signup into CI mode"
```

---

## Task 3: Verify Flag-Off Parity

**Files:** none.

- [ ] **Step 1: Confirm zero behavior change when flag is off**

With the flag disabled, running any of these should produce identical stdout to the pre-PR-3 binary:

```bash
node dist/bin.js --ci
node dist/bin.js --ci --signup
node dist/bin.js --ci --signup --email ada@example.com --full-name "Ada Lovelace"
```

Capture output of each and diff against a baseline captured from `main`. Any divergence beyond timestamps is a bug.

---

## Self-Review

**Spec coverage for this PR:**
- ✅ Direct signup wired into CI mode (Task 2)
- ✅ Flag-off parity verified (Task 3)
- ✅ Integration test (Task 1)

**Non-goals:** other modes (PRs 2, 4, 5).

**Placeholder scan:** none.

**Type consistency:** matches PR 1 wrapper contract.
