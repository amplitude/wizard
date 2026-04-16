# Direct Signup — PR 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **This is PR 1 of 5.** PRs 2–5 wire this foundation into each of the four wizard execution modes (agent, CI, classic, interactive TUI). The foundation is safe to ship alone — no wiring, no behavior change.

**Goal:** Land the scaffolding for direct signup — feature flag, CLI flags, session fields, HTTP client, auth wrapper — as unused (dead) code gated by `--signup` + flag + presence of email/fullName. No mode is wired yet, so production behavior is identical to today.

**Architecture:** A new `performDirectSignup()` client POSTs to the signup endpoint introduced in amplitude/javascript PR #103683. A new `performSignupOrAuth()` wrapper composes direct-signup with the existing `performAmplitudeAuth()` fallback: if the flag is off, or `--signup` wasn't passed, or email/fullName are missing, it short-circuits straight to OAuth. PRs 2–5 will swap `performAmplitudeAuth()` call sites for the wrapper in each mode.

**Tech Stack:** TypeScript, yargs, zod, axios, msw (HTTP mocks), vitest.

---

## Prerequisite: Confirm Endpoint Contract

Before **Task 3**, open [amplitude/javascript PR #103683](https://github.com/amplitude/javascript/pull/103683) and confirm the shape. This plan assumes:

- **Path:** `POST ${oAuthHost}/signup` (zone-scoped)
- **Headers:** `Content-Type: application/json`
- **Request body:** `{ "email": "...", "fullName": "...", "zone": "us" | "eu" }`
- **Success (200):** `{ access_token, id_token, refresh_token, token_type, expires_in }` — same shape as OAuth token response
- **Requires-redirect:** HTTP 200 with `{ "requires_redirect": true }` OR HTTP 409
- **Error:** HTTP 4xx/5xx with arbitrary body

If the real contract diverges, update the zod schemas in Task 3 Step 3 before proceeding.

---

## File Structure

**Create:**
- `src/utils/direct-signup.ts` — HTTP client with discriminated-union return type
- `src/utils/__tests__/direct-signup.test.ts`
- `src/utils/signup-or-auth.ts` — wrapper that routes between direct-signup and OAuth
- `src/utils/__tests__/signup-or-auth.test.ts`

**Modify:**
- `src/lib/feature-flags.ts` — add `FLAG_DIRECT_SIGNUP` constant
- `src/lib/wizard-session.ts` — add `signupEmail` and `signupFullName` fields (zod schema + interface + `buildSession`)
- `bin.ts` — add `--email` + `--full-name` global options; pipe through `buildSessionFromOptions`
- `src/__tests__/cli.test.ts` — assert new flags parse

---

## Task 1: Add `FLAG_DIRECT_SIGNUP` Feature Flag Constant

**Files:**
- Modify: `src/lib/feature-flags.ts`
- Test: `src/lib/__tests__/feature-flags.test.ts` (create if missing)

- [ ] **Step 1: Check whether the test file already exists**

Run: `ls src/lib/__tests__/feature-flags.test.ts 2>/dev/null || echo "missing"`
Expected: prints either the path or `missing`.

- [ ] **Step 2: Write the failing test**

If the file is missing, create it. Otherwise append.

```typescript
// src/lib/__tests__/feature-flags.test.ts
import { describe, it, expect } from 'vitest';
import { FLAG_DIRECT_SIGNUP } from '../feature-flags';

describe('FLAG_DIRECT_SIGNUP', () => {
  it('uses the wizard-direct-signup key', () => {
    expect(FLAG_DIRECT_SIGNUP).toBe('wizard-direct-signup');
  });
});
```

- [ ] **Step 3: Run test — FAIL**

Run: `pnpm vitest run src/lib/__tests__/feature-flags.test.ts`
Expected: FAIL — `FLAG_DIRECT_SIGNUP` not exported.

- [ ] **Step 4: Add the constant**

In `src/lib/feature-flags.ts`, after `export const FLAG_AGENT_ANALYTICS = '...'`:

```typescript
/** Gate for direct signup via the signup endpoint (falls back to OAuth redirect). */
export const FLAG_DIRECT_SIGNUP = 'wizard-direct-signup';
```

- [ ] **Step 5: Run test — PASS**

Run: `pnpm vitest run src/lib/__tests__/feature-flags.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/feature-flags.ts src/lib/__tests__/feature-flags.test.ts
git commit -m "feat: add wizard-direct-signup feature flag constant"
```

---

## Task 2: Add `--email` + `--full-name` CLI Flags and Session Fields

**Files:**
- Modify: `bin.ts` (global `.options({...})` block around line 218; `buildSessionFromOptions` around line 69)
- Modify: `src/lib/wizard-session.ts` (zod schema, interface, `buildSession`)
- Test: `src/__tests__/cli.test.ts`; `src/lib/__tests__/wizard-session.test.ts` (create if missing)

- [ ] **Step 1: Write failing CLI test**

Mirror the existing `'--signup'` test style in `src/__tests__/cli.test.ts` (grep `'--signup'` for the template). Append:

```typescript
it('accepts --email and --full-name on the default command', async () => {
  const args = await parseArgs([
    '--signup',
    '--email',
    'ada@example.com',
    '--full-name',
    'Ada Lovelace',
  ]);
  expect(args.email).toBe('ada@example.com');
  expect(args['full-name']).toBe('Ada Lovelace');
});
```

- [ ] **Step 2: Write failing session test**

Create or append to `src/lib/__tests__/wizard-session.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildSession } from '../wizard-session';

describe('buildSession signup profile fields', () => {
  it('defaults signupEmail and signupFullName to null', () => {
    const s = buildSession({});
    expect(s.signupEmail).toBeNull();
    expect(s.signupFullName).toBeNull();
  });

  it('accepts signupEmail and signupFullName from options', () => {
    const s = buildSession({
      signupEmail: 'ada@example.com',
      signupFullName: 'Ada Lovelace',
    });
    expect(s.signupEmail).toBe('ada@example.com');
    expect(s.signupFullName).toBe('Ada Lovelace');
  });
});
```

- [ ] **Step 3: Run tests — both FAIL**

Run: `pnpm vitest run src/__tests__/cli.test.ts src/lib/__tests__/wizard-session.test.ts`
Expected: FAIL.

- [ ] **Step 4: Add the yargs options**

In `bin.ts` around line 262 (inside the global `.options({...})` block, after the `env` option):

```typescript
    email: {
      describe: 'email to use when creating a new account (requires --signup)',
      type: 'string',
    },
    'full-name': {
      describe: 'full name to use when creating a new account (requires --signup)',
      type: 'string',
    },
```

- [ ] **Step 5: Pipe argv through `buildSessionFromOptions`**

In `bin.ts` around line 83 (inside `buildSessionFromOptions`), add:

```typescript
    signupEmail: options.email as string | undefined,
    signupFullName: options['full-name'] as string | undefined,
```

- [ ] **Step 6: Extend `BuildSessionOptions` interface**

In `src/lib/wizard-session.ts` around line 359, add to the `BuildSessionOptions` interface:

```typescript
  signupEmail?: string;
  signupFullName?: string;
```

- [ ] **Step 7: Extend the zod schema**

In `src/lib/wizard-session.ts` around line 38 (inside `WizardOptionsSchema`), add:

```typescript
  signupEmail: z.string().email().nullable().default(null),
  signupFullName: z.string().nullable().default(null),
```

- [ ] **Step 8: Extend the `WizardSession` interface**

Around line 150, add:

```typescript
  signupEmail: string | null;
  signupFullName: string | null;
```

- [ ] **Step 9: Populate in `buildSession()`**

Around line 387:

```typescript
    signupEmail: validated.signupEmail ?? null,
    signupFullName: validated.signupFullName ?? null,
```

- [ ] **Step 10: Run tests — PASS**

Run: `pnpm vitest run src/__tests__/cli.test.ts src/lib/__tests__/wizard-session.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add bin.ts src/lib/wizard-session.ts src/__tests__/cli.test.ts src/lib/__tests__/wizard-session.test.ts
git commit -m "feat: add --email, --full-name CLI flags and session fields"
```

---

## Task 3: Implement `performDirectSignup()` HTTP Client

**Before starting:** confirm the endpoint contract against amplitude/javascript PR #103683 (see Prerequisite section). Update the schemas below if the real contract differs.

**Files:**
- Create: `src/utils/direct-signup.ts`
- Create: `src/utils/__tests__/direct-signup.test.ts`

- [ ] **Step 1: Write the failing test — happy path**

```typescript
// src/utils/__tests__/direct-signup.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { performDirectSignup } from '../direct-signup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('performDirectSignup', () => {
  it('returns success with tokens on 200', async () => {
    server.use(
      http.post('https://auth.amplitude.com/signup', () =>
        HttpResponse.json({
          access_token: 'a',
          id_token: 'i',
          refresh_token: 'r',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      ),
    );

    const result = await performDirectSignup({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.tokens.accessToken).toBe('a');
      expect(result.tokens.idToken).toBe('i');
      expect(result.tokens.refreshToken).toBe('r');
      expect(result.tokens.zone).toBe('us');
    }
  });
});
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm vitest run src/utils/__tests__/direct-signup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/utils/direct-signup.ts
import axios, { AxiosError } from 'axios';
import { z } from 'zod';
import {
  AMPLITUDE_ZONE_SETTINGS,
  type AmplitudeZone,
} from '../lib/constants.js';
import { logToFile } from './debug.js';

const SuccessSchema = z.object({
  access_token: z.string(),
  id_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
});

const RequiresRedirectSchema = z.object({
  requires_redirect: z.literal(true),
});

export interface DirectSignupInput {
  email: string;
  fullName: string;
  zone: AmplitudeZone;
}

export type DirectSignupResult =
  | {
      kind: 'success';
      tokens: {
        accessToken: string;
        idToken: string;
        refreshToken: string;
        expiresAt: string;
        zone: AmplitudeZone;
      };
    }
  | { kind: 'requires_redirect' }
  | { kind: 'error'; message: string };

/**
 * Attempts to create an Amplitude account and obtain tokens directly via the
 * signup endpoint (amplitude/javascript PR #103683). Callers should fall back
 * to the OAuth redirect flow on `requires_redirect` or `error`.
 */
export async function performDirectSignup(
  input: DirectSignupInput,
): Promise<DirectSignupResult> {
  const { oAuthHost } = AMPLITUDE_ZONE_SETTINGS[input.zone];
  const url = `${oAuthHost}/signup`;
  logToFile('[direct-signup] POST', { url, email: input.email });

  try {
    const response = await axios.post(
      url,
      { email: input.email, fullName: input.fullName, zone: input.zone },
      {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: (s) => s < 500,
      },
    );

    const redirect = RequiresRedirectSchema.safeParse(response.data);
    if (redirect.success) return { kind: 'requires_redirect' };
    if (response.status === 409) return { kind: 'requires_redirect' };

    const success = SuccessSchema.safeParse(response.data);
    if (success.success) {
      const expiresAt = new Date(
        Date.now() + success.data.expires_in * 1000,
      ).toISOString();
      return {
        kind: 'success',
        tokens: {
          accessToken: success.data.access_token,
          idToken: success.data.id_token,
          refreshToken: success.data.refresh_token,
          expiresAt,
          zone: input.zone,
        },
      };
    }

    logToFile('[direct-signup] unexpected response shape', {
      status: response.status,
    });
    return { kind: 'error', message: `Unexpected response (${response.status})` };
  } catch (e) {
    const err =
      e instanceof AxiosError
        ? e.message
        : e instanceof Error
        ? e.message
        : String(e);
    logToFile('[direct-signup] network error', { err });
    return { kind: 'error', message: err };
  }
}
```

- [ ] **Step 4: Run happy path — PASS**

Run: `pnpm vitest run src/utils/__tests__/direct-signup.test.ts`
Expected: PASS.

- [ ] **Step 5: Add tests for all non-happy paths**

Append to the test file:

```typescript
it('returns requires_redirect when body is { requires_redirect: true }', async () => {
  server.use(
    http.post('https://auth.amplitude.com/signup', () =>
      HttpResponse.json({ requires_redirect: true }),
    ),
  );
  const result = await performDirectSignup({
    email: 'ada@example.com',
    fullName: 'Ada Lovelace',
    zone: 'us',
  });
  expect(result.kind).toBe('requires_redirect');
});

it('returns requires_redirect on HTTP 409', async () => {
  server.use(
    http.post('https://auth.amplitude.com/signup', () =>
      HttpResponse.json({ error: 'conflict' }, { status: 409 }),
    ),
  );
  const result = await performDirectSignup({
    email: 'ada@example.com',
    fullName: 'Ada Lovelace',
    zone: 'us',
  });
  expect(result.kind).toBe('requires_redirect');
});

it('returns error on network failure', async () => {
  server.use(
    http.post('https://auth.amplitude.com/signup', () => HttpResponse.error()),
  );
  const result = await performDirectSignup({
    email: 'ada@example.com',
    fullName: 'Ada Lovelace',
    zone: 'us',
  });
  expect(result.kind).toBe('error');
});

it('routes EU requests to auth.eu.amplitude.com', async () => {
  let observedUrl = '';
  server.use(
    http.post('https://auth.eu.amplitude.com/signup', ({ request }) => {
      observedUrl = request.url;
      return HttpResponse.json({
        access_token: 'a',
        id_token: 'i',
        refresh_token: 'r',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }),
  );
  await performDirectSignup({
    email: 'ada@example.com',
    fullName: 'Ada Lovelace',
    zone: 'eu',
  });
  expect(observedUrl).toContain('auth.eu.amplitude.com');
});
```

- [ ] **Step 6: Run all tests — PASS**

Run: `pnpm vitest run src/utils/__tests__/direct-signup.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/utils/direct-signup.ts src/utils/__tests__/direct-signup.test.ts
git commit -m "feat: add performDirectSignup client for signup endpoint"
```

---

## Task 4: Implement `performSignupOrAuth()` Wrapper

**Files:**
- Create: `src/utils/signup-or-auth.ts`
- Create: `src/utils/__tests__/signup-or-auth.test.ts`

- [ ] **Step 1: Write the failing test — flag off short-circuits to OAuth**

```typescript
// src/utils/__tests__/signup-or-auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performSignupOrAuth } from '../signup-or-auth';

vi.mock('../oauth.js', () => ({
  performAmplitudeAuth: vi.fn(async () => ({
    idToken: 'oauth-id',
    accessToken: 'oauth-access',
    refreshToken: 'oauth-refresh',
    zone: 'us' as const,
  })),
}));
vi.mock('../direct-signup.js', () => ({
  performDirectSignup: vi.fn(),
}));
vi.mock('../../lib/feature-flags.js', () => ({
  FLAG_DIRECT_SIGNUP: 'wizard-direct-signup',
  isFlagEnabled: vi.fn(() => false),
}));
vi.mock('./ampli-settings.js', () => ({
  storeToken: vi.fn(),
}));

describe('performSignupOrAuth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls OAuth directly when flag is off', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    const { performAmplitudeAuth } = await import('../oauth.js');

    const result = await performSignupOrAuth({
      signup: true,
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
    expect(performAmplitudeAuth).toHaveBeenCalledOnce();
    expect(result.accessToken).toBe('oauth-access');
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `pnpm vitest run src/utils/__tests__/signup-or-auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/utils/signup-or-auth.ts
import { performAmplitudeAuth, type AmplitudeAuthResult } from './oauth.js';
import { performDirectSignup } from './direct-signup.js';
import { FLAG_DIRECT_SIGNUP, isFlagEnabled } from '../lib/feature-flags.js';
import { storeToken, type StoredUser } from './ampli-settings.js';
import { logToFile } from './debug.js';
import type { AmplitudeZone } from '../lib/constants.js';

export interface SignupOrAuthInput {
  signup: boolean;
  email: string | null;
  fullName: string | null;
  zone: AmplitudeZone;
  forceFresh?: boolean;
}

/**
 * Chooses between direct signup (when gated flag on, --signup set, and
 * email + fullName provided) and the existing OAuth flow. Falls back to OAuth
 * when direct signup returns requires_redirect or error.
 */
export async function performSignupOrAuth(
  input: SignupOrAuthInput,
): Promise<AmplitudeAuthResult> {
  const shouldAttemptDirect =
    input.signup &&
    isFlagEnabled(FLAG_DIRECT_SIGNUP) &&
    input.email !== null &&
    input.fullName !== null;

  if (!shouldAttemptDirect) {
    logToFile('[signup-or-auth] skipping direct signup, using OAuth');
    return performAmplitudeAuth({
      zone: input.zone,
      forceFresh: input.forceFresh,
    });
  }

  logToFile('[signup-or-auth] attempting direct signup');
  const result = await performDirectSignup({
    email: input.email!,
    fullName: input.fullName!,
    zone: input.zone,
  });

  if (result.kind === 'success') {
    // Persist to ~/.ampli.json in the same format as OAuth.
    const parts = input.fullName!.split(' ');
    const pendingUser: StoredUser = {
      id: 'pending',
      firstName: parts[0] ?? '',
      lastName: parts.slice(1).join(' '),
      email: input.email!,
      zone: input.zone,
    };
    storeToken(pendingUser, {
      accessToken: result.tokens.accessToken,
      idToken: result.tokens.idToken,
      refreshToken: result.tokens.refreshToken,
      expiresAt: result.tokens.expiresAt,
    });
    return {
      idToken: result.tokens.idToken,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      zone: result.tokens.zone,
    };
  }

  logToFile('[signup-or-auth] falling back to OAuth', { kind: result.kind });
  return performAmplitudeAuth({
    zone: input.zone,
    forceFresh: input.forceFresh,
  });
}
```

- [ ] **Step 4: Run — PASS**

Run: `pnpm vitest run src/utils/__tests__/signup-or-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Add remaining tests**

Append:

```typescript
it('falls back to OAuth when flag is on but email is missing', async () => {
  const { isFlagEnabled } = await import('../../lib/feature-flags.js');
  vi.mocked(isFlagEnabled).mockReturnValue(true);
  const { performDirectSignup } = await import('../direct-signup.js');
  const { performAmplitudeAuth } = await import('../oauth.js');

  await performSignupOrAuth({
    signup: true,
    email: null,
    fullName: 'Ada Lovelace',
    zone: 'us',
  });

  expect(performDirectSignup).not.toHaveBeenCalled();
  expect(performAmplitudeAuth).toHaveBeenCalledOnce();
});

it('falls back to OAuth when flag is on but fullName is missing', async () => {
  const { isFlagEnabled } = await import('../../lib/feature-flags.js');
  vi.mocked(isFlagEnabled).mockReturnValue(true);
  const { performDirectSignup } = await import('../direct-signup.js');
  const { performAmplitudeAuth } = await import('../oauth.js');

  await performSignupOrAuth({
    signup: true,
    email: 'ada@example.com',
    fullName: null,
    zone: 'us',
  });

  expect(performDirectSignup).not.toHaveBeenCalled();
  expect(performAmplitudeAuth).toHaveBeenCalledOnce();
});

it('falls back to OAuth when --signup is not set', async () => {
  const { isFlagEnabled } = await import('../../lib/feature-flags.js');
  vi.mocked(isFlagEnabled).mockReturnValue(true);
  const { performDirectSignup } = await import('../direct-signup.js');
  const { performAmplitudeAuth } = await import('../oauth.js');

  await performSignupOrAuth({
    signup: false,
    email: 'ada@example.com',
    fullName: 'Ada Lovelace',
    zone: 'us',
  });

  expect(performDirectSignup).not.toHaveBeenCalled();
  expect(performAmplitudeAuth).toHaveBeenCalledOnce();
});

it('falls back to OAuth when direct signup returns requires_redirect', async () => {
  const { isFlagEnabled } = await import('../../lib/feature-flags.js');
  vi.mocked(isFlagEnabled).mockReturnValue(true);
  const { performDirectSignup } = await import('../direct-signup.js');
  vi.mocked(performDirectSignup).mockResolvedValue({ kind: 'requires_redirect' });
  const { performAmplitudeAuth } = await import('../oauth.js');

  await performSignupOrAuth({
    signup: true,
    email: 'ada@example.com',
    fullName: 'Ada Lovelace',
    zone: 'us',
  });

  expect(performDirectSignup).toHaveBeenCalledOnce();
  expect(performAmplitudeAuth).toHaveBeenCalledOnce();
});

it('falls back to OAuth when direct signup errors', async () => {
  const { isFlagEnabled } = await import('../../lib/feature-flags.js');
  vi.mocked(isFlagEnabled).mockReturnValue(true);
  const { performDirectSignup } = await import('../direct-signup.js');
  vi.mocked(performDirectSignup).mockResolvedValue({
    kind: 'error',
    message: 'boom',
  });
  const { performAmplitudeAuth } = await import('../oauth.js');

  await performSignupOrAuth({
    signup: true,
    email: 'ada@example.com',
    fullName: 'Ada Lovelace',
    zone: 'us',
  });

  expect(performAmplitudeAuth).toHaveBeenCalledOnce();
});

it('returns direct-signup tokens on success without calling OAuth', async () => {
  const { isFlagEnabled } = await import('../../lib/feature-flags.js');
  vi.mocked(isFlagEnabled).mockReturnValue(true);
  const { performDirectSignup } = await import('../direct-signup.js');
  vi.mocked(performDirectSignup).mockResolvedValue({
    kind: 'success',
    tokens: {
      accessToken: 'direct-access',
      idToken: 'direct-id',
      refreshToken: 'direct-refresh',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      zone: 'us',
    },
  });
  const { performAmplitudeAuth } = await import('../oauth.js');
  const { storeToken } = await import('../ampli-settings.js');

  const result = await performSignupOrAuth({
    signup: true,
    email: 'ada@example.com',
    fullName: 'Ada Lovelace',
    zone: 'us',
  });

  expect(performAmplitudeAuth).not.toHaveBeenCalled();
  expect(result.accessToken).toBe('direct-access');
  expect(storeToken).toHaveBeenCalledOnce();
});
```

- [ ] **Step 6: Run — PASS**

Run: `pnpm vitest run src/utils/__tests__/signup-or-auth.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Run the full test suite to catch regressions**

Run: `pnpm test`
Expected: all tests pass, including existing ones. Foundation is dead code — no call site has changed.

- [ ] **Step 8: Lint + build**

Run: `pnpm lint && pnpm build`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/utils/signup-or-auth.ts src/utils/__tests__/signup-or-auth.test.ts
git commit -m "feat: add performSignupOrAuth wrapper with OAuth fallback"
```

---

## Self-Review

**Spec coverage for this PR:**
- ✅ Feature flag constant defined (Task 1)
- ✅ `--email` + `--full-name` CLI flags + session fields (Task 2)
- ✅ Direct-signup HTTP client with discriminated union (Task 3)
- ✅ Wrapper with flag/input gating + OAuth fallback (Task 4)

**Non-goals (handled in PRs 2–5):**
- Wiring the wrapper into any execution mode. As of this PR, `performSignupOrAuth()` has **zero call sites in `bin.ts` or `run.ts`** — production paths still call `performAmplitudeAuth()` directly.

**Placeholder scan:** none.

**Type consistency:** `DirectSignupResult`, `SignupOrAuthInput`, and `AmplitudeAuthResult` are consistent; `signupEmail` + `signupFullName` naming matches across CLI flag, session field, and wrapper input.

**Open question documented at top:** endpoint contract from PR #103683.
