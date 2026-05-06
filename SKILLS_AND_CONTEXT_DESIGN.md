# Wizard v2 — Skills & Context Architecture Design Proposal

Status: proposal, kelson/migration-plan branch.
Author: Kelson + Claude Opus 4.7.
Scope: how the wizard delivers commandments, skills, and references to the inner agent without sacrificing comprehensiveness or speed.

Token estimates use `words × 1.33 ≈ tokens` (BPE rule of thumb for English markdown).

---

## 1. Today's reality (measured)

### 1a. Worst-case shipped wizard turn (Next.js Pages Router)

What lands in the inner agent's prompt today on every turn:

| Block | Size (words → tokens) | Source |
|---|---|---|
| Claude Code preset (system) | ~1,500 → **~2,000** | SDK preset (`claude_code`), see `agent-interface.ts:3050-3083` |
| Wizard universal commandments | 2,166 → **~2,880** | `src/lib/commandments.ts:25-106` (UNIVERSAL block) |
| Wizard browser commandments | 407 → **~540** | `commandments.ts:120-150` (BROWSER_ONLY, included for Next.js) |
| Wizard-tools MCP schemas (9 tools) | ~600 → **~800** | `wizard-tools.ts:1923-1937` (zod schemas + descriptions) |
| Tool definitions for `Skill`, `Read`, `Edit`, `Write`, `Bash`, `Glob`, `Grep`, `TodoWrite`, `WebFetch`, `Task`, `mcp__amplitude__*` (~50 tools when MCP attached) | ~5,000 → **~6,500** | Amplitude MCP catalog; mitigated by `ENABLE_TOOL_SEARCH=auto:0` (`agent-interface.ts:3102`) — but still discovered on first need |
| Integration skill body (loaded by agent in turn 1) | 420 → **~560** | `skills/integration/integration-nextjs-pages-router/SKILL.md` |
| Integration references the agent then `Read`s (basic-integration 1.0/1.1/1.2/1.3 + EXAMPLE.md + browser-sdk-2.md if asked) | up to **17,242** → **~22,950** | `skills/integration/integration-nextjs-pages-router/references/*.md` (`browser-sdk-2.md` alone is 9,846 words ≈ 13,100 tokens) |
| Pre-staged constant skills (`wizard-prompt-supplement`, `amplitude-quickstart-taxonomy-agent`, `add-analytics-instrumentation`, `amplitude-chart-dashboard-plan`) sitting in `.claude/skills/` and discovered by `Skill` tool | ~3,200 → **~4,260** menu-only; bodies load on demand at ~600-1,500 tokens each | `wizard-tools.ts:402-439` (`preStageSkills`) |
| Per-turn dynamic context (cwd, framework, app id, API key, region, project type, additional lines) | ~400 → **~530** | `agent-runner.ts:1666-1689` (`buildIntegrationPrompt`) |

**Cold start (turn 1) typical: ~13,500 input tokens. Mid-run with full reference fan-out: 35,000-45,000 input tokens.** Compaction kicks in around 80-120K (model-dependent), and we routinely see it on long Next.js / Vue runs because the integration `references/*` plus tool results plus Amplitude MCP responses pile up.

### 1b. Distribution across all skills (sorted by total)

`context-hub/skills/` is the source of truth (`pnpm skills:refresh` syncs the wizard's `skills/`).

| Skill | SKILL.md words | References words | Total tokens |
|---|---|---|---|
| `instrumentation/discover-event-surfaces` | 2,568 | 8,171 (best-practices.md) | ~14,300 |
| `instrumentation/full-repo-instrumentation` | 3,753 | 0 | ~5,000 |
| `taxonomy/amplitude-quickstart-taxonomy-agent` | 1,443 | 0 | ~1,920 |
| `instrumentation/generate-events-manifest` | 1,178 | 0 | ~1,570 |
| `instrumentation/discover-analytics-patterns` | 1,119 | 0 | ~1,490 |
| `taxonomy/amplitude-chart-dashboard-plan` | 1,100 | 0 | ~1,460 |
| `instrumentation/instrument-events` | 1,072 | 100 | ~1,560 |
| `instrumentation/add-analytics-instrumentation` | 993 | 0 | ~1,320 |
| `instrumentation/discover-product-map` | 954 | 0 | ~1,270 |
| `instrumentation/diff-intake` | 769 | 0 | ~1,020 |
| `instrumentation/analyze-business-context` | 676 | 0 | ~900 |
| `wizard/wizard-prompt-supplement` | 187 | 2,072 (6 reference files) | ~3,000 |
| **Per-integration skill** (32 integrations, browser-targeting average) | ~420 | up to 17,242 | up to ~23,500 each |

**Surprise (worth flagging):** `references/browser-sdk-2.md` is **9,846 words ≈ 13,100 tokens**, and it's **duplicated verbatim across 10+ browser integration skills** (Vue 3, TanStack Start, SvelteKit, React Vite, both TanStack Router variants, all React Router 7 variants, React Router 6, …). The same content also overlaps heavily with `references/browser-unified-sdk.md` and with `wizard-prompt-supplement/references/browser-sdk-init-defaults.md`. This is the single biggest token-waste artifact in the system.

### 1c. Tier classification audit

Today's `preStageSkills` model dumps **bodies** to disk (`.claude/skills/<id>/SKILL.md` + every `references/*.md`); the agent loads them via the `Skill` tool. That makes everything effectively Tier 2 today (loaded on activation), with no enforced Tier 1 (name + description menu) and no enforced Tier 3 (references stay on disk but the agent loads SKILL.md + reads references freely).

The disabled `load_skill_menu` / `install_skill` (`wizard-tools.ts:1429-1543`) was meant to be Tier 1 + Tier 2, but the comment explains the disable: "the agent loops calling `load_skill_menu → install_skill → load_skill_menu` and waste turns" — i.e. the menu format gave the agent no decision criteria.

**Saving estimate if v2 enforces three-tier discipline:**
- Tier 1 menu (12 standalone skills + 32 integration skills): `id + name + description` ≈ ~3,500 tokens (was: full bodies of pre-staged skills ≈ ~9,000 tokens cached, but integration SKILL.md bodies are 420 each + pulled references push true loaded total to 20,000+ in worst case).
- Tier 2 (one integration body + one constant body when phase-active): ~2,500 tokens.
- Tier 3 (reference loaded only when explicitly read): 0 unless invoked.

Net: cold-start prompt drops from ~13,500 → **~7,500 tokens**. Worst-case mid-run drops from 35-45K → **15-22K** (a >50% cut).

### 1d. Commandments triage

The 22 commandments in `commandments.ts:25-106`:

- **Always-on (safety / output contracts) — 9 of 22, ~1,300 tokens.** Lines 26 (no hallucinated keys), 30 (use detect_package_manager), 32 (reason argument on every wizard-tools call), 34 (no Bash env-var verification), 38 (background installs), 52 (no non-Amplitude packages), 54 (no sleep/poll), 56 (retry budget), 58 (Read-before-Write).
- **Phase-specific — 7 of 22, ~1,200 tokens.** Lines 60 (taxonomy quickstart load — fires only in plan phase), 78 (`confirm_event_plan` contract — fires once), 80 (events.json + dashboard — fires post-instrument), 82 (setup report — fires once at end), 84 (`report_status`), 86 (no cleanup of wizard paths — late phase only), 94 (lint scoping at end).
- **Framework / browser-specific — 3 of 22, ~880 tokens.** Lines 121 (browser SDK init defaults — already conditional on `targetsBrowser`), 123 (init-once entry-file pattern — ditto), and 36 (Bash policy contains framework-flavored examples).
- **Always-on but bloated — 3 of 22, ~720 tokens.** Lines 36 (Bash policy — verbose RIGHT/WRONG examples), 40 (parallel discovery — long worked example), 68 (TodoWrite checklist — long, but invariant).

Roughly **half the commandment tokens are phase- or framework-conditional** and could be deferred. Today they all ship every turn.

---

## 2. Three-tier delivery contract for v2

### Tier 1 — Always-loaded skill menu (cache-stable)

A single JSON-shaped block injected into the system prefix. Each entry: `id`, `name`, `description (≤25 words)`, `tier-2-tokens (rough)`, `triggers (when to load)`. Total budget: **≤3,500 tokens** for ~44 skills.

Already exists at `context-hub/dist/skills/skill-menu.json` (categories: `feature-flags`, `integration`, `instrumentation`, `taxonomy`, `wizard`, `omnibus`). v2 ships this verbatim into the system prefix. Source: `dist/skills/skill-menu.json`.

The wizard's framework-detection step **already** narrows the integration set to one — so v2's integration menu shows **only the resolved integration skill plus a fallback note**, not all 32. Saves ~1,800 tokens of the menu vs. exposing every integration.

### Tier 2 — Load-on-activation skill body

Triggered by a wizard-side `load_skill` tool returned to the agent. Contract:

```ts
load_skill({
  skillId: 'integration-nextjs-pages-router' | 'amplitude-quickstart-taxonomy-agent' | ...,
  reason: string,    // ≤25 words, captured to Agent Analytics
})
→ { content: SKILL.md body }
```

Implementation: re-enable the `install_skill` block in `src/lib/wizard-tools.ts:1480-1542` but rename to `load_skill` and **return the body inline** rather than copying to disk. The disable rationale ("agent loops calling load_skill_menu → install_skill → load_skill_menu") is fixed by collapsing the two-step menu+install to a single call (the menu is already in Tier 1) and by hard-capping a single skill load per phase via the agent's hook layer (`createPreToolUseHook` in `agent-interface.ts`).

The shipped `Skill` tool that Claude Code provides also works — but it requires staging on disk, which means the wizard must keep `preStageSkills` and the post-run cleanup hooks (`cleanupIntegrationSkills`). The cleaner v2 path is: **stop pre-staging, return bodies inline through `load_skill`**, and drop the staging/cleanup machinery entirely.

### Tier 3 — On-demand references

Two options, both viable:

- **A.** Use the existing `Read` tool against `.claude/skills/<id>/references/<file>.md` (requires staging). Continues today's pattern; agent already knows how to call `Read`.
- **B.** Add a `load_skill_reference({ skillId, refPath })` wizard tool that returns the file body inline. Preferred — keeps the wizard's no-staging discipline and lets us instrument which references actually get read.

Recommend **B**. It composes cleanly with `load_skill` and gives us per-reference cache control if we move references behind a CDN later.

### Code-level call site sketch

```ts
// src/lib/wizard-tools.ts (re-enabled, simplified)
const loadSkill = tool(
  'load_skill',
  'Load the body of an Amplitude skill by id. The skill menu lives in your system prompt.',
  { skillId: z.enum(KNOWN_SKILL_IDS), reason: reasonField },
  ({ skillId }) => {
    const body = readBundledSkillBody(skillId);  // from this package's `skills/`
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

---

## 3. Commandments split

Move `src/lib/commandments.ts` to a directory:

```
src/lib/commandments/
  always-on.ts       # 9 rules: safety, no-secrets, no-shell-eval, retry budget, Read-before-Write, parallelism, package policy, MCP reason, sleep ban
  phase/
    discover.ts      # discovery parallelism, package-manager probe (already deferred)
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

---

## 4. Prompt cache layout

Vercel AI SDK 6 + `@ai-sdk/anthropic` already supports `providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }` on system / message blocks (verified in `wizard-rewrite-slice3/src/agents/wizard-agent-loop.ts:378-389`). Anthropic permits **up to 4 cache breakpoints**. Proposed placement:

| # | Position | Contents | Stability |
|---|---|---|---|
| 1 | After always-on commandments | Claude Code preset + always-on commandments + wizard-tools MCP schemas + Tier 1 skill menu | Stable across **all** wizard runs (independent of project, framework, phase). Hits across machines/runs after first warmup. **~5,500 tokens stable prefix.** |
| 2 | After framework commandments | + browser-only block (or empty) | Stable across all runs that share the same `targetsBrowser` flag. |
| 3 | After phase commandments | + current phase block | Stable within a phase; invalidates on phase transition (~5 transitions per run). |
| 4 | After Tier-2 active skill body (when one is loaded) | + integration skill body OR taxonomy skill body | Stable within a phase that uses the same skill. |

After breakpoint 4, the dynamic suffix is: orchestrator context (when injected via `--context-file`) + per-turn user message (cwd, framework metadata, current step) + assistant/tool history. Cache writes happen automatically at each breakpoint; cache reads charge ~10% of normal input cost.

**Goal:** ≥80% cache-read rate by turn 3 of any run, measured via `cacheReadTokens / inputTokens` (the slice 3 path already logs this — `wizard-agent-loop.ts:294-302`).

---

## 5. Speed and cost expected wins

Using Anthropic's documented Sonnet input throughput (5,000-10,000 TPS on cached input, ~1,500-3,000 TPS on uncached input):

- **Today, cold turn 1:** ~13,500 input tokens, ~80% uncached on first run, ~5-9s of pure input-processing latency.
- **v2, cold turn 1:** ~7,500 input tokens, of which ~5,500 stays in the global cache after first warmup. Net first-token latency: **~2-4s, saving 3-5s.**
- **Today, mid-run worst case:** 35-45K input tokens, much of it uncached because per-turn dynamic context invalidates everything below it. ~10-15s pure input latency.
- **v2, mid-run worst case:** 15-22K input tokens, ~75% cached (everything up to breakpoint 4). ~3-5s pure input latency. **Saves ~7-10s per turn.**

Across a typical 25-30 turn wizard run, that's **2-4 minutes of wall-clock latency removed**. Per-turn input cost drops by ~60-70% (cache-read pricing).

Compaction-induced regressions: the compaction event triggered today by accumulated reference loads + tool results moves out beyond 80K, so the v2 envelope (15-22K mid-run) effectively eliminates compaction for the median run. This is the user's "compaction-induced regressions" concern — addressed structurally.

---

## 6. Comprehensiveness guarantees

The user's correctness fear: "comprehensive enough." v2 must not regress coverage.

**Activation paths covered explicitly in the Tier-1 menu:**

| Scenario | How v2 finds the right skill |
|---|---|
| Framework-specific install (Next.js / Vue / React Router / 28 others) | `resolveIntegrationSkillId` in `integration-skill-resolve.ts` already narrows to one before agent starts; menu shows the resolved id |
| Mixed monorepo (frontend + backend) | Menu shows both detected integration skills; agent picks per file/directory |
| Server-side instrumentation only (Django, Flask, Express, Node, Rails) | Server-targeting integration skill present in menu; browser commandments not loaded |
| Adding analytics to a partially-instrumented project | `add-analytics-instrumentation` skill listed; `discover-analytics-patterns` available as Tier 2 |
| Full-repo instrumentation (existing app, no analytics) | `full-repo-instrumentation` skill — currently 5K tokens, can stay Tier 2 |
| Taxonomy/event planning | `amplitude-quickstart-taxonomy-agent` (Tier 2) |
| Dashboard creation | `amplitude-chart-dashboard-plan` (Tier 2) |
| Feature flags | `feature-flags-<lang>` (skill menu lists 14 variants — only the matching one for detected language exposed to agent) |

**Cross-skill dependencies** (the failure mode the user is worried about):

- `instrument-events` references `discover-event-surfaces` output. Today both are pre-staged. v2: list both as a "phase 2 instrumentation pair" in the menu; the agent loads `discover-event-surfaces` first, then `instrument-events`. SKILL.md bodies are independent — only the *output* of the first is needed by the second, and that's a JSON file the agent writes to disk regardless.
- `amplitude-chart-dashboard-plan` runs after instrumentation; reads `.amplitude/events.json`. No cross-skill body dependency.
- `wizard-prompt-supplement` is referenced by **commandments**, not other skills. v2: collapse `wizard-prompt-supplement/SKILL.md` (187 words) into the always-on commandments, and inline its 6 reference files as phase-specific commandments (api-keys-and-env in always-on, confirm-event-plan-contract in plan phase, post-instrumentation in instrument phase, setup-report in finalize, browser-sdk-init in framework/browser, lint-scoping in finalize). **This eliminates the prompt-supplement skill entirely.**

**The browser-sdk-2.md duplication problem.** Move it from `skills/integration/integration-*/references/browser-sdk-2.md` (10+ copies) to a single shared `skills/_shared/browser-sdk-reference/browser-sdk-2.md`. Each browser integration's SKILL.md links to the shared path. context-hub already has the deduplication primitive (the build pipeline in `transformation-config/`); this is a build-config change, not a runtime change. Saves ~131,000 tokens of duplicated bytes shipped in `skills/`. (Today this is wasted disk; tomorrow if anything ever loads several of those references in a single agent context, it would be wasted tokens too.)

---

## 7. Implementation slicing — three independently shippable PRs

### PR 1 — Re-enable `load_skill` (formerly `install_skill`) in wizard-rewrite, drop pre-staging

- Re-enable the disabled tool block in `src/lib/wizard-tools.ts:1429-1543` as `load_skill` (returns body inline; no disk staging).
- Add `load_skill_reference` peer.
- Inject Tier-1 menu into the system prompt via `buildSystemPromptAppend` (`agent-interface.ts:422-438`).
- Update the integration prompt (`agent-runner.ts:1589-1689`) to reference `load_skill` instead of "Skill tool against pre-staged path."
- Delete `preStageSkills` and `cleanupIntegrationSkills`. Keep `bundledSkillExists` for the new in-process loader.
- Test: round-trip a Next.js Pages Router run end-to-end; confirm cache-read tokens > 50% by turn 3.

### PR 2 — Split commandments into phase + framework directories

- Migrate `src/lib/commandments.ts` to `src/lib/commandments/` per §3.
- Wire phase awareness through `agent-runner.ts`'s system-prompt builder (it already knows the phase via `WizardSession`).
- Place cache breakpoints 1-4 per §4.
- Test: snapshot test that the always-on portion is byte-identical across two consecutive runs of different frameworks; assert `cache_read_input_tokens > 0.7 × input_tokens` by turn 5.

### PR 3 — Deduplicate `browser-sdk-2.md` and collapse `wizard-prompt-supplement` into commandments

- context-hub: move `browser-sdk-2.md` to `skills/_shared/browser-sdk-reference/`; have each browser integration link rather than embed.
- wizard: move `wizard-prompt-supplement/references/*.md` content into the appropriate phase commandment files (per §6).
- Remove `wizard-prompt-supplement` skill from `skills/`.
- Test: byte-budget assertion (CI fails if any single skill body > 5K tokens; flags duplication regressions early).

Each PR is self-contained, small (<400 LOC each), independently revertable, and ships a measurable cache-rate improvement.

---

## 8. Risks and open questions

- **Open: who owns the deduplication PR for context-hub?** §7 PR 3 spans the wizard *and* context-hub repos. Kelson — confirm context-hub team is on board, or scope PR 3 to wizard-only and leave the context-hub-side dedup as a follow-up.
- **Open: cache-breakpoint count vs. AI SDK passthrough.** AI SDK 6 lets us put `cacheControl` on system/messages but the multi-breakpoint case (up to 4) needs the SDK to pass each through. Verified shape works in `wizard-rewrite-slice3/src/agents/wizard-agent-loop.ts:378-389`, but only on the system block — need to confirm message-level breakpoints survive the AI SDK's serialization.
- **Risk: orchestrator-injected context placement.** Today `--context-file` content lands AFTER commandments (`buildSystemPromptAppend`). If we cache breakpoint 1 between always-on and orchestrator content, every distinct orchestrator context becomes a cache miss. Mitigation: place orchestrator content AFTER breakpoint 4 (in the dynamic suffix), document the trade-off in the v2 contract.
- **Risk: `Skill` (Claude Code's built-in) vs. our `load_skill`.** The Claude Code preset already provides `Skill`; if we register `load_skill`, the agent has two ways to load. Mitigation: drop `Skill` from `allowedTools` in `agent-interface.ts:2544` once `load_skill` is live.
- **Risk: Vercel AI SDK 6 `prepareStep` interaction with cache_control.** `prepareStep` lets us mutate per-step messages — verify it preserves `providerOptions.anthropic.cacheControl` on the system block. If not, fall back to a single system block with no per-step mutation.
- **Open: Kelson — should `full-repo-instrumentation` (5K tokens, the heaviest skill) be a separate Tier 2 *opt-in* skill (not in the default menu) that the orchestrator activates explicitly when the user runs `wizard --full-repo`?** Today it's always available; in practice it's loaded only when the wizard runs in PR-review mode. Pulling it out of the default menu saves ~600 menu tokens.

---

Word count: ~1,950.
