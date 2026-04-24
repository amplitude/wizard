# Audit G1 — Add update-notifier

**Category:** CLI
**Effort:** M
**Status:** Scaffolded (design note only).

## Scope

Add update-notifier. See `docs/audit-branches.md` for the full list of audit
findings; this branch holds the per-finding design note so the fix has a
single home when implementation lands.

## Implementation plan

1. Reproduce the finding against the current main HEAD.
2. Write a failing unit/integration test capturing the observed behavior.
3. Ship the fix in a single focused commit on this branch, update this
   file's Status to `Implemented`, and replace the plan with a short
   "what changed" summary.

## Why scaffolded

Scope exceeds what the audit-branch sweep could safely land in one pass.
Effort rating: **M**. Implementation belongs with a dedicated
review cycle and associated tests.
