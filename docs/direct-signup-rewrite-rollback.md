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
