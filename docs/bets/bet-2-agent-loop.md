## Bet 2 — Agent Loop Overhaul

**Branch:** `kelsonpw/agent-loop`
**Depends on:** Bet 1 (needs `wizard cli: agent completed` with cost data to prove cache wins and split phase attribution).
**Effort:** ~2 sprints.

### Goal

Rebuild `runAgent` as a three-phase pipeline with prompt-cached system prefixes, structured status (not text markers), real hooks, and an eval harness. Target outcomes: 50–80% input-token reduction, meaningfully lower p95 time-to-first-token, localized failure modes, reproducible evals before every prompt change.

### Deliverables

#### Prompt caching
- [ ] Insert `cache_control: { type: 'ephemeral', ttl: '1h' }` on commandments + framework-invariant context in `systemPrompt` at `src/lib/agent-interface.ts:1258-1264`.
- [ ] Move per-run values (`projectApiKey`, `projectId`) out of the static prefix in `src/lib/agent-runner.ts:607-611` and into the first user message.
- [ ] Verify via `cache-tracker.ts` — target ≥50% cache hit rate on run 2+.

#### Three-phase pipeline
- [ ] **Planner** — Sonnet 4.6, `maxTurns: 20`. Emits `WizardPlan` JSON (Zod-validated): chosen skill, SDK variant, env var names, target files, predicted events. No file writes allowed (`canUseTool` denies `Write`/`Edit`).
- [ ] **Integrator** — Sonnet 4.6, `maxTurns: 60`. Per-run allowlist derived from the `WizardPlan` (only files the plan named). Calls `confirm_event_plan` once at the boundary on a clean context.
- [ ] **Instrumenter** — Haiku 4.5, `maxTurns: 40`, with `Task` tool enabled for subagent-per-feature runs via existing `discover-event-surfaces` + `instrument-events` skills.
- [ ] Handoffs are validated JSON (Zod schemas in `src/lib/agent/handoff-schemas.ts`), not conversation history.
- [ ] Remove the "no subagents" rule from `src/lib/commandments.ts:24` for the instrumenter phase only.

#### Structured status
- [ ] Add `report_status(kind, code, detail)` MCP tool in `src/lib/wizard-tools.ts`. Zod-validate; rate-limit server-side so the model can't spam.
- [ ] Delete the text-marker regex scanning in `src/lib/agent-interface.ts:1491-1520` (`[STATUS]`, `ERROR_MCP_MISSING`, etc.). `--agent` NDJSON now derives from structured tool calls.

#### Real hooks
- [ ] `PreCompact` — serialize current `WizardPlan` + list of modified files + current workflow step to a side channel so compaction doesn't drop the plan. Restore after compaction.
- [ ] `PostToolUse` on `Write` / `Edit` — run framework-appropriate typecheck/lint; block `Stop` if errors. Auto-retry on `tool_use` / `tool_result` mismatch near the error source.
- [ ] `UserPromptSubmit` — route mid-run slash commands without killing the agent.

#### Eval harness
- [ ] `tests/evals/<framework>/` directories with sealed fixtures driven by `--agent` NDJSON.
- [ ] Assert on handoff JSON per fixture: `confirm_event_plan` happens before any `track(` edit, dashboard created, zero `track()` writes before plan confirmation, no API key appears in committed files, skills applied match plan.
- [ ] Parameterize across every entry in `FRAMEWORK_REGISTRY`. Tie into `pnpm test:e2e`.
- [ ] Pin fixture LLM responses via a replay mechanism so evals are deterministic.

#### Remark feedback loop
- [ ] Weekly GitHub Action runs the existing `review-agent-insights` skill against the last 7 days of `wizard cli: wizard remark` events.
- [ ] Cluster by framework, surface top 3 prompt weaknesses, open a draft PR to `src/lib/commandments.ts` for human review.

### Verification

- Run `pnpm try --benchmark` against the 10 fixtures baselined in Bet 1. Cache hit rate ≥ 50% on run 2+. Input tokens per run down ≥ 40% vs baseline.
- Eval harness green on every `FRAMEWORK_REGISTRY` entry. Introduce an intentional prompt regression in a fixture; the harness must fail.
- `wizard cli: agent completed` shows `phase = planner | integrator | instrumenter` attribution.
- `grep -r "\[STATUS\]" src/` returns zero hits.
- p95 time-to-first-token drops by ≥30% on cold runs vs baseline.

### Kill criteria

- If cache hit rate <40% two weeks after rollout → flag-gate the three-phase pipeline and keep the monolithic loop as default.
- If eval-harness failure rate on prompt changes >20% → pause prompt edits until harness stabilizes.

### Out of scope

- Rewriting commandments content (separate effort, driven by the remark feedback loop post-rollout).
- Cross-provider model routing (owned by Bet 3).
- New skills (the pipeline uses existing skills).
