# Wizard — Migration Plan (in-tree, AI SDK target)

**Status:** binding execution plan. Effective 2026-05-06.
**Authoring inputs:** the 12-PR Kelson stack on `amplitude/wizard` (#541→#553); the eval-scaffolding draft #537; the signup work #534/#535/#539/#220; the classic-mode removal #558; ground-truth verification across `wizard`, `wizard-rewrite`, `wizard-v2`, `context-hub`. Consolidates and supersedes the prior `MIGRATION_PLAN.md`, `NEW_MIGRATION_PLAN.md`, and `SKILLS_AND_CONTEXT_DESIGN.md` — content from those docs is folded inline below where relevant (skills/context architecture lives in §8).

> One-line restatement of the strategy: ship the valuable ideas from `wizard-rewrite` and `wizard-v2` **inside `amplitude/wizard`**, on a flag-gated AI-SDK path, with measurable performance budgets and an eval gate — no second repo cutover, no LangGraph, no Python in the wizard surface.

---

## 1. Why this plan

The strategic direction (in-repo evolution, AI-SDK target, phased extraction) is right. The earlier write-ups got that part. This plan binds three things they were silent on:

1. **The 12-PR stack already in flight.** PRs #541→#553 are landing the gateway sanitizer, the install-presentation seam, the `load_skill` tier tools, the AI-SDK gateway probe, the AI-SDK Anthropic factory, the `wizard-tools` skill-module split, and `get_event_plan` on the external MCP — i.e. most of Phase A and Phases B-D's seams. The execution plan must order itself **on top of** that stack, not in parallel with it.
2. **Performance is the success metric, but no budgets are stated.** The wizard already has `src/lib/middleware/benchmarks/` (cache, cost, duration, token, turn, compaction, context-size trackers). `wizard-rewrite/benchmarks/` has bundle-size, cache-hits, first-token-latency, prefix-size, and tool-exec-time bench files. We can land hard budgets immediately.
3. **Eval gating is undefined.** PR #537 scaffolds `evals/` with NDJSON contract, fs-snapshot, scorer registry, layer 0+1 scorers, and 7 ring-1 scenarios — but no fixtures yet and no CI gate. AI-SDK migration parity has to be measured against this harness or it will drift.

This plan adds: a verified ground-truth section, a perf-budget regime, an eval-gate definition for the AI-SDK cutover, and an explicit merge order for the existing stack.

---

## 2. Verified ground truth (2026-05-06)

Source: cross-repo verification, file-cited.

| Claim | Reality |
|---|---|
| `wizard-rewrite` uses `streamText` with prompt caching | **True.** `src/agents/wizard-agent-loop.ts:190,336` (`streamText`); `:516,522` (`cacheControl: { type: 'ephemeral' }` on the system block). 3 tools wired today: `read_file`, `detect_framework`, `load_skill`. |
| `wizard-rewrite` still depends on LangGraph | **False.** `@langchain/langgraph` is not in `package.json` and not imported under `src/`. Only present as a transitive remnant in `node_modules`. `docs/drop-langgraph-plan.md` exists. The 12 files under `src/graph/nodes/` are plain async functions today. |
| `wizard-v2` is the AI-SDK reference | **Partial.** Uses `generateText` (`src/llm/client.ts:118,148`) — not streaming. Has the inline schema/header sanitizer (`:41,55,71,111`) and a complete eval harness at `evals/` (baseline.json, runner, scoring, scoring tests, fixtures). Does not use `cacheControl`. |
| `ai` and `@ai-sdk/anthropic` versions | Both rewrite and v2 pin `ai ^6.0.174` and `@ai-sdk/anthropic ^3.0.74`. Wizard main now depends on these too via PR #548. |
| `wizard-rewrite` has a perf benchmark harness | **True.** Top-level `benchmarks/`: `bundle-size.bench.ts`, `cache-hits.bench.ts`, `first-token-latency.bench.ts`, `prefix-size.bench.ts`, `tool-exec-time.bench.ts`, plus `baseline.json` and `results.json`. Direct port target. |
| `wizard` main has its own per-turn telemetry | **True.** `src/lib/middleware/benchmarks/`: `cache-tracker.ts`, `compaction-tracker.ts`, `context-size-tracker.ts`, `cost-tracker.ts`, `duration-tracker.ts`, `token-tracker.ts`, `turn-counter.ts`, `summary.ts`, `json-writer.ts`. Wizard already measures most of what we need; missing piece is **assertions** (budget gates) and the offline bench-runner shape from rewrite. |
| `WizardInstallPresentation` exists and is wired in rewrite | **True.** `src/cli/wizard-ui/types.ts:15` — ~17 methods, used by `wizard-agent-loop.ts:26,287`, every graph node, and three real implementations (Ink, Clack, machine-NDJSON). Not a stub. |
| `mcp-marketplace` is reachable | **Not local.** Not under `~/worktree-repos`, `~/amplitude-repos`, or `~/repos`. Treat as remote-only; depend only on the published artifacts pulled by `scripts/refresh-instrumentation-skills.sh`. |
| `wizard-proxy` location | Lives in **`thunder`**, not `app-api`: `~/amplitude-repos/javascript/server/packages/thunder/src/wizard-proxy/`. Earlier plan docs naming `app-api` are wrong on path. |
| `src/lib/agent/` extraction directory | **Exists on PR branches only.** Not on `main` yet; only on the stack and `cursor/ai-sdk-probe-optimizations-6fbd`. The PR #549 factory and #548 probe live there. |
| `src/lib/gateway-request-sanitize.ts` | **PR-branch only** (#541 / #550 / a cursor branch). Not on `main`. |
| context-hub `skills/` layout | **`instrumentation/`, `taxonomy/`, `wizard/`** subdirs. `integration/` skills are **generated** from `transformation-config/` at build time, then published in `dist/skills/` along with `skill-menu.json`. Wizard's `skills/integration/` is the *consumption* side, not the source-of-truth side. Confirms the SKILLS doc; the wizard `CLAUDE.md` description is accurate, just not pointing at where the skill bodies live in source. |

---

## 3. Strategic posture (binding decisions)

These decisions bind the rest of the document. Reopen only with explicit approval.

1. **Stay in `amplitude/wizard`.** No second repo cutover. Major version bumps are reserved for breaking packaging changes (ESM exports, Node floor), not source-tree moves. `wizard-rewrite` and `wizard-v2` are reference implementations and will be archived once the in-tree port is parity-equivalent.
2. **AI SDK is the only long-lived inner-loop runtime.** Anthropic Agent SDK stays as the default until parity gates pass. After cutover, the Agent SDK code path is **removed**, not flagged off — to retire the dual stack permanently.
3. **One bundled MCP runtime.** Continue on `@modelcontextprotocol/sdk`. Generate the external `wizard-mcp-server.ts` tool surface from the same Zod sources that drive the in-process wizard tools (PR #553's `get_event_plan` is the first instance).
4. **No LangGraph. No Python in the wizard surface.** `amplitude_ai`, `mcp_gateway`, `houston/chat` stay coordination points, not adoption targets.
5. **TUI lifts; doesn't rewrite.** Ink + nanostores + flows.ts + router.ts stay. Decoupling is at the `WizardInstallPresentation` seam landing in PR #543.
6. **Backwards-compat surface is binding for the read side; new writes target the modern paths.** Yargs flags, slash commands, NDJSON schema, exit codes, and modern storage paths (`~/.amplitude/wizard/` for user state, `<installDir>/.amplitude/` for project metadata — the same model `wizard-rewrite` / `wizard-v2` use) are stable across minor versions. Read-side compat for `~/.ampli.json` and per-project `ampli.json` stays for one minor cycle. **New writes go to the modern paths only** — the dual-write `ampli.json` mirror documented in `CLAUDE.md` is being retired. Active migration tracked in §5 Phase G.
7. **wizard-proxy extraction is non-blocking.** Phase 1 client sanitizer (PR #528 already shipped, #541/#550 on stack) is the user-facing answer. Server-side hardening in `thunder/wizard-proxy` is post-cutover work and is the platform team's call when scheduled.
8. **Tool-first decomposition.** Every important LLM-driven decision is a typed tool call with Zod-validated input/output, not a free-form prompt-and-parse. The agent loop is an orchestrator over tools; deterministic logic stays out of the loop. This makes each decision (a) replayable from a recorded fixture, (b) independently scored, (c) swappable at the tool boundary without refactoring the loop, (d) generatable as an MCP tool for ambient-agent mode without a second implementation.
9. **Per-call-site eval coverage.** Every LLM call in the wizard ships with a fixture and a scorer. New tool = new fixture + scorer in the same PR. No exception path. The §7.2 cutover gate is the *floor*; per-call coverage is the *base*.
10. **Model tiering per call site.** Use the cheapest capable model per call. Haiku for one-shot structured outputs (skill selection, framework disambiguation, single-decision confirmations); Sonnet for the inner agent loop and reasoning-heavy instrumentation; Opus only when explicitly justified at the call site. Decision lives next to the tool definition; no global model knob.

---

## 4. Where we are right now (the existing stack)

The 12-PR stack rooted at PR #541 (`kelson/new-incremental-migration-plan`) covers Phases A and the *seams* of Phases B-D. It must merge in this order; later PRs rebase as earlier ones land:

| # | PR | Phase | What it does |
|---|---|---|---|
| 1 | #541 | code | Ports pure `sanitizeWizardRequestInit` + tests (doc piece dropped in favor of this consolidated plan). |
| 2 | #542 | A | Wires the gateway fetch sanitizer into the Agent SDK subprocess. |
| 3 | #543 | B | `WizardInstallPresentation` seam (in-tree, ported from rewrite). |
| 4 | #544 | C/D | `model-config` extraction + `AMPLITUDE_WIZARD_SKILL_TIERS` flag, `load_skill` tier-2 tool. |
| 5 | #545 | C | `load_skill_reference` tier-3 tool. |
| 6 | #546 | C | `load_skill_menu` tier-1 helper. |
| 7 | #548 | D | Vercel AI SDK gateway probe (`AMPLITUDE_WIZARD_AI_SDK_PROBE=1`) + package `exports`. |
| 8 | #549 | D | Shared `createWizardAiSdkAnthropic` factory + console agent driver path. |
| 9 | #550 | A | Gateway schema-tree guard + `sanitizingFetch` contract tests. |
| 10 | #551 | E | `wizard-tools` decomposition (skill modules). |
| 11 | #552 | D | Transient LLM retry helpers extracted from `agent-interface.ts`. |
| 12 | #553 | E | `get_event_plan` on the external MCP server. |

Independent work that runs alongside the stack (does not gate it):

- **#547** — pin context-hub release for integration refresh CI.
- **#554/#555** — pin context-hub + mcp-marketplace refs for skill refresh.
- **#556/#557** — bundled-skill helper refactor + `parseEventPlanContent` direct test coverage.
- **#558** — remove `--classic` mode (collapses 4 mode branches → 3).
- **#537** — `evals/` scaffold (no fixtures yet).
- **#534/#535/#539/#220** — server-driven signup flow.
- **#519/#518/#525/#529/#536** — TUI hardening, NDJSON redactor, dashboard journey wiring, returning-user fix, `--agent` help visibility.

---

## 5. Phased roadmap

Estimates are order-of-magnitude. Phases A and parts of B-D are largely *in flight*; the work below is what remains. Each phase has a "definition of done" tied to a measurable signal.

### Phase A — Reliability + gateway correctness (done by stack land)

**In flight:** #542, #550 wire and contract-test the sanitizer. #552 isolates LLM retry. Beta-header gating + Sonnet-4.6 default already on `main`.

**Remaining:**
- Land #541→#542→#550 in order; assert via the new contract tests that the wire body never carries `$schema`, `additionalProperties`, `exclusiveMinimum`, `exclusiveMaximum`, or `anthropic-beta` headers when tools are present.
- Add a structured `gateway_400_invalid_request` exit/event with a remediation pointer.

**Done when:** the `--agent` mode 400 rate inside Claude Code / Cursor / Cline is ≤1% across 7 days of telemetry, measured via the existing `wizardCapture` analytics.

### Phase B — Presentation + orchestration decoupling (in flight, 1-2 weeks remaining)

**In flight:** #543 lands the seam. #519/#518 stabilize PTY smoke + NDJSON redaction.

**Remaining:**
- Route the welcome + confirm + spinner screens through `WizardInstallPresentation` (Ink impl), then the agent streaming surfaces (`appendAgentText` / `appendToolStart` / `appendToolResult` from rewrite's interface).
- Add a property-based test mirroring `flow-invariants.test.ts` for the install pipeline, asserting that any path through the install graph emits the same NDJSON envelope set in `--agent` mode that the TUI renders.

**Done when:** a single orchestration path drives both TUI and `--agent` for the welcome → detect → confirm-framework → install spine, and `flow-invariants` + new install-invariants tests are green.

### Phase C — Skills & context economics (in flight; closes after #544-#546 + Phase 6 work)

Implements the three-tier delivery contract defined in §8.

**In flight:**
- #544 adds `AMPLITUDE_WIZARD_SKILL_TIERS=1` and `load_skill` (Tier 2 inline-body return).
- #545 adds `load_skill_reference` (Tier 3, no disk staging).
- #546 adds the `load_skill_menu` Tier 1 helper.
- #547/#554/#555 pin the context-hub + mcp-marketplace release tags so CI is reproducible.

**Remaining:**
1. **Default the flag on** once Tier-1 cache hit rate ≥ 70% across 50 representative agent runs. Then drop `preStageSkills` and `cleanupIntegrationSkills` per §8.7 slice 1.
2. **Phase commandments split** per §8.3. Move `src/lib/commandments.ts` to `src/lib/commandments/{always-on, phase, framework}/*.ts` and place cache breakpoints 1-4 per §8.4.
3. **Deduplicate `browser-sdk-2.md`** in `context-hub` (the single biggest token-waste item, ~13.1k tokens duplicated across 10+ integrations) and collapse `wizard-prompt-supplement` into the always-on commandments. Lands as a paired PR (context-hub side + wizard side) per §10 decision 1.
4. **Token-budget linter** in context-hub CI: ≤2,000 tokens per `SKILL.md` body, references larger but lazy.

**Done when:** median cold-start prompt drops from ~13.5k to ≤7.5k tokens; mid-run worst case drops from 35-45k to ≤22k; cache-read share ≥80% by turn 3 on representative runs.

### Phase D — AI SDK migration (in flight; the long pole)

This is where the strategic bet pays off. Order the slices to keep the Agent SDK path live and parity-checkable until the AI-SDK path is provably equal or better.

**Slice D-1 (in flight):** AI-SDK gateway probe (#548) + shared Anthropic factory (#549). Probe is opt-in (`AMPLITUDE_WIZARD_AI_SDK_PROBE=1`). Already produces `streamText` + `sanitizingFetch` against the live gateway.

**Slice D-2 (next):** AI-SDK ConsoleView path on by default for slash commands (`AMPLITUDE_WIZARD_AI_SDK_CONSOLE=1` flips to default once we have 1k probe runs without regressions). Console is the smallest agent surface — good first cutover target.

**Slice D-3:** Build the AI-SDK runner for the **inner agent loop** under `src/lib/agent/`:
- `agent/run-agent.ts` — thin orchestrator wrapping `streamText` (port `wizard-rewrite/src/agents/wizard-agent-loop.ts:190-336` shape).
- `agent/tool-policy.ts` — Bash + path policy as middleware (replaces 200-LOC `createPreToolUseHook` and 225-LOC `wizardCanUseTool`). Plan honestly: ~150-200 LOC, not 50.
- `agent/journey-state.ts` — journey advancement + stall timer + heartbeat (extracted from the 1,569-LOC `runAgent`).
- `agent/tool-result-watcher.ts` — dashboard + event-plan polling.
- `agent/stream-presenter.ts` — pill renderer.
- Carry `cacheControl: { type: 'ephemeral' }` on the system block, mirroring `wizard-rewrite/src/agents/wizard-agent-loop.ts:516,522`.

**Slice D-4:** Bridge the wizard's existing in-process MCP server to the AI SDK via `experimental_createMCPClient`. Keep the experimental import behind an internal interface so a v7 SDK rename isn't a 50-file diff.

**Slice D-5:** Default the AI-SDK runner on under `AMPLITUDE_WIZARD_AI_SDK=1` (inverted: opt-out flag becomes opt-in for the legacy path). Run for 14 days at default-on, opt-out, with the §7.2 eval gate green every scheduled run. Per §10 decision 4 the cutover is a hard 100% flip in one release after the gate holds — no staged % rollout — so the gate cannot be soft.

**Slice D-6:** Delete the Agent SDK runner. Remove `runAgentLocally`, `console-query.ts`'s second path, the SDK-mirror types in `agent-interface.ts:97-148`, and the bash-policy duplication. Target: shrink `agent-interface.ts` from 4,112 LOC to <1,000 LOC.

**Done when:** D-5 holds for 14 days at default-on with the eval matrix in §7 fully green. D-6 ships as the first 2.0.0 candidate.

### Phase E — `wizard-tools` decomposition (in flight)

**In flight:** #551 splits `wizard-tools.ts` into per-tool modules. #553 starts generating MCP tool surface from the same Zod sources.

**Remaining:**
- Finish 9 modules under `src/lib/wizard-tools/*.ts`, ~150-220 LOC each (be honest — the rewrite proves this is the realistic size).
- Generate or mirror MCP tool definitions from the same Zod sources. Two-stack drift is the failure mode this prevents.
- Drive PreToolUse policy from a single declarative table consumed by both the AI-SDK middleware and the legacy SDK hook (until D-6 deletes the latter).

**Done when:** no single file in the agent hot path >2,000 LOC without an exception comment; the external MCP server tool defs are generated, not hand-mirrored.

### Phase F — Packaging 2.0 (sequenced after D-6 + E)

- ESM-only library, CJS bin, `tsup` build, `exports` map, Node 22 floor.
- Drop dead deps confirmed unused: `zod-to-json-schema`, `xcode`, pinned `chalk@2.4.2`.
- Ship `@amplitude/wizard@2.0.0` from this repo. Same npm name; the version bump is the cutover.
- Backwards-compat read for `~/.ampli.json` and per-project `ampli.json` for one minor; drop in 2.x minor after telemetry confirms migration (Phase G).

**Done when:** `release-please` opens the 2.0.0 PR, the backwards-compat test suite is green, and one week of internal dogfood passes.

### Phase G — Storage migration (sequenced after F, can begin in 2.x minors)

**Goal:** stop writing `ampli.json`; eventually stop reading it. Adopt the storage model `wizard-rewrite` and `wizard-v2` already use: `~/.amplitude/` for user state, `<installDir>/.amplitude/` for project metadata. Per strategic posture #6, the modern paths are now the *only* write target.

**Current state (verified 2026-05-06):**

| Path | Status |
|---|---|
| `~/.amplitude/wizard/{oauth-session.json, credentials.json, runs/, plans/, state/}` | Modern. Already used. |
| `<installDir>/.amplitude/{events.json, project-binding.json, dashboard.json}` | Modern. Already used. |
| `~/.ampli.json` | Legacy. Still written by `src/utils/ampli-settings.ts` (474 LOC) for OAuth tokens. |
| `<installDir>/ampli.json` | Legacy. Still written as a mirror per `CLAUDE.md`'s transition note. `src/lib/ampli-config.ts` (371 LOC) handles read + the `WorkspaceId → ProjectId` migration. |
| TUI references to `ampli.json` | ~30 files (audited 2026-05-06). |

**Slicing:**

**G-1.** Stop writing the `ampli.json` dual-write mirror. Keep `src/lib/ampli-config.ts` read path intact; verify no caller depends on the write side via grep + test.

**G-2.** Migrate the ~30 TUI references to read from modern paths only. On first read where the modern path is absent and the legacy path exists, perform a one-shot copy-forward from `ampli.json` → `<installDir>/.amplitude/*.json`; log the migration once per project.

**G-3.** Add a startup one-shot migration: on wizard launch, if `~/.ampli.json` exists and `~/.amplitude/wizard/oauth-session.json` does not, copy the OAuth state forward and mark the legacy path read-only.

**G-4.** Remove `src/utils/ampli-settings.ts` and `src/lib/ampli-config.ts`. Remove the `WorkspaceId → ProjectId` migration code (the one-shot has already run by this point in any reachable upgrade path).

**G-5.** Drop `~/.ampli.json` and per-project `ampli.json` reads entirely in a 2.x minor after telemetry confirms <0.1% of runs read those paths.

**Done when:** zero references to `ampli.json` or `~/.ampli.json` outside one-shot migration code; `pnpm test` green; telemetry confirms migration ran on >99% of upgraded installs.

**Why this matters:** the dual-write tax is real (`ampli-config.ts` is 371 LOC + 474 LOC of `ampli-settings.ts` plus 30 TUI references). It's also a correctness risk — every code path that needs to know "where does the wizard store X?" has two answers, and the answer drifts by file. Concentrating writes on the modern paths makes the wizard's storage model documentable in one paragraph (per the `Session storage` table in `CLAUDE.md`) instead of a transition rule.

---

## 6. Performance budgets and benchmark harness

Performance is product-critical. We already collect the right signals via `src/lib/middleware/benchmarks/`. Two gaps: (a) we don't *assert* against budgets, (b) we don't have an offline harness for cold-start / first-token / tool-exec measurements.

### 6.1 Adopt `wizard-rewrite/benchmarks/` shape into the wizard repo

Port the five `*.bench.ts` files and the `baseline.json` / `results.json` shape into the wizard's existing `benchmarks/` (top-level, distinct from `src/lib/middleware/benchmarks/` which is per-turn telemetry). One target: `pnpm bench` runs them; CI uploads `results.json` as an artifact and diffs against `baseline.json`.

`first-token-latency.bench.ts` and `cache-hits.bench.ts` need to hit the live gateway for honest numbers — they consume the auth secrets wired in §7.5.

### 6.2 Budgets (binding once Phase C lands; revisit per phase otherwise)

| Metric | Source | Budget | Failure mode |
|---|---|---|---|
| Cold-start prompt tokens (median) | `context-size-tracker.ts` | ≤ 7,500 | block PR via CI assertion |
| Mid-run worst-case prompt tokens | `context-size-tracker.ts` p99 | ≤ 22,000 | budget warning, manual triage |
| Cache-read share by turn 3 | `cache-tracker.ts` | ≥ 0.80 | budget warning |
| First-token latency (cold) | `first-token-latency.bench.ts` | ≤ 4.0 s p50 | block PR |
| First-token latency (warm) | `first-token-latency.bench.ts` | ≤ 1.5 s p50 | block PR |
| Cold-start to first prompt | `duration-tracker.ts` | ≤ 6.0 s p50 | budget warning |
| Compaction events per run (median) | `compaction-tracker.ts` | 0 | budget warning if >0 in median |
| Bundle size (npm tarball) | `bundle-size.bench.ts` | ≤ 110% of last release | block PR |
| Tool exec time (read_file, p50) | `tool-exec-time.bench.ts` | ≤ 50 ms | budget warning |

Budgets are enforced at PR time; the cache-read budget is a *warning* not a *block* until Phase C closes (otherwise we'd be gating the migration on its own outcome).

### 6.3 What we are *not* measuring

We are not measuring AI SDK vs Agent SDK runtime overhead head-to-head; the eval-matrix outcome (§7) is the binding parity signal. Adding a perf-only A/B is a distraction.

### 6.4 LLM performance levers (in addition to budgets)

Budgets prevent regression; the levers below are how the wizard wrings throughput, latency, and cost out of every call. Each is owned by a specific PR or phase.

| Lever | Where | Measured by | Owner |
|---|---|---|---|
| **Prompt caching** on the cache-stable prefix (system + always-on commandments + Tier-1 skill menu). 4 breakpoints per Anthropic limits. | `agent/run-agent.ts` (Phase D-3); `wizard-rewrite/src/agents/wizard-agent-loop.ts:516,522` is the reference | `cache-tracker.ts` cache-read share | Phase C |
| **Model tiering per call site.** Haiku for short structured outputs, Sonnet for the inner loop, Opus only with justification. | Each tool definition pins its model. Use AI SDK `generateObject` with Haiku for one-shot decisions; `streamText` with Sonnet for agentic loops. | `cost-tracker.ts` per-call-site cost breakdown | Phase D-3 (with the runner build) |
| **Structured outputs via Zod**, never free-form text + parse. | Every wizard tool. AI SDK `generateObject` for non-loop calls. | Schema-validation pass-rate at the scorer layer | Phase E (tool decomposition) |
| **Strict mode tools** opt-in per tool — short-circuits invalid arguments before the model retries. | AI SDK `tool({ strict: true })` per tool. | Tool-call retry rate | Phase E |
| **Parallel tool calls** where the wizard's path policy permits. | AI SDK native batching; `tool-policy.ts` declares which tools are parallel-safe. | `duration-tracker.ts` per-turn wall-clock | Phase D-3 |
| **One retry layer.** AI SDK `maxRetries: 0`; the wizard owns its classifier (PR #552 extracts it). | `agent/transient-llm-retry.ts` (#552). | Retry-blowup count (target: 0) | #552 |
| **Context compression at phase transitions** via `prepareStep`. Phase commandments invalidate cleanly at the breakpoint, not mid-turn. | `commandments/index.ts` (Phase C); `prepareStep` hook in `agent/run-agent.ts`. | `compaction-tracker.ts` events per run | Phase C + D-3 |
| **Per-tool result trimming.** Long tool outputs (file reads, grep results) get summarized into the loop, not pasted whole. | `agent/tool-result-watcher.ts` (Phase D-3). | `context-size-tracker.ts` p99 | Phase D-3 |

The combination of caching + tiering + structured outputs is where the real cost/latency wins live. The §8.5 estimate (2-4 minutes wall-clock saved per run, ~60-70% input-cost reduction on a typical run) holds when these are applied together; it does not hold for caching alone.

---

## 7. Eval strategy and AI-SDK cutover gate

PR #560 (`ba-104-add-eval-suite`, supersedes #537) lands the `evals/` framework: NDJSON-driven runner, layer-0/1 scorers (4 hard-fail + 7 structural), one Ring 1 fixture (Next.js App Router vanilla) scoring 50/50 end-to-end, and a 19-point quality checklist (`evals/spec/quality-criteria.md`). The wire-format boundary at `src/lib/agent-events.ts` is the eval surface — which means evals are decoupled from the inner runtime (Agent SDK now, AI SDK after D-5). This plan binds that framework to the AI-SDK migration as the cutover gate.

### 7.1 Adopt PR #560's framework as the canonical surface

PR #560 is the eval framework. **Do not fork it.** Build on top:

1. Land the first canonical fixture pair beyond Next.js vanilla: `nextjs-app-router-existing` (analytics already partially wired), `react-router-7-framework`, `react-vite-vanilla`, `expo-vanilla`, and the generic-probe scenario from PR #537's original ring-1 list.
2. Promote the L1 `confirmed-events-tracked` regex (`evals/scorers/layer1-structural/confirmed-events-tracked.ts`) to AST via `@typescript-eslint/parser` — `track(eventName)` with a variable name slips past the regex today.
3. Land Layer-2 (static SDK rules), Layer-3 (`pnpm build` outcome), Layer-6 (judge with versioned rubric) scorers in that order. Layer-4 (runtime) and Layer-5 (ingestion) are post-2.0.
4. Resolve the four high-impact issues raised in the PR #560 review before the cutover gate hangs off this framework: gateway auth via §7.5 env vars (not `--api-key`), stderr capture + redaction, scenario schema validation, framework→SDK table for Layer 0.

`wizard-v2/evals/` and `wizard-rewrite/evals/` remain reference implementations cited from in-tree code, not adoption targets — PR #560 is the canonical surface.

### 7.2 The AI-SDK cutover eval gate

Slice D-5 (default-on) blocks until **all** of the following hold for two consecutive weeks against the AI-SDK path, scored against the Agent-SDK path's last-seven-day baseline:

- L0 (no-hardcoded-key, exit-code consistency, NDJSON envelope conformance): 100% pass.
- L1 (confirmed events emit `track()` calls with correct names): ≥95% pass on ring-1 scenarios.
- L2 (static SDK rules): ≥98% pass.
- L3 (`pnpm build` succeeds in the working fixture): 100% pass.
- L6 (judge): mean rubric score ≥ baseline.
- Per-turn input tokens (median): ≤ Agent-SDK baseline (i.e. the AI-SDK path is not regressing prompt economics).

Failing any of these for two consecutive scheduled runs reverts the default flip.

### 7.3 CI cadence

- **Per PR (PR-gate):** L0 + L1 only, on `nextjs-app-router-vanilla` + `react-vite-vanilla`. Target: <8 min wall-clock.
- **Nightly:** all ring-1 scenarios, L0-L3 + L6.
- **Pre-release:** all ring-1, all layers including L4/L5 once they exist.

### 7.4 Per-call-site eval coverage (the floor)

The §7.2 cutover gate is the ceiling test. The floor is: **every LLM call in the wizard has its own fixture and scorer**, and a new call cannot land without them. This is a binding consequence of strategic posture decisions 8 and 9.

**Critical alignment with PR #560:** per-call-site coverage **shares** PR #560's runner — it is not a parallel framework. Concretely, both end-to-end scenarios (PR #560's `evals/scenarios/`) and per-call-site fixtures (this section's `evals/call-sites/`) feed the **same** `score()` function in `evals/runner/score.ts` consuming the **same** `Artifact` shape from `evals/runner/types.ts`. Only the *artifact source* differs.

#### Layout (extending PR #560's tree)

```
evals/
  runner/         <-- PR #560: as-is, shared
    score.ts      <-- shared scoring entry point
    types.ts      <-- shared Artifact / Scorer interfaces
    invoke-wizard.ts <-- gains a third invocation mode: runCallSite
  scenarios/      <-- PR #560: end-to-end Ring 1+ scenarios
  call-sites/     <-- new in this plan
    propose-event-plan/
      fixture.json   <-- input context at call moment
      golden.ndjson  <-- recorded response
      scorer.ts      <-- exports a Scorer for runner/score.ts
    select-skill/
    inner-loop-streamtext/
  scorers/        <-- PR #560: cross-cutting layer scorers
  spec/
```

Every LLM call site ships three artifacts under `evals/call-sites/<call-site-id>/`:

1. **Fixture** — the input context at the call moment: cwd snapshot (or hash), framework detection state, prior tool outputs, the prompt + system prefix at that breakpoint, the model id, the cache-control layout. Stored as JSON (or NDJSON for streaming sites).
2. **Scorer** — exports a `Scorer` matching `runner/types.ts`. Asserts the output satisfies the call's contract:
   - Structured-output sites (`generateObject`): schema validation + semantic checks (e.g. `propose_event_plan` returns ≤ N events, all with snake_case names).
   - Streaming sites (`streamText`): the layered scorers from §7.1 applied to the call's slice of the run.
   - Tool-decision sites (which-tool-to-call): a deterministic check that the chosen tool matches the fixture's labeled correct tool, plus a fuzzier judge (Layer-6) for ties.
3. **Golden response** — runs the fixture against the live call site (no model swap) and against the recorded golden. Drift detection runs nightly; PRs that touch the call site re-record the golden.

#### Runner extension

PR #560's `evals/runner/invoke-wizard.ts` exposes `runLive` and `runReplay`. This plan adds a third: **`runCallSite`**. It builds an `Artifact`-shaped envelope from a single tool call (live LLM invocation against the gateway, or golden replay) and hands it to the same `score()` function. Implementation is small: a wrapper that executes one tool call instead of spawning the wizard binary.

#### Eval registry

`evals/call-sites/registry.ts` maps call-site IDs to:
- Source location of the call (`src/lib/agent/run-agent.ts:run`, `src/lib/wizard-tools/propose-event-plan.ts:invoke`, etc.).
- Fixture path.
- Scorer module.
- Model + breakpoint config at the time of the recorded golden.

PR template gains a line: *"If this PR adds, removes, or changes an LLM call site, list call-site IDs and confirm fixtures + scorers + golden responses are updated in the same diff."* Reviewer enforces.

#### CI

The PR-gate (§7.3) runs the **call-site fixtures whose IDs the PR touches**, not just the ring-1 scenarios. Touching `src/lib/wizard-tools/propose-event-plan.ts` runs the `propose-event-plan` fixture suite. Nightly runs the full call-site registry against goldens; drift opens an issue auto-tagged `eval-drift`.

#### Boot strap

1. PR #560 lands. Open a follow-up PR adding `runner/invoke-wizard.ts:runCallSite`, `evals/call-sites/registry.ts`, and the first three call-site fixtures.
2. First three call sites covered as proof: `propose_event_plan` (PR #553's surface), `select_skill` (the Tier-2 `load_skill` decision from #544), and the inner-loop `streamText` site (Phase D-3).
3. Every call site added in Phase D-3 onward lands paired. The Agent-SDK call sites get covered as they're ported to the AI-SDK runner — by D-6, every remaining call site is registered.

### 7.5 Gateway auth for CI evals and benches

The eval harness (§7.1) and bench harness (§6.1) both need the wizard's `--agent` runner to actually hit the live LLM gateway (`thunder/wizard-proxy`) — that is the binding parity signal. Today the wizard's runtime auth comes from interactive OAuth → `~/.amplitude/wizard/oauth-session.json` → `config.amplitudeBearerToken` → `ANTHROPIC_AUTH_TOKEN` at `src/lib/agent-interface.ts:1970-1971`. CI cannot run interactive OAuth, and the `--api-key` (direct Anthropic) path bypasses the gateway entirely — so it doesn't exercise the production code path that customers actually run.

**Resolution: env-var auth, plumbed from GitHub org secrets.** The org already provisions `WIZARD_OAUTH_TOKEN`, `WIZARD_EXPIRES_AT`, and `WIZARD_ZONE` as secrets; today they are unused in this repo (`grep` returns zero hits in `src/` and `.github/`). Wire them in.

**Wizard-side work (one PR, modest):**

1. In the credential resolver (`src/lib/credential-resolution.ts` or the equivalent code path that produces `config.amplitudeBearerToken`), accept `WIZARD_OAUTH_TOKEN` from env as a *higher-priority* source than the OAuth file. If `WIZARD_EXPIRES_AT` is past, fail loudly with a remediation pointer rather than silently refreshing (CI should never refresh a long-lived org secret).
2. Plumb `WIZARD_ZONE` into the gateway URL resolver in `src/utils/urls.ts:79` next to the existing `WIZARD_LLM_PROXY_URL` override. Zone selection is currently driven by the user's stored config; CI needs an explicit override.
3. PR #549's `resolveWizardAnthropicAuthFromEnv` (the AI-SDK Anthropic factory) needs to read the same vars — verify the priority order matches the legacy path so D-5 cutover doesn't change auth behavior.

**Eval-runner-side work (follow-up PR on top of #560):**

PR #560's `runLive` (`evals/runner/invoke-wizard.ts:75-82`) currently passes `--api-key`, which routes the wizard to direct-Anthropic and **bypasses the gateway**. That defeats the parity check the cutover gate depends on (gateway-specific 400s, schema-noise issues, beta-header rejections — exactly the bug class Phase A fixes). Update `runLive` to:
1. Default to env-var auth via the three secrets above, talking to the gateway.
2. Allow `--direct-api-key` only as an explicit opt-out for offline development.
3. Add an L0 scorer asserting the captured stderr never contains the literal token value (covers PR #560 review issue 2).

**CI-side work (per-workflow, small):**

Each workflow that runs the wizard's `--agent` against the live gateway declares `env:` pulling the three secrets:

```yaml
env:
  WIZARD_OAUTH_TOKEN: ${{ secrets.WIZARD_OAUTH_TOKEN }}
  WIZARD_EXPIRES_AT:  ${{ secrets.WIZARD_EXPIRES_AT }}
  WIZARD_ZONE:        ${{ secrets.WIZARD_ZONE }}
```

This applies to: `evals-pr.yml` (the §7.3 PR-gate), `evals-nightly.yml`, `evals-pre-release.yml`, and `bench.yml` (the §6.1 bench harness once the bench port lands).

**Fork-PR policy.** GitHub does not surface org secrets to PRs from forks. The decision is binding: **evals and benches do not run on fork PRs.** They run on push-to-internal-branch and on schedule. Internal contributors are not affected; external contributors get build + lint + unit tests only, with a comment from the bot pointing at the policy.

**Token rotation.** When `WIZARD_OAUTH_TOKEN` is rotated, CI breaks until the secret is updated. The plan accepts this; the alternative (silent refresh in CI) means CI holds long-lived OAuth state, which is worse. Document the rotation runbook alongside the secret. Consider expiring tokens to a *generous* validity window (e.g. quarterly) to balance churn vs. security.

**Optional: bypass-token PR to `thunder/wizard-proxy`.** A long-lived service token that CI uses without OAuth — server-side change in `amplitude/javascript`'s `thunder/src/wizard-proxy/`. Adds a header (e.g. `X-Wizard-CI-Token: <hash>`) checked against a stored allowlist; bypasses Hydra introspection. **Non-blocking** for this plan: the env-var path above unblocks evals and benches today. The bypass token is hardening for the case where OAuth-token rotation churn becomes operationally painful, and pairs naturally with the broader proxy hardening in §3 #7. Schedule when the platform team picks up that work, not before.

**What this unblocks:**

- §6.1 bench harness can run `cache-hits.bench.ts` and `first-token-latency.bench.ts` against the real gateway — fake numbers from mocked transports would defeat the point.
- §7.2 cutover gate is *meaningful*: AI-SDK parity is measured against the same gateway that customers hit, with the same auth shape.
- §7.4 per-call-site fixtures replay against the real gateway for streaming sites; structured-output sites can run mock-only since `generateObject` is deterministic enough.

**Risk: token gets logged.** The wizard already redacts `ANTHROPIC_AUTH_TOKEN` from its observability surfaces (`src/lib/observability/logger.ts` + `src/ui/agent-ui.ts`'s NDJSON redactor — PR #518 hardens this). Verify `WIZARD_OAUTH_TOKEN` is on the same redaction list. Add a unit test that asserts the literal token never appears in any log path.

---

## 8. Skills & context architecture

The wizard's biggest controllable cost is what lands in the inner agent's prompt every turn. This section defines the binding contract for how commandments, skills, and references are delivered. Token estimates use `words × 1.33 ≈ tokens`.

### 8.1 Today's baseline (measured 2026-05-06)

What lands in a worst-case Next.js Pages Router turn:

| Block | Tokens | Source |
|---|---|---|
| Claude Code preset (system) | ~2,000 | SDK preset (`agent-interface.ts:3050-3083`) |
| Wizard universal commandments | ~2,880 | `src/lib/commandments.ts:25-106` |
| Browser-only commandments | ~540 | `commandments.ts:120-150` |
| Wizard-tools MCP schemas (9 tools) | ~800 | `wizard-tools.ts:1923-1937` |
| Tool catalog (~50 tools) | ~6,500 | Amplitude MCP catalog (mitigated by `ENABLE_TOOL_SEARCH=auto:0`) |
| Integration skill body | ~560 | `skills/integration/integration-nextjs-pages-router/SKILL.md` |
| Integration references on read | up to ~22,950 | `references/*.md` (`browser-sdk-2.md` alone is ~13,100 tokens) |
| Pre-staged constants menu | ~4,260 | `wizard-tools.ts:402-439` (`preStageSkills`) |
| Per-turn dynamic context | ~530 | `agent-runner.ts:1666-1689` |

**Cold start (turn 1) typical: ~13,500 tokens. Mid-run with full reference fan-out: 35,000-45,000 tokens.** Compaction kicks in around 80-120K (model-dependent), and we routinely see it on long Next.js / Vue runs.

**The biggest single waste:** `references/browser-sdk-2.md` is ~13,100 tokens and is duplicated verbatim across 10+ browser integration skills (Vue 3, TanStack Start, SvelteKit, React Vite, both TanStack Router variants, all React Router 7 variants, React Router 6, …). The same content also overlaps with `references/browser-unified-sdk.md` and `wizard-prompt-supplement/references/browser-sdk-init-defaults.md`. Single highest-value byte cut in the system.

**Commandments triage** (22 rules, ~5,000 tokens total in `commandments.ts:25-106`):
- **Always-on (safety / output contracts):** 9 of 22, ~1,300 tokens.
- **Phase-specific:** 7 of 22, ~1,200 tokens (taxonomy quickstart load, `confirm_event_plan` contract, events.json + dashboard, setup report, etc.).
- **Framework-specific:** 3 of 22, ~880 tokens.
- **Always-on but bloated:** 3 of 22, ~720 tokens (Bash policy, parallel discovery, TodoWrite checklist).

Roughly half the commandment tokens are phase- or framework-conditional and could be deferred. Today they all ship every turn.

### 8.2 Three-tier delivery contract

#### Tier 1 — Always-loaded skill menu (cache-stable)

A single JSON-shaped block injected into the system prefix. Each entry: `id`, `name`, `description (≤25 words)`, `tier-2-tokens (rough)`, `triggers (when to load)`. **Total budget: ≤3,500 tokens for ~44 skills.**

Already exists at `context-hub/dist/skills/skill-menu.json` (categories: `feature-flags`, `integration`, `instrumentation`, `taxonomy`, `wizard`, `omnibus`). Ship verbatim into the system prefix.

The wizard's framework-detection step **already** narrows the integration set to one — so the integration menu shows **only the resolved integration skill plus a fallback note**, not all 32. Saves ~1,800 tokens vs exposing every integration.

#### Tier 2 — Load-on-activation skill body

Triggered by a wizard-side `load_skill` tool returned to the agent:

```ts
load_skill({
  skillId: 'integration-nextjs-pages-router' | 'amplitude-quickstart-taxonomy-agent' | ...,
  reason: string,    // ≤25 words, captured to Agent Analytics
})
→ { content: SKILL.md body }
```

Implementation: re-enable the `install_skill` block in `src/lib/wizard-tools.ts:1480-1542` but rename to `load_skill` and **return the body inline** rather than copying to disk. The disable rationale ("agent loops calling load_skill_menu → install_skill → load_skill_menu") is fixed by collapsing the two-step menu+install to a single call (the menu is already in Tier 1) and by hard-capping a single skill load per phase via the agent's hook layer (`createPreToolUseHook` in `agent-interface.ts`).

**Do not reintroduce the staging-on-disk path** the original disable rationale identified. The cleaner v2 path is: **stop pre-staging, return bodies inline through `load_skill`**, and drop the staging/cleanup machinery (`preStageSkills` + `cleanupIntegrationSkills`) entirely.

#### Tier 3 — On-demand references

`load_skill_reference({ skillId, refPath })` wizard tool that returns the file body inline. Composes with `load_skill` and gives per-reference cache control if references move behind a CDN later. No disk staging.

#### System prompt assembly sketch

```ts
// src/lib/wizard-tools.ts (re-enabled, simplified)
const loadSkill = tool(
  'load_skill',
  'Load the body of an Amplitude skill by id. The skill menu lives in your system prompt.',
  { skillId: z.enum(KNOWN_SKILL_IDS), reason: reasonField },
  ({ skillId }) => {
    const body = readBundledSkillBody(skillId);
    return { content: [{ type: 'text', text: body }] };
  },
);

const loadSkillReference = tool(
  'load_skill_reference',
  'Load a reference file for an already-loaded skill. Path is relative to the skill directory.',
  { skillId: z.enum(KNOWN_SKILL_IDS), refPath: z.string().regex(/^references\/[\w.-]+\.md$/), reason: reasonField },
  ({ skillId, refPath }) => ({ content: [{ type: 'text', text: readBundledSkillReference(skillId, refPath) }] }),
);

// src/lib/agent-interface.ts (system prompt assembly)
systemPrompt: {
  type: 'preset', preset: 'claude_code',
  append: buildSystemPrefix({
    commandments: getAlwaysOnCommandments(),                 // ~1,300 tokens
    phaseCommandments: getPhaseCommandments(currentPhase),   // ~200-400 tokens
    frameworkCommandments: targetsBrowser ? getBrowser() : '',
    skillMenu: getSkillMenu({ resolvedIntegrationId }),      // ~1,800 tokens (narrowed)
  }),
}
```

### 8.3 Commandments split

Move `src/lib/commandments.ts` to a directory:

```
src/lib/commandments/
  always-on.ts       # 9 rules: safety, no-secrets, no-shell-eval, retry budget, Read-before-Write, parallelism, package policy, MCP reason, sleep ban
  phase/
    discover.ts      # discovery parallelism, package-manager probe
    plan.ts          # taxonomy load + confirm_event_plan contract pointer
    instrument.ts    # events.json + record_dashboard pointer
    finalize.ts      # setup report + lint scoping + no cleanup of wizard paths
  framework/
    browser.ts       # current BROWSER_ONLY block
    mobile.ts        # (future: when we add iOS/Android-specific guidance)
    server.ts
  index.ts           # composes all of the above based on phase + framework
```

Phase is already tracked in `WizardSession` (RunPhase) and exposed via `agent-state.ts`. The composition function reads the current phase and only includes the matching block.

**Token impact at the cache-stable boundary:** always-on stays ~1,300 tokens; phase + framework blocks (≤500 tokens combined) live AFTER the cache breakpoint, so they invalidate cleanly between phase transitions but don't hurt cache reads within a phase.

### 8.4 Prompt cache layout (4 breakpoints)

Vercel AI SDK 6 + `@ai-sdk/anthropic` supports `providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }` on system / message blocks (verified in `wizard-rewrite/src/agents/wizard-agent-loop.ts:378-389`). Anthropic permits **up to 4 cache breakpoints**. Proposed placement:

| # | Position | Contents | Stability |
|---|---|---|---|
| 1 | After always-on commandments | Claude Code preset + always-on commandments + wizard-tools MCP schemas + Tier 1 skill menu | Stable across **all** wizard runs (independent of project, framework, phase). Hits across machines/runs after first warmup. **~5,500 tokens stable prefix.** |
| 2 | After framework commandments | + browser-only block (or empty) | Stable across all runs that share the same `targetsBrowser` flag. |
| 3 | After phase commandments | + current phase block | Stable within a phase; invalidates on phase transition (~5 transitions per run). |
| 4 | After Tier-2 active skill body (when one is loaded) | + integration skill body OR taxonomy skill body | Stable within a phase that uses the same skill. |

After breakpoint 4, the dynamic suffix is: orchestrator context (when injected via `--context-file`) + per-turn user message (cwd, framework metadata, current step) + assistant/tool history. Cache writes happen automatically at each breakpoint; cache reads charge ~10% of normal input cost.

**Risk: orchestrator-injected context placement.** If breakpoint 1 cached between always-on and `--context-file` content, every distinct orchestrator context becomes a cache miss. Mitigation: place orchestrator content AFTER breakpoint 4 in the dynamic suffix.

**Goal:** ≥80% cache-read rate by turn 3 of any run, measured via `cacheReadTokens / inputTokens`.

### 8.5 Expected wins

Using Anthropic's documented Sonnet input throughput (5,000-10,000 TPS on cached input, ~1,500-3,000 TPS on uncached input):

- **Today, cold turn 1:** ~13,500 input tokens, ~80% uncached on first run, ~5-9s of pure input-processing latency.
- **v2, cold turn 1:** ~7,500 input tokens, of which ~5,500 stays in the global cache after first warmup. Net first-token latency: **~2-4s, saving 3-5s.**
- **Today, mid-run worst case:** 35-45K input tokens, much of it uncached because per-turn dynamic context invalidates everything below it. ~10-15s pure input latency.
- **v2, mid-run worst case:** 15-22K input tokens, ~75% cached (everything up to breakpoint 4). ~3-5s pure input latency. **Saves ~7-10s per turn.**

Across a typical 25-30 turn wizard run, that's **2-4 minutes of wall-clock latency removed**. Per-turn input cost drops by ~60-70% (cache-read pricing).

Compaction-induced regressions: the compaction event triggered today by accumulated reference loads + tool results moves out beyond 80K, so the v2 envelope (15-22K mid-run) effectively eliminates compaction for the median run.

### 8.6 Comprehensiveness guarantees

The correctness fear is "comprehensive enough." This contract must not regress coverage.

**Activation paths covered explicitly in the Tier-1 menu:**

| Scenario | How the menu finds the right skill |
|---|---|
| Framework-specific install (Next.js / Vue / React Router / 28 others) | `resolveIntegrationSkillId` already narrows to one before agent starts; menu shows the resolved id |
| Mixed monorepo (frontend + backend) | Menu shows both detected integration skills; agent picks per file/directory |
| Server-side instrumentation only (Django, Flask, Express, Node, Rails) | Server-targeting integration skill present; browser commandments not loaded |
| Adding analytics to a partially-instrumented project | `add-analytics-instrumentation` skill listed; `discover-analytics-patterns` available as Tier 2 |
| Full-repo instrumentation (existing app, no analytics) | `full-repo-instrumentation` skill — currently 5K tokens, can stay Tier 2 |
| Taxonomy/event planning | `amplitude-quickstart-taxonomy-agent` (Tier 2) |
| Dashboard creation | `amplitude-chart-dashboard-plan` (Tier 2) |
| Feature flags | `feature-flags-<lang>` (skill menu lists 14 variants — only the matching one for detected language exposed) |

**Cross-skill dependencies:**

- `instrument-events` references `discover-event-surfaces` output. List both as a "phase 2 instrumentation pair" in the menu; the agent loads `discover-event-surfaces` first, then `instrument-events`. SKILL.md bodies are independent — only the *output* of the first is needed by the second, and that's a JSON file the agent writes to disk regardless.
- `amplitude-chart-dashboard-plan` runs after instrumentation; reads `.amplitude/events.json`. No cross-skill body dependency.
- `wizard-prompt-supplement` is referenced by **commandments**, not other skills. Collapse `wizard-prompt-supplement/SKILL.md` (187 words) into the always-on commandments and inline its 6 reference files as phase-specific commandments (api-keys-and-env in always-on, confirm-event-plan-contract in plan phase, post-instrumentation in instrument phase, setup-report in finalize, browser-sdk-init in framework/browser, lint-scoping in finalize). **This eliminates the prompt-supplement skill entirely.**

**The browser-sdk-2.md duplication problem.** Move it from `skills/integration/integration-*/references/browser-sdk-2.md` (10+ copies) to a single shared `skills/_shared/browser-sdk-reference/browser-sdk-2.md`. Each browser integration's SKILL.md links to the shared path. context-hub already has the deduplication primitive (the build pipeline in `transformation-config/`). Saves ~131,000 tokens of duplicated bytes shipped in `skills/`.

### 8.7 Execution mapping

The contract above lands as three independently shippable PRs, sequenced inside Phase C:

1. **`load_skill` re-enable + drop pre-staging** (#544 / #545 / #546). Adds `AMPLITUDE_WIZARD_SKILL_TIERS=1`, `load_skill`, `load_skill_reference`, and `load_skill_menu`. Returns bodies inline — no disk staging. Test: round-trip a Next.js Pages Router run; confirm cache-read tokens > 50% by turn 3. Drop `preStageSkills` and `cleanupIntegrationSkills` once the flag defaults on.
2. **Commandments split** per §8.3. Migrate `commandments.ts` → `commandments/{always-on, phase, framework}/*.ts`. Place cache breakpoints 1-4 per §8.4. Test: snapshot test that the always-on portion is byte-identical across two consecutive runs of different frameworks; assert `cache_read_input_tokens > 0.7 × input_tokens` by turn 5.
3. **Cross-repo dedup of `browser-sdk-2.md` + collapse `wizard-prompt-supplement`** per §10 decision 1. Paired wizard + context-hub PR. Test: byte-budget assertion (CI fails if any single skill body > 5K tokens).

Each PR is self-contained, small (<400 LOC each), independently revertable, and ships a measurable cache-rate improvement.

### 8.8 Open questions

- **`Skill` (Claude Code's built-in) vs. our `load_skill`.** The Claude Code preset already provides `Skill`; if `load_skill` registers, the agent has two ways to load. Mitigation: drop `Skill` from `allowedTools` in `agent-interface.ts:2544` once `load_skill` is live.
- **Vercel AI SDK 6 `prepareStep` interaction with `cacheControl`.** Verify it preserves `providerOptions.anthropic.cacheControl` on the system block. Verified shape works on the system block in `wizard-rewrite-slice3/src/agents/wizard-agent-loop.ts:378-389`; need to confirm message-level breakpoints survive the AI SDK's serialization. If not, fall back to a single system block with no per-step mutation.
- **`full-repo-instrumentation` (5K tokens, the heaviest skill) menu visibility.** Today always available; in practice loaded only when the wizard runs in PR-review mode. Pulling it out of the default menu saves ~600 menu tokens. Decision deferred until §7.2 eval gate exposes the cost.

---

## 9. Client vs `thunder/wizard-proxy` responsibilities

The wizard client is responsible for:

- Outbound request shape: stripping `anthropic-beta` headers and forbidden JSON-schema keys from `tools[].input_schema` (PR #542/#550 lock this in).
- Auth: `authToken` via `@ai-sdk/anthropic` 3.x.
- Model pinning: `claude-sonnet-4-6` via `WIZARD_CLAUDE_MODEL`.
- Defense-in-depth: client sanitization runs even after server hardens, because old npx-pinned wizard versions stay in the wild for months.

`thunder/wizard-proxy` is responsible for (post-cutover, non-blocking work owned by platform):

- Beta-header allowlist (replace the regex pass-through at `router.ts:443-451`).
- Tool-schema sanitization in `buildVertexBody`.
- Real Vertex 4xx error passthrough on 400/404/422 (so we lose less debuggability).
- Multi-provider failover (Anthropic direct → AWS Bedrock → GCP Vertex).

This split stays even when both sides are green: defense in depth.

---

## 10. Resolved decisions

The six questions previously open in earlier drafts of this plan are decided. Each is binding for the phase it touches.

1. **`browser-sdk-2.md` dedup: full cross-repo.** Move to `context-hub/skills/_shared/browser-sdk-reference/`; have each browser integration link rather than embed. Saves ~131k duplicated bytes and keeps Tier-3 lazy-load honest. Coordination with context-hub team is required; scope this as a paired PR (wizard side + context-hub side). Lands in Phase C, before Phase F's packaging cut.
2. **Native framework matrix: keep all through 2.0.** No telemetry-driven cut on `unreal`/`unity`/`flutter`/`java`/`go` for the 2.0 cycle. Trade-off accepted: more test surface and slower D-5 stabilization in exchange for zero migration risk for existing users. Revisit in a 2.x minor if telemetry shows sustained <0.1% usage on any framework.
3. **`marketplace-internal` / `mcp-marketplace`: remote-only artifacts.** The plan depends only on the published GitHub-release artifacts that `scripts/refresh-instrumentation-skills.sh` and `scripts/refresh-skills.sh` pull. No assumption that either repo is locally cloneable. Pinning is via `CONTEXT_HUB_TAG` + the equivalent ref pin (#547/#554/#555).
4. **AI-SDK default-on: hard cutover after the eval gate passes.** No staged % rollout. Once §7.2's eval gate holds for 14 days at opt-in default-on, flip to 100% in one release. Revert path is a release-bump, not a flag flip — so the eval gate cannot be soft. This raises the bar for D-5; the plan accepts that.
5. **`1.x` life-support owner: wizard team rotation.** Engineers on the wizard team take turns triaging 1.x security/CVE issues during the ~6-month life-support window after 2.0 cuts over. Documented in the team handbook as a rotation, not a dedicated headcount. Details (length of rotation, escalation path) are an internal team-process decision, not a plan blocker.
6. **OTel GenAI telemetry: deferred out of 2.0.** Phase F ships ESM packaging + dead-dep cleanup only. OpenTelemetry GenAI semantic conventions are revisited in a 2.x minor when there is bandwidth to do them properly. Reduces 2.0 scope; losses are limited to delaying parity with an industry convention that is still hardening anyway. Existing structured logger + Sentry + per-turn middleware benchmarks remain the wizard's observability surface for 2.0.

7. **Storage migration: stop writing `ampli.json`; adopt the modern paths exclusively.** New writes target `~/.amplitude/wizard/` (user state) and `<installDir>/.amplitude/` (project metadata) — the same model `wizard-rewrite` and `wizard-v2` use. Read-side compat for `~/.ampli.json` and per-project `ampli.json` stays for one minor cycle (one-shot copy-forward on first read), then dropped. The wizard already uses the modern paths for new state; this decision retires the dual-write mirror and the 845 LOC of legacy `ampli-config.ts` + `ampli-settings.ts` that maintain it. Active migration tracked in Phase G.

---

## 11. Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| AI SDK retries internally with `maxRetries: 2` and `wizard` already retries — double-retry blowup | D | One retry layer only; `agent/run-agent.ts` opts AI SDK retries to 0, owns its own classifier (port `wizard-rewrite/src/llm/wizard-anthropic-provider.ts` shape). |
| `cache_control` placement breaks if `prepareStep` mutates the system block | D | Reproduce `wizard-rewrite/src/agents/wizard-agent-loop.ts:378-389` shape exactly; the SDK has been verified to preserve `providerOptions.anthropic.cacheControl` on the system block. |
| `experimental_createMCPClient` rename in AI SDK v7 | D-4 | Internal interface wraps the experimental import in one file; v7 rename is a one-file diff. |
| Cache miss on every distinct orchestrator-injected `--context-file` | C/D | Place orchestrator content **after** breakpoint 4 in the dynamic suffix per §8.4. |
| Stack rebase pain as #541 lands | now | Each stack PR's body lists the merge order. After #541 lands on `main`, retarget #542 to `main`; rebase the rest in chain order. Standard stacked-PR workflow. |
| Eval coverage drifts from AI-SDK migration speed | D-5 | The cutover gate in §7.2 is binding; D-5 cannot default-on without it. Ratchet ring-1 scenarios + Layer-2/3 scorers ahead of D-5. |
| `browser-sdk-2.md` duplication breaks Tier-3 lazy-load contract | C | Token-budget linter in context-hub CI fails on >2k-token bodies before this can regress further. |
| `WizardSession` shape ossifies and the install-pipeline decomposition can't decouple cleanly | B | Property-based test covers the install graph the same way `flow-invariants.test.ts` covers screen flows; failures surface coupling. |
| Agent SDK delete (D-6) loses bash sandboxing semantics | D-6 | Plan honestly: tool-policy middleware is 150-200 LOC under `src/lib/agent/tool-policy.ts`. Don't promise 50. |
| `WIZARD_OAUTH_TOKEN` rotation breaks CI | §7.5 | Document rotation runbook; provision quarterly-validity tokens; fail loudly on expiry rather than silent-refresh. Bypass-token thunder PR available if rotation pain becomes operational. |
| Org secret leaks via redaction gap | §7.5 | Token added to `src/lib/observability/logger.ts` + NDJSON redactor allowlist with a unit-test assertion that the literal value never appears in any log path. |
| Fork-PR contributors lose eval signal | §7.5 | Binding policy: evals + benches don't run on fork PRs. Build + lint + unit tests still run. Bot comment explains the policy. |

---

## 12. Immediate next commits (execution backlog)

1. **Land the existing stack in declared order.** #541 → #542 → #550 (Phase A close). #543 (Phase B seam). #544 → #545 → #546 (Phase C tier tools). #548 → #549 (Phase D probe + factory). #551 → #553 (Phase E start). #547/#554/#555 land independently.
2. **Open a tracking issue per phase** mirroring the slice list in §5. PRs reference the phase issue, not this doc, so the doc stays evergreen.
3. **Wire benchmark assertions** in CI per §6.2. Start with the cache-read warning, the bundle-size block, and the first-token-latency block. Add others as their measurements stabilize.
4. **Land the per-call-site extension** to PR #560 once it merges: `runner/invoke-wizard.ts:runCallSite`, `evals/call-sites/registry.ts`, and the first three call-site fixtures (`propose_event_plan`, `select_skill`, inner-loop `streamText`). Resolve the four high-impact PR #560 review issues in the same window. This is the gate-gate: D-5 requires the eval surface to be real.
5. **Wire `WIZARD_OAUTH_TOKEN` / `WIZARD_EXPIRES_AT` / `WIZARD_ZONE` env-var auth** per §7.5. Single PR: extend `src/lib/credential-resolution.ts` and `src/utils/urls.ts` to read the env vars; verify PR #549's `resolveWizardAnthropicAuthFromEnv` matches the priority order; add the redaction-allowlist test. Unblocks evals and benches against the live gateway.
6. **Open the paired `browser-sdk-2.md` dedup PR** (wizard + context-hub) once #544-#546 land. Per §10 decision 1, lands in Phase C.
7. **Open a Phase G-1 PR** to stop the `ampli.json` dual-write. Smallest, safest start: makes new writes go to modern paths only; leaves all read paths intact. Per §10 decision 7.
8. **Archive `wizard-rewrite` and `wizard-v2`** once D-6 ships (Agent SDK deletion). Until then, keep them as reference implementations cited from the in-tree code.

---

## 13. References

- `docs/flows.md` — UX source of truth.
- `docs/architecture.md`, `docs/dual-mode-architecture.md`, `docs/critical-files.md`, `docs/engineering-patterns.md`, `docs/external-services.md`.
- `wizard-rewrite/src/agents/wizard-agent-loop.ts` — `streamText` + cache-control reference.
- `wizard-rewrite/src/cli/wizard-ui/types.ts` — `WizardInstallPresentation` interface (~17 methods).
- `wizard-rewrite/benchmarks/` — perf-bench harness reference.
- `wizard-rewrite/docs/drop-langgraph-plan.md` — already executed.
- `wizard-v2/evals/` — eval harness reference (baseline + scoring + fixtures).
- `wizard-v2/src/llm/client.ts` — schema/header sanitizer reference.
- `context-hub/scripts/build.js`, `dist/skills/skill-menu.json` — Tier-1 menu source.
- `thunder/src/wizard-proxy/router.ts`, `thunder/src/wizard-proxy/vertex.ts` — proxy hardening targets (post-cutover).
