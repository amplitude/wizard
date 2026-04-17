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
