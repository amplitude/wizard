# Rolling back the 2026-04-17 direct-signup stack rewrite

Transient operational doc. Safe to delete once the direct-signup stack
(PRs #96, #104, #105, #106, #111, #113) lands or is abandoned.

## What happened

On 2026-04-17 the 5-PR stack for direct signup was rewritten to fold
two Bugbot-flagged changes into the underlying PRs instead of
appending a 6th stack PR (originally opened as #114, now closed).

- Retry logic was baked into #96 (foundation) as a new commit
  `feat: retry post-signup user fetch on provisioning lag`.
- The `runDirectSignupIfRequested` helper + agent call site was folded
  into #104; #105 and #106 were simplified to trivial helper calls.
- #111 was left content-identical (only rebased + its test mock updated
  to use a provisioned-org shape so the new retry logic doesn't real-wait).
- #113's branch (`feat/direct-signup`) was resquashed into a single
  commit on top of `main`.

All six branches were force-pushed. PR #114 was closed.

## Pre-rewrite backup tags (pushed to origin)

| Branch | Backup tag | Pre-rewrite SHA |
|---|---|---|
| `worktree-wizard-signup` (#96) | `backup/pre-rewrite/pr1-foundation` | `76302ff` |
| `worktree-wizard-signup-pr2-agent` (#104) | `backup/pre-rewrite/pr2-agent` | `b45df0f` |
| `worktree-wizard-signup-pr3-ci` (#105) | `backup/pre-rewrite/pr3-ci` | `14b38c3` |
| `worktree-wizard-signup-pr4-classic` (#106) | `backup/pre-rewrite/pr4-classic` | `3c57fe9` |
| `worktree-wizard-signup-pr5-tui` (#111) | `backup/pre-rewrite/pr5-tui` | `16cd9ba` |
| `feat/direct-signup` (#113) | `backup/pre-rewrite/feat-direct-signup` | `0360008` |

Verify they exist on origin: `git ls-remote --tags origin 'backup/pre-rewrite/*'`

## Second round: 2026-04-17 Bugbot follow-up tags

A second Bugbot pass flagged two post-rewrite issues:

- **Medium** — TUI opens browser after a successful headless signup if
  the redundant post-signup user fetch fails transiently. Fixed in #111
  with a `signupSucceeded` guard around the `forceFresh` OAuth fallback.
- **Low** — `AMPLITUDE_WIZARD_DATA_API_URL` overrode both `us` and `eu`
  zones, inconsistent with `OAUTH_HOST` (US-only). Fixed in #96 by
  scoping the override to `us` only.

Pre-fix tags (restore to the state *after* the first rewrite but
*before* these fixes):

| Branch | Backup tag |
|---|---|
| `worktree-wizard-signup` | `backup/pre-bugbot2-pr1` |
| `worktree-wizard-signup-pr2-agent` | `backup/pre-bugbot2-pr2-agent` |
| `worktree-wizard-signup-pr3-ci` | `backup/pre-bugbot2-pr3-ci` |
| `worktree-wizard-signup-pr4-classic` | `backup/pre-bugbot2-pr4-classic` |
| `worktree-wizard-signup-pr5-tui` | `backup/pre-bugbot2-pr5-tui` |
| `feat/direct-signup` | `backup/pre-bugbot2/feat-direct-signup` |

## Third round: 2026-04-17 Bugbot follow-up #2 tags

A third Bugbot pass flagged that the previous TUI fix (rethrow on
post-signup fetch failure) left the TUI silently stuck — no user-visible
error, no recovery path. Root-cause fix: expose `userInfo` from
`performSignupOrAuth` so the TUI can skip the redundant
`fetchAmplitudeUser` call entirely. This simultaneously resolves the
earlier browser-on-successful-signup finding.

- **#96** — new commit `feat: expose userInfo from performSignupOrAuth`
- **#111** — amended wiring commit to consume `userInfo`; removed the
  `signupSucceeded` rethrow guard

Pre-fix tags:

| Branch | Backup tag |
|---|---|
| `worktree-wizard-signup` | `backup/pre-bugbot3-pr1` |
| `worktree-wizard-signup-pr2-agent` | `backup/pre-bugbot3-pr2-agent` |
| `worktree-wizard-signup-pr3-ci` | `backup/pre-bugbot3-pr3-ci` |
| `worktree-wizard-signup-pr4-classic` | `backup/pre-bugbot3-pr4-classic` |
| `worktree-wizard-signup-pr5-tui` | `backup/pre-bugbot3-pr5-tui` |
| `feat/direct-signup` | `backup/pre-bugbot3/feat-direct-signup` |

## Fourth round: 2026-04-17 Bugbot follow-up #3 tags

Per-PR Bugbot runs after the third rewrite flagged two items:

- **Low** — `AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP` dev override bypasses
  the client feature gate. Dismissed — server-side gating prevents
  unauthorized rollout, so the override is a safe dev affordance.
- **Low** — Stale `signup: true` in one retry test after the wrapper
  signature change. Fixed in #104 by amending the refactor commit to
  also strip the field from the retry test.

Pre-fix tags:

| Branch | Backup tag |
|---|---|
| `worktree-wizard-signup` | `backup/pre-bugbot4-pr1` |
| `worktree-wizard-signup-pr2-agent` | `backup/pre-bugbot4-pr2-agent` |
| `worktree-wizard-signup-pr3-ci` | `backup/pre-bugbot4-pr3-ci` |
| `worktree-wizard-signup-pr4-classic` | `backup/pre-bugbot4-pr4-classic` |
| `worktree-wizard-signup-pr5-tui` | `backup/pre-bugbot4-pr5-tui` |
| `feat/direct-signup` | `backup/pre-bugbot4/feat-direct-signup` |

## Fifth round: 2026-04-17 Bugbot follow-up #4 tags

Per-PR Bugbot runs after the fourth round flagged two items:

- **Low** (#96) — Retry loop only covered "returned but no env with apiKey";
  a `fetchAmplitudeUser` throw on empty orgs bypassed retry entirely. Fixed
  in the retry commit: wraps the fetch in try/catch and retries on throw
  too, propagating only after exhausting all delays.
- **Medium** (#106) — Classic mode's `resolveCredentials` call inherited
  the TUI-only `requireOrgId: true` default, silently clearing credentials
  after a successful signup when no org ID was set. Fixed by passing
  `{ requireOrgId: false }` (matches agent/CI).

Pre-fix tags:

| Branch | Backup tag |
|---|---|
| `worktree-wizard-signup` | `backup/pre-bugbot5-pr1` |
| `worktree-wizard-signup-pr2-agent` | `backup/pre-bugbot5-pr2-agent` |
| `worktree-wizard-signup-pr3-ci` | `backup/pre-bugbot5-pr3-ci` |
| `worktree-wizard-signup-pr4-classic` | `backup/pre-bugbot5-pr4-classic` |
| `worktree-wizard-signup-pr5-tui` | `backup/pre-bugbot5-pr5-tui` |
| `feat/direct-signup` | `backup/pre-bugbot5/feat-direct-signup` |

## Sixth round: 2026-04-17 Bugbot follow-up #5 tags

Per-PR Bugbot runs after the fifth round flagged one item:

- **Low** (#96) — `CliArgsSchema.signupEmail` dropped `.email()` validation
  when yargs-level validation was added, removing defense-in-depth for
  programmatic callers that bypass CLI parsing. Fixed by re-adding
  `.email()` to the zod schema in the `fix: error on malformed --email`
  commit; CLI validation (yargs) still runs first so the user-facing
  error message is unchanged.

Pre-fix tags (same branches as previous rounds, tagged at the post-bugbot5
state):

- `backup/pre-bugbot5-*` tags cover both the 5th-round pre-fix state and
  the 6th-round pre-fix state since the 6th round started from the
  5th-round's pushed tips. No separate pre-bugbot6 tags were created.

## Full rollback — restore every branch to its pre-rewrite state

```bash
for pair in \
  "worktree-wizard-signup:pr1-foundation" \
  "worktree-wizard-signup-pr2-agent:pr2-agent" \
  "worktree-wizard-signup-pr3-ci:pr3-ci" \
  "worktree-wizard-signup-pr4-classic:pr4-classic" \
  "worktree-wizard-signup-pr5-tui:pr5-tui" \
  "feat/direct-signup:feat-direct-signup"; do
  branch="${pair%:*}"
  tag="${pair#*:}"
  git push origin --force \
    "refs/tags/backup/pre-rewrite/${tag}:refs/heads/${branch}"
done
```

Then reopen PR #114 if the 6th-PR approach is still wanted.

## Single-branch rollback

Pick the branch + tag pair from the table above. Example for #104:

```bash
git push origin --force \
  refs/tags/backup/pre-rewrite/pr2-agent:refs/heads/worktree-wizard-signup-pr2-agent
```

Note that rolling back one branch without the ones below/above can
leave the stack in an inconsistent state — each PR branches from the
previous one, so partial rollback usually means cascading.

## After rollback

- Delete the backup tags (optional cleanup):
  `git push origin --delete $(git tag -l 'backup/pre-rewrite/*' | xargs)`
- Delete this doc.

---

# Bugbot Loop — Continuous Review Cycles

Automated loop: trigger Bugbot on all 6 PRs (#96, #104, #105, #106, #111, #113),
wait for results, apply a discerning lens, fix valid findings in small
encapsulated commits (fixup'd into the right base commit), dismiss invalid
findings with reasoned replies, cascade-rebase, resquash #113, repeat.
Cap: 5 cycles.

## Cycle 1 (2026-04-18 early UTC)

**Trigger SHAs:** #96 @ 084dcf1, #104 @ fcb7a24, #105 @ 7bf93ee, #106 @ c55c39e, #111 @ 515654d, #113 @ f2ab371.

**Findings:**

| PR | Result | Finding | Severity | Verdict |
|---|---|---|---|---|
| #96 | ✅ | — | — | — |
| #104 | ⚠️ 1 | "Feature flags never initialized in agent mode" (`bin.ts:761`) | High | **VALID** |
| #105 | ✅ | — | — | — |
| #106 | ✅ | — | — | — |
| #111 | ✅ | — | — | — |
| #113 | ✅ | — | — | — |

**Note on #96 poll timeout:** The poll-bugbot.sh script timed out twice on #96
because Bugbot's check-run completed `neutral` (no findings) without posting a
summary review comment. Verified clean via `/repos/.../check-runs` API.

**Action (Finding K — Feature flags never initialized in agent mode):**

- Root cause: `initFeatureFlags()` is only called in the TUI branch of bin.ts
  (line ~983). Agent, CI, and classic modes never initialize the Experiment
  client, so `isFlagEnabled(FLAG_DIRECT_SIGNUP)` inside `performSignupOrAuth`
  always returns `false` → direct signup silently no-ops in non-interactive
  modes unless `AMPLITUDE_WIZARD_FORCE_DIRECT_SIGNUP=1` is set.
- Fix: add `await initFeatureFlags().catch(() => {})` at the top of
  `runDirectSignupIfRequested` in bin.ts. Idempotent (returns early if
  already initialized), covers all three non-interactive modes in one place,
  redundant-but-safe for the TUI (which doesn't use this helper anyway).
- Fixup'd into the `feat: add runDirectSignupIfRequested helper and wire
  agent mode` commit in #104.

**Backup tag set:** `backup/pre-bugbot6-*` (prior round) — no new tags cut
since the per-cycle deltas are small.

## Cycle 2 (2026-04-18 ~01:55 UTC)

**Trigger SHAs:** #96 @ 084dcf1, #104 @ a05bbfd, #105 @ 4eec193, #106 @ 8481875, #111 @ f727c82, #113 @ 157589a.

**Findings:**

| PR | Result | Finding | Severity | Verdict |
|---|---|---|---|---|
| #96 | ✅ | — (check-run neutral, no summary posted) | — | — |
| #104 | ⚠️ 1 | "No success log in agent signup path" (`bin.ts:467`) | Low | **VALID** |
| #105 | ✅ | — | — | — |
| #106 | ✅ | — | — | — |
| #111 | ✅ | — | — | — |
| #113 | ✅ | — | — | — |

**Action (Finding L — success logging asymmetry):**

- Claim: `runDirectSignupIfRequested` logs on null and on throw, but was
  silent on success when no `onSuccess` callback was provided (agent/CI
  modes). Operators lacked diagnostic confirmation that signup worked.
- Fix: added `getUI().log.info('Direct signup succeeded; using newly
  created account.')` on the non-null tokens path, regardless of whether
  onSuccess runs. Symmetrical with the null and error branches.
- Fixup'd into the `feat: add runDirectSignupIfRequested helper and wire
  agent mode` commit in #104.

## Interlude: CI lint failure (mid-Cycle 3)

Before Cycle 3's bugbot polls landed, CI flagged Prettier failures on all
6 PRs (exit 1) in `src/lib/wizard-session.ts` and
`src/utils/__tests__/direct-signup.test.ts`. Both were indentation
artifacts from my earlier edits that fell outside Prettier's ternary/URL
wrapping rules.

Fix: `pnpm fix` reformatted both files. Split into two fixups:

- `src/lib/wizard-session.ts` → `fix: error on malformed --email
  instead of silently dropping it` commit in #96
- `src/utils/__tests__/direct-signup.test.ts` → `chore: update signup
  endpoint to /t/agentic/signup/v1` commit in #96

Both cascade-rebased through #104→#111. Lint now clean (0 errors, only
pre-existing warnings in unrelated files).

## Cycle 3 (2026-04-18 ~02:10 UTC)

**Trigger SHAs (post-lint-fix):** #96 @ dc0c566, #104 @ 43a41d3, #105 @ 7aa0121, #106 @ 85394fa, #111 @ 14c1b5b, #113 @ 8f26ea2.

**Findings:**

| PR | Result | Finding | Severity | Verdict |
|---|---|---|---|---|
| #96 | ✅ | — (check-run neutral) | — | — |
| #104 | ✅ | — | — | — |
| #105 | ⚠️ 1 | "CI test is verbatim copy of agent test" (`src/__tests__/signup-ci.test.ts`) | Low | **VALID** |
| #106 | ✅ | — | — | — |
| #111 | ✅ | — | — | — |
| #113 | ⚠️ 1 | "Transient rollback doc committed to repository" (`docs/direct-signup-rewrite-rollback.md`) | Low | **PARTIALLY VALID — dismissed with justification** |

**Action (Finding M — redundant CI test):**

- Claim: `signup-ci.test.ts` calls `performSignupOrAuth` directly without
  touching the actual CI bin.ts wiring (`runDirectSignupIfRequested`). The
  three tests are near-identical to `signup-agent.test.ts` and duplicate
  coverage already in `signup-or-auth.test.ts`.
- Verified: correct — the file adds maintenance burden without incremental
  coverage of the CI integration path.
- Fix: dropped the entire `test: add CI-mode signup integration test`
  commit from #105 via interactive rebase (file never existed in the
  rewritten history). #105 now carries only the wiring commit.
- Cascade: #106 and #111 rebased cleanly (neither depends on the dropped
  commit).

**Action (Finding N — transient doc):**

- Claim: This rollback/cycle doc shouldn't ship to main; it's process
  documentation with internal SHAs, better suited for PR descriptions.
- Assessment: Partially valid. The doc IS transient and self-describes
  as such. But it's actively serving its purpose for the multi-PR
  review, and will be removed before anything merges. Bugbot's concern
  holds only if this branch actually merges to main with the doc
  present.
- Decision: dismiss with a reply documenting the "remove-before-merge"
  commitment. No file changes.


## Cycle 4 (2026-04-18 ~02:25 UTC)

**Trigger SHAs (post-M-fix):** #96 @ dc0c566, #104 @ 43a41d3, #105 @ a0b2c38, #106 @ eba72a8, #111 @ 6112b38, #113 @ d1b4111.

**Findings:** none.

| PR | Result |
|---|---|
| #96 | ✅ clean (check-run neutral) |
| #104 | ✅ clean |
| #105 | ✅ clean |
| #106 | ✅ clean |
| #111 | ✅ clean |
| #113 | ✅ clean (check-run neutral) |

Cycle 4 is the first fully-clean verification pass. No action taken.


## Cycle 4 delayed finding — Four signup test files

Bugbot posted a review on #113 at 02:24Z (between Cycle 3 and Cycle 4)
flagging "Four near-identical signup test files duplicate coverage" for
all four `signup-*.test.ts` files (agent, ci, classic, tui). This was an
expansion of the Cycle 3 M finding that flagged only the CI test.

**Verdict:** VALID — same reasoning as M.

**Action:**
- #104: agent-mode test commit dropped via interactive rebase
- #105: rebased off new #104; no changes of its own
- #106: classic-mode test + any leftover CI test deleted in a new
  `test: remove redundant signup-agent integration test` commit
- #111: tui test + leftover CI and classic tests deleted in a new
  `test: remove redundant signup-mode integration tests` commit
- #113: resquashed; no signup-mode integration tests remain


## Cycle 5 (2026-04-18 ~02:45 UTC) — final

**Trigger SHAs:** #96 @ dc0c566, #104 @ e56636a, #105 @ 3caeb2b, #106 @ fe1655c, #111 @ 756563c, #113 @ 19295ff.

**Findings:**

| PR | Result | Finding | Severity | Verdict |
|---|---|---|---|---|
| #96 | ✅ | — (found no new issues; 2 old threads remain unresolved in GitHub UI) | — | — |
| #104 | ✅ | — | — | — |
| #105 | ⚠️ 1 | "Test file duplicates existing coverage without testing wiring" (`signup-agent.test.ts`) | Low | **VALID** — same reasoning as Cycle 4 O |
| #106 | ✅ | — | — | — |
| #111 | ✅ | — | — | — |
| #113 | ✅ | — | — | — |

**Action:** The `01fae36 test: add agent-mode signup integration test`
commit was still in #105's history despite earlier Cycle 3/4 drops
(it re-appeared after cascade rebases). Dropped again via interactive
rebase; verified the file is absent and cascaded downstream.

## Loop termination

Cycle 5 was the final cycle per instruction. #105 had one residual
finding (same pattern as already-dispositioned Finding O, just a
rebase-restore of the stale commit). All other PRs clean.

Final stack state: no open valid Bugbot findings across the 6 PRs.

## History cleanup after Cycle 5

Post-loop review noticed #106 and #111 had add-then-remove commit pairs
for the redundant signup integration tests — functionally correct final
state but noisy commit history. Cleaned up via interactive rebase:

- #106: dropped `a7be22b test: add agent-mode signup integration test`
  AND the no-longer-needed `e60365c test: remove redundant
  signup-agent integration test` cleanup commit. #106 now has just
  `0c58103 feat: wire direct signup into classic mode`.
- #111: dropped all three stale `test: add …` commits (CI, classic,
  TUI) AND the `test: remove redundant signup-mode integration tests`
  cleanup commit. #111 now has just `b51e7c1 feat: wire direct signup
  into interactive TUI`.

Net stack commit layout (per PR):

- #96: 20 commits (foundation)
- #104: 2 commits (`feat: add runDirectSignupIfRequested helper and
  wire agent mode`, `refactor: simplify signup wrapper and remove
  implicit OAuth fallback`)
- #105: 1 commit (`feat: wire direct signup into CI mode`)
- #106: 1 commit (`feat: wire direct signup into classic mode`)
- #111: 1 commit (`feat: wire direct signup into interactive TUI`)
- #113: 1 squashed commit

No functional change — final tree on each branch is identical to
pre-cleanup. 1050 tests pass, lint clean, TS clean.
