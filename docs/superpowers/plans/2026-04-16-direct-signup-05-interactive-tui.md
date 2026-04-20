# Direct Signup — PR 5: Interactive TUI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.
>
> **This is PR 5 of 5** (final). Requires PR 1 (Foundation). Independent of PRs 2–4 but recommended to merge them first to prove the wrapper end-to-end in lower-risk modes.

**Goal:** In the Ink TUI, when `--signup` + `--email` + `--full-name` + flag are all present, route the auth task through `performSignupOrAuth()` instead of `performAmplitudeAuth()`. No new screens — if email/fullName aren't provided via CLI, we fall back to OAuth as today.

**Architecture:** Single call-site swap in `bin.ts`'s interactive-TUI `authTask` IIFE (around line 608–700). After the user dismisses the intro and picks a region (today's gate), call the wrapper. On success, `auth` is populated identically to today's `performAmplitudeAuth` return; on `requires_redirect`, the wrapper falls back to OAuth internally and the browser opens.

No `SignupProfileScreen` in this PR. If product wants interactive collection of email/fullName inside the TUI later, that's a follow-up PR.

**Tech Stack:** TypeScript, Ink, nanostores, vitest.

---

## File Structure

**Modify:**
- `bin.ts` — interactive-TUI `authTask` around line 656

**Tests:**
- `src/ui/tui/__tests__/signup-tui.test.ts` (new) — unit coverage at the wrapper level; TUI router/flow tests continue to pass unchanged.

---

## Task 1: Integration Test — TUI Path

**Files:**
- Create: `src/ui/tui/__tests__/signup-tui.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/ui/tui/__tests__/signup-tui.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/feature-flags.js', () => ({
  FLAG_DIRECT_SIGNUP: 'wizard-direct-signup',
  isFlagEnabled: vi.fn((key: string) => key === 'wizard-direct-signup'),
  initFeatureFlags: vi.fn(async () => {}),
}));

vi.mock('../../../utils/direct-signup.js', () => ({
  performDirectSignup: vi.fn(async () => ({
    kind: 'success',
    tokens: {
      accessToken: 'tui-access',
      idToken: 'tui-id',
      refreshToken: 'tui-refresh',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      zone: 'us',
    },
  })),
}));

describe('TUI mode + --signup + direct signup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses direct signup when flag on and email/fullName provided', async () => {
    const { performSignupOrAuth } = await import(
      '../../../utils/signup-or-auth.js'
    );
    const auth = await performSignupOrAuth({
      signup: true,
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });
    const { performDirectSignup } = await import(
      '../../../utils/direct-signup.js'
    );
    expect(performDirectSignup).toHaveBeenCalledOnce();
    expect(auth.accessToken).toBe('tui-access');
  });

  it('falls through to OAuth when email/fullName missing (parity)', async () => {
    vi.doMock('../../../utils/oauth.js', () => ({
      performAmplitudeAuth: vi.fn(async () => ({
        accessToken: 'oauth',
        idToken: 'oauth',
        refreshToken: 'oauth',
        zone: 'us' as const,
      })),
    }));
    const { performSignupOrAuth } = await import(
      '../../../utils/signup-or-auth.js'
    );
    const { performDirectSignup } = await import(
      '../../../utils/direct-signup.js'
    );
    vi.mocked(performDirectSignup).mockClear();

    await performSignupOrAuth({
      signup: true,
      email: null,
      fullName: null,
      zone: 'us',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — PASS**

Run: `pnpm vitest run src/ui/tui/__tests__/signup-tui.test.ts`
Expected: PASS (exercises the wrapper; no TUI changes yet).

- [ ] **Step 3: Commit**

```bash
git add src/ui/tui/__tests__/signup-tui.test.ts
git commit -m "test: add TUI-mode signup integration test"
```

---

## Task 2: Swap `performAmplitudeAuth` For `performSignupOrAuth` in the TUI authTask

**Files:**
- Modify: `bin.ts` (interactive-TUI branch, `authTask` around line 608–720)

- [ ] **Step 1: Locate the call**

Run: `grep -n "performAmplitudeAuth" bin.ts`
Expected: two hits — one is the initial call (around line 656), the other is a retry after a 401 on `fetchAmplitudeUser` (around line 676). We only swap the **first** call; retries always want fresh OAuth.

- [ ] **Step 2: Swap the first call**

Find:

```typescript
let auth = await performAmplitudeAuth({
  zone,
  forceFresh,
});
```

Replace with:

```typescript
const { performSignupOrAuth } = await import('./src/utils/signup-or-auth.js');
let auth = await performSignupOrAuth({
  signup: tui.store.session.signup,
  email: tui.store.session.signupEmail,
  fullName: tui.store.session.signupFullName,
  zone,
  forceFresh,
});
```

Leave the retry `performAmplitudeAuth({ zone, forceFresh: true })` call (around line 676) **unchanged** — if the token was invalidated server-side, we want the standard OAuth refresh path, not another direct-signup attempt.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: clean.

- [ ] **Step 4: Run TUI tests**

Run: `pnpm vitest run src/ui/tui/__tests__/`
Expected: all pass. The router and flow-invariants tests should be unaffected — no new screens, no flow changes.

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 6: Manual smoke test — flag off (parity)**

```bash
node dist/bin.js --signup --email ada@example.com --full-name "Ada Lovelace"
```

Expected: TUI boots, intro plays, region select appears, browser opens for OAuth — identical to today.

- [ ] **Step 7: Manual smoke test — flag on**

```bash
AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP=1 node dist/bin.js --signup --email ada@example.com --full-name "Ada Lovelace"
```

Expected:
- On success: TUI proceeds past Auth without opening a browser; RunScreen appears with credentials in session.
- On `requires_redirect`: browser opens for OAuth as a fallback; user signs in normally.

- [ ] **Step 8: Manual smoke test — flag on + missing flags (parity fallback)**

```bash
AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP=1 node dist/bin.js --signup
```

Expected: no direct-signup call (wrapper short-circuits because `signupEmail`/`signupFullName` are null); browser opens for OAuth as today.

- [ ] **Step 9: Commit**

```bash
git add bin.ts
git commit -m "feat: wire direct signup into interactive TUI mode"
```

---

## Task 3: Verify Flag-Off Parity and End-to-End Behavior

**Files:** none.

- [ ] **Step 1: Flag-off diff check**

Capture the TUI's verbose log output before and after this PR with the flag off:

```bash
git stash
pnpm build
node dist/bin.js --signup --verbose > /tmp/tui-before.log 2>&1 &
# Let it run long enough to hit the OAuth URL
sleep 10 && kill %1
git stash pop
pnpm build
node dist/bin.js --signup --verbose > /tmp/tui-after.log 2>&1 &
sleep 10 && kill %1
# Compare log file
diff /tmp/amplitude-wizard.log /tmp/amplitude-wizard-prev.log || true
```

Expected: no substantive diff. `[signup-or-auth] skipping direct signup, using OAuth` may appear in the "after" log — that is expected and benign.

- [ ] **Step 2: Router + flow invariants**

Run: `pnpm vitest run src/ui/tui/__tests__/router.test.ts src/ui/tui/__tests__/flow-invariants.test.ts`
Expected: PASS. These property-based tests guarantee the flow graph hasn't regressed.

- [ ] **Step 3: BDD suite**

Run: `pnpm test:bdd`
Expected: PASS.

---

## Task 4: Update Docs + CLI Example (Optional — Can Split Into Follow-Up)

**Files:**
- Modify: `docs/flows.md` — document the direct-signup branch in the SUSI flow
- Modify: `bin.ts` — add an example for `--signup --email --full-name`

- [ ] **Step 1: Document the SUSI branch**

Open `docs/flows.md`, find the SUSI flow section, and add:

```
When --signup + flag-on + --email + --full-name:
  attempt POST /signup
  ├─ success → tokens, skip OAuth
  ├─ requires_redirect → fall through to OAuth
  └─ error → fall through to OAuth
```

- [ ] **Step 2: Add CLI example**

In `bin.ts` near line 1412 (`.example(...)` calls):

```typescript
.example(
  '$0 --signup --email ada@example.com --full-name "Ada Lovelace"',
  'Attempt to create an Amplitude account without opening a browser',
)
```

- [ ] **Step 3: Regenerate flow diagrams**

Run: `pnpm flows`
Expected: `docs/diagrams/` updates.

- [ ] **Step 4: Commit**

```bash
git add docs/ bin.ts
git commit -m "docs: document direct signup branch and CLI example"
```

---

## Task 5: Remove Debug Flag Override (If Added)

If any prior PR added an `AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP` debug override in `src/lib/feature-flags.ts`, **this is the PR to remove it**. The Experiment flag is the one-true gate in production.

- [ ] **Step 1: Search for the override**

Run: `grep -n "AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP" src/`
Expected: 0 hits (if no override was added) or a few hits (if one was added for manual testing).

- [ ] **Step 2: Remove if present**

Delete the override from `feature-flags.ts` and any call sites. Commit with message `chore: remove debug override for direct signup flag`.

- [ ] **Step 3: Run tests**

Run: `pnpm test`
Expected: PASS.

---

## Self-Review

**Spec coverage for this PR:**
- ✅ TUI routed through wrapper (Task 2)
- ✅ Integration test (Task 1)
- ✅ Flag-off parity verified (Task 3)
- ✅ Documentation (Task 4)
- ✅ Debug override removed (Task 5)

**Non-goals (explicitly):**
- No `SignupProfileScreen`. If email/fullName are missing, we fall back to OAuth silently. Interactive in-TUI collection is a follow-up feature, not part of this rollout.

**Placeholder scan:** none.

**Type consistency:** matches PR 1.

---

## End of Series

After this PR merges, direct signup is wired into all four modes behind `wizard-direct-signup`. Verification checklist for the rollout:

1. Flag at 0% → binary behavior should be identical to pre-PR-1 main.
2. Flag at 1% rollout to internal users → monitor Sentry + Datadog for direct-signup errors.
3. Gradual ramp → 10% → 50% → 100%.
4. If issues arise, flip the flag off; no rollback required.
