# 19-point quality checklist (mirror)

> **Source of truth:** [`docs/evals.md`](../../docs/evals.md). This file
> is a mirror, kept here so contributors editing scorers don't have to
> hunt across the repo. When this and `docs/evals.md` disagree,
> `docs/evals.md` wins; update both together.

Every scorer maps to one or more rows in this table. New scorers must
cite the row(s) they cover. New rows here come from real failures
observed in the wild — when we add one, we update the spec before we
update the prompt or skill (the criterion outlives the specific fix).

**Weights**
- **Hard fail** = any single failure fails the whole integration regardless of total score.
- **Heavy** = 10 pts.
- **Medium** = 5 pts.
- **Soft** = warn-only (0 pts).

## A. Package selection

| # | Criterion | Weight | Notes |
|---|-----------|--------|-------|
| 1 | Correct SDK package family for the framework | Hard fail | Browser frameworks must use `@amplitude/unified` (project rule). Node/server uses `@amplitude/analytics-node`. Mobile uses the matching native SDK. |
| 2 | Correct version range pinned in `package.json` / equivalent | Medium (5) | No wildcard majors, no pre-release tags unless requested. |
| 3 | No non-vendor packages installed by the agent | Medium (5) | The agent should not pull in unrelated helper libraries to "fix" something. |

## B. Init placement and shape

| # | Criterion | Weight | Notes |
|---|-----------|--------|-------|
| 4 | Init lives in the correct entry file for the framework | Heavy (10) | App Router: `app/layout.tsx` client wrapper. Pages Router: `_app.tsx`. Vite: `main.tsx`. Expo: `app/_layout.tsx`. Etc. |
| 5 | No project-local re-export wrapper around the SDK | Heavy (10) | We have seen agents create `lib/amplitude.ts` that re-exports `track`. This breaks tree-shaking and creates a second init surface. |
| 6 | Single `init()` call per project | Hard fail | Multiple inits cause double-counted events and duplicate device IDs. |
| 7 | Init options carry comments explaining each toggle | Medium (5) | DX: the next dev who reads this code should know what to flip. |

## C. Identity, env vars, and secrets

| # | Criterion | Weight | Notes |
|---|-----------|--------|-------|
| 8 | API key is read from an env var, never hardcoded | Hard fail | Including no string literal that matches the test key. |
| 9 | Env var prefix matches the framework | Medium (5) | `NEXT_PUBLIC_*` for Next.js, `VITE_*` for Vite, `EXPO_PUBLIC_*` for Expo, server-side unprefixed for Node, etc. |
| 10 | No build-config bridging to inject env vars | Hard fail | Modifying `next.config.js`, `vite.config.ts`, `webpack.config.js`, `babel.config.js` to ferry secrets is a hard fail. The supported pattern is the framework's own env mechanism. |

## D. Server vs client boundary

| # | Criterion | Weight | Notes |
|---|-----------|--------|-------|
| 11 | Browser SDK never imported into a server-only file | Heavy (10) | App Router: no `@amplitude/unified` in a Server Component, no `init()` at module scope of a server file. |
| 12 | Server SDK is used in API routes / server actions when present | Heavy (10) | If the agent inserts server-side tracking, it uses `@amplitude/analytics-node` with a flush. |

## E. Track placement

| # | Criterion | Weight | Notes |
|---|-----------|--------|-------|
| 13 | Every confirmed event in the plan has at least one `track()` call | Heavy (10) | Compare `event_plan_confirmed` against AST-found `track()` invocations. |
| 14 | At least one `track()` call landed | Medium (5) | Sanity floor — covers the case where the plan is empty or rejected silently. |
| 15 | Property keys follow the project's lowercase-with-spaces convention | Soft (warn) | `'org id'`, `'project id'`, etc. Soft because customer projects vary. |

## F. Idempotency, health, and build

| # | Criterion | Weight | Notes |
|---|-----------|--------|-------|
| 16 | Re-running the wizard on the same project is a no-op (or only updates) | Medium (5) | Detected by running the wizard twice on the same fixture and diffing the second run's `file_change_applied` set against the first. |
| 17 | Agent's self-verification step passes | Medium (5) | The wizard runs a verification check at the end of integration; this captures whether it self-reported success. |
| 18 | Project still builds and typechecks | Heavy (10) | `pnpm build` (or framework equivalent) exits 0 in the fixture after the run. |

## G. DX artifact

| # | Criterion | Weight | Notes |
|---|-----------|--------|-------|
| 19 | Setup-report artifact is present and accurate | Medium (5) | `setup_complete` event matches the actual filesystem state. The summary doesn't claim files that weren't written. |

**Total:** 4 hard fails + 6 heavy (60 pts) + 8 medium (40 pts) + 1 soft (warn). A run with no hard fails and ≥ 80 pts passes.
