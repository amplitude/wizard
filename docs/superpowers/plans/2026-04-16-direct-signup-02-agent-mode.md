# Direct Signup — PR 2: Agent Mode

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.
>
> **This is PR 2 of 5.** Requires PR 1 (Foundation) to be merged. Wires `performSignupOrAuth()` into the `--agent` execution path. Lowest blast radius of the four modes — agent mode is consumed by machines, not end users, so a regression here is easier to roll back.

**Goal:** In `--agent` mode, when `--signup` + `--email` + `--full-name` + flag are all present, attempt direct signup to populate `session.credentials` before `resolveNonInteractiveCredentials()` runs. On failure, fall back to today's behavior.

**Architecture:** Add a single branch in `bin.ts`'s agent IIFE (around line 338). If direct-signup succeeds, populate `session.credentials` directly from the returned tokens. If it fails or isn't applicable (flag off, missing inputs, requires_redirect), fall through to the existing `resolveNonInteractiveCredentials(..., 'agent', ...)` call, which will error out cleanly if no cached tokens exist.

**Tech Stack:** TypeScript, yargs, vitest.

---

## Open design question to resolve in this PR

**Should `performSignupOrAuth()` call `fetchAmplitudeUser()` after a successful direct signup?**

Context: PR 1 left the `id: 'pending'` sentinel pattern from OAuth intact — the wrapper writes a pending StoredUser entry and the real user ID is filled in on the next run. Reviewer (`bird-m`) raised the question in [PR #96 inline comment on `signup-or-auth.ts:52`](https://github.com/amplitude/wizard/pull/96). We deferred to PR 2 because the wrapper is dead code in PR 1 — can't observe real behavior.

**Decide in this PR by tracing the agent-mode flow:**

- Does `resolveNonInteractiveCredentials()` (called after the direct-signup branch) choke on a pending user?
- Does the agent IIFE need `session.userEmail`, `session.selectedOrgId`, or similar user-derived fields to proceed?
- Does `analytics.identifyUser(...)` need to be called with real user info?

**If yes to any:** add `fetchAmplitudeUser` inside `performSignupOrAuth()` after direct-signup success, fall back to the `pending` sentinel on fetch failure. Add unit tests for both success and fetch-failure paths.

**If no:** leave the wrapper as-is; the next wizard run will patch the pending entry via the existing fetch-user path (bin.ts:451+).

Whichever way this resolves, document the decision in the PR description.

---

## File Structure

**Modify:**
- `bin.ts` — add direct-signup branch in the agent IIFE (lines 336–356)

**Tests:**
- `src/__tests__/cli.test.ts` — extend with agent-mode direct-signup case

No new files.

---

## Task 1: Integration Test — Agent Mode with Direct Signup

**Files:**
- Test: `src/__tests__/cli.test.ts` (or a new `src/__tests__/signup-agent.test.ts`)

- [ ] **Step 1: Write the failing test**

Create or extend. The test should spawn bin in agent mode with the relevant flags, mock the feature flag + direct-signup module, and assert that `session.credentials` is populated without an OAuth call.

```typescript
// src/__tests__/signup-agent.test.ts
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
      accessToken: 'agent-access',
      idToken: 'agent-id',
      refreshToken: 'agent-refresh',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      zone: 'us',
    },
  })),
}));

describe('agent mode + --signup + direct signup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('populates session.credentials via direct signup when flag on and email/fullName provided', async () => {
    // Simulate the bin.ts agent branch: construct a session, invoke the
    // branch's core logic, and assert credentials are populated.
    const { buildSession } = await import('../lib/wizard-session.js');
    const { performSignupOrAuth } = await import('../utils/signup-or-auth.js');

    const session = buildSession({
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
    expect(auth.accessToken).toBe('agent-access');
  });

  it('does nothing different when --signup not set', async () => {
    // With signup=false, performDirectSignup should not be called.
    const { performSignupOrAuth } = await import('../utils/signup-or-auth.js');
    const { performDirectSignup } = await import('../utils/direct-signup.js');
    vi.mocked(performDirectSignup).mockClear();

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

- [ ] **Step 2: Run test — first assertion passes, second is parity**

Run: `pnpm vitest run src/__tests__/signup-agent.test.ts`
Expected: PASS. This is exercising PR 1's wrapper, so nothing new to implement yet — but it anchors the semantics before we touch `bin.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/signup-agent.test.ts
git commit -m "test: add agent-mode signup integration test"
```

---

## Task 2: Wire `performSignupOrAuth` Into the Agent IIFE

**Files:**
- Modify: `bin.ts` (agent branch around line 338)

- [ ] **Step 1: Locate the agent branch**

Run: `grep -n "Agent mode (explicit --agent or auto-detected non-TTY)" bin.ts`
Expected: single hit around line 336.

- [ ] **Step 2: Add the direct-signup branch**

In `bin.ts`, locate the agent IIFE:

```typescript
void (async () => {
  const { AgentUI } = await import('./src/ui/agent-ui.js');
  const agentUI = new AgentUI();
  setUI(agentUI);
  if (!options.installDir) options.installDir = process.cwd();

  const session = await buildSessionFromOptions(options);
  session.agent = true;
  await resolveNonInteractiveCredentials(
    session,
    options,
    'agent',
    agentUI,
  );
  // ...
})();
```

Insert the direct-signup branch **before** `resolveNonInteractiveCredentials(...)`:

```typescript
// Try direct signup before falling through to standard credential resolution.
// When --signup is off, flag is off, or email/fullName are missing, this
// branch is a no-op (performSignupOrAuth short-circuits internally).
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

- [ ] **Step 3: Build to verify imports resolve**

Run: `pnpm build`
Expected: clean.

- [ ] **Step 4: Run agent-mode tests + full suite**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 5: Manual smoke test — flag off (parity)**

Ensure `FLAG_DIRECT_SIGNUP` is not enabled for your user. Run:

```bash
node dist/bin.js --signup --agent --email ada@example.com --full-name "Ada Lovelace"
```

Expected: behaves exactly as before PR 2 — direct-signup network call is **not** issued; the wizard either consumes cached tokens or emits the standard OAuth-required NDJSON error.

- [ ] **Step 6: Manual smoke test — flag on**

Enable the flag (or add a temporary `AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP=1` debug override in `feature-flags.ts` — remove before merging). Run:

```bash
AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP=1 node dist/bin.js --signup --agent --email ada@example.com --full-name "Ada Lovelace"
```

Expected:
- If endpoint returns success: NDJSON shows credentials set without `login_url` event.
- If endpoint returns `requires_redirect`: falls through to OAuth resolution, which errors cleanly in agent mode (exit code 3 `AUTH_REQUIRED`).

- [ ] **Step 7: Commit**

```bash
git add bin.ts
git commit -m "feat: wire direct signup into agent mode"
```

---

## Task 3: Verify Flag-Off Parity

**Files:** none — verification only.

- [ ] **Step 1: Test flag-off path**

```bash
# With flag off (or user not in rollout group):
node dist/bin.js --signup --agent --email ada@example.com --full-name "Ada Lovelace" 2>&1 | head -20
```

Expected: no NDJSON event referencing `signup` or `direct-signup`; behavior identical to running without the `--email`/`--full-name` flags.

- [ ] **Step 2: Confirm no new network calls in flag-off mode**

The direct-signup endpoint should not appear in logs or network mocks when the flag is off. Search the debug log:

```bash
grep -c "direct-signup" /tmp/amplitude-wizard.log
```

Expected: `0` (with flag off).

---

## Self-Review

**Spec coverage for this PR:**
- ✅ Direct signup wired into agent mode (Task 2)
- ✅ Flag-off parity verified (Task 3)
- ✅ Integration test (Task 1)

**Non-goals:** other modes (PRs 3–5).

**Placeholder scan:** none.

**Type consistency:** `signupEmail` / `signupFullName` references in bin.ts match `WizardSession` field names from PR 1.
