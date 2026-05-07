# Merge Log

A running record of in-flight pull requests with merge holds, blockers, or
follow-ups that gate them. Append new entries at the top.

## PR #600 — pre-flight context injection

**Status:** HOLD pending the project-size gate.

**Why the hold:** Internal LLM-reliability research flagged a contradiction
between the unconditional pre-flight Markdown block PR #600 introduces and
Anthropic's "just-in-time context loading" guidance for medium-and-up
codebases. On a small project the structured summary eliminates ~30s of
cold-start probing. On a project with > 200 source files or > 50 confirmed
events, the same block burns attention budget the model should be spending
on `read_file` / `grep` exploration of the specific files it actually has
to edit.

**Resolution:** the follow-up PR `kelson/preflight-gate-on-project-size`
gates `buildPreflightContext` on a fast (≤ 5s) project-size scan. Small
projects keep the full pre-flight block; medium-and-up projects get a
short JIT-exploration prompt instead. Thresholds default to 200 files /
50 events and are overridable via
`AMPLITUDE_WIZARD_PREFLIGHT_FILE_THRESHOLD` and
`AMPLITUDE_WIZARD_PREFLIGHT_EVENT_THRESHOLD`.

The HOLD on #600 lifts as soon as the gate PR lands — the two PRs together
implement the recommendation.

**Follow-up PR:** _to be linked once `gh pr create` returns the URL._
