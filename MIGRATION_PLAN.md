# Wizard Migration Plan

Author: senior engineering lead, prepared for the wizard team
Date: 2026-05-04
Source repos audited: `~/worktree-repos/{wizard, wizard-v2, wizard-rewrite, context-hub}`, `~/amplitude-repos/javascript/server/packages/app-api/src/wizard-proxy`, `~/amplitude-repos/amplitude` (main monorepo, especially `langley/amplitude_ai`, `mcp_gateway`, `houston`), `~/amplitude-repos/builder-skills`.
Repo originally referenced as unverified: `marketplace-internal` (still not local; context-hub references `mcp-marketplace`, which is also remote-only — both should be confirmed by the team).

This plan was reviewed by three independent senior reviewers (code correctness, PM/scope, architectural fit), a focused cherry-pick inventory, a proxy-strategy investigation, and a survey of the main Amplitude monorepo. Findings integrated. Notable changes from the first draft: **LangGraph is dropped**, ambient-agent support **ships before** TUI rebuild, the foundation strategy is now **"shipped wizard's TUI/CLI/safety nets + wizard-v2's harness/auth/templates/evals + wizard-rewrite's `WizardInstallPresentation` interface only"**, the wizard-proxy extraction is **deferred out of the v2 critical path** (still recommended long-term but does not block v2), and the wizard **adopts `amplitude_ai` and `mcp_gateway`** from the main Amplitude monorepo rather than rebuilding multi-provider LLM and MCP-gateway infrastructure that already exists in production.

---

## 1. Executive Summary

The shipped wizard is a forked-PostHog codebase carrying ~50,000 LOC of TypeScript, of which `src/lib/agent-interface.ts` alone is 4,112 LOC and contains a single 1,569-LOC `runAgent` function. It has hand-rolled stream-noise filtering, two MCP server stacks, three LLM client paths, dual-write Ampli compatibility shims, and ~225 LOC of can-use-tool policy mixed into the same file as the gateway client. It still works, but a critical class of users — anyone running it inside an ambient agent like Claude Code — cannot use `--agent` mode at all because `betas: ['context-1m-2025-08-07']` (`agent-interface.ts:2969`) is being rejected by Vertex AI on the proxy path.

Two clean rebuilds already exist. **wizard-v2** is operationally complete and already runs taxonomy + instrumentation agents through Vercel AI SDK v6 with a working schema-and-beta-header sanitizer for the Vertex backend, plus multi-account auth, native templates for all 11 platforms (Swift/Kotlin/Java/Go/Flutter/Unity/Unreal/Android/RN/Python/Node), a live LLM eval harness with scoring, and a setup-report writer. **wizard-rewrite** is narrower in scope but contributes one valuable artifact: the `WizardInstallPresentation` interface that lets the install pipeline render via Ink TUI, clack, or NDJSON without changing install logic.

**Verdict (one sentence):** Build a single new v2 foundation by **lifting** the shipped wizard's Ink TUI + yargs CLI surface + safety nets, **lifting** wizard-v2's Vercel AI SDK harness + multi-account auth + native templates + eval harness, **lifting** wizard-rewrite's `WizardInstallPresentation` interface and the 11-node install-pipeline decomposition (sans LangGraph), and **publishing** as `@amplitude/wizard@2.0.0` — same npm name, major version bump, **CLI flag and slash-command surface preserved verbatim** for backwards compatibility.

The destination is: a single ESM-only npm package, Vercel AI SDK v6 (`@ai-sdk/anthropic` 3.x) as the only agent runtime, prompt caching on the commandments + skills prefix, the shipped wizard's Ink TUI carried forward unchanged behind `WizardInstallPresentation`, ambient-agent mode that registers the wizard as an MCP server inside parent harnesses, MCP-native context delivery, skills pinned to a versioned `context-hub` release, multi-account auth from wizard-v2, native templates from wizard-v2 for every supported framework, a live eval harness from wizard-v2, **delegation to `amplitude_ai`'s MCP server for Python framework/provider/agent detection** rather than duplicating it in TS, and **alignment with `amplitude_ai`'s 4-phase Detect → Discover → Instrument → Verify contract**. The wizard-proxy extraction is recommended long-term (existing AWS or GCP infra, where Amplitude's other platform services run) but is explicitly **out of v2 scope**; the Phase 1 client-side fix (already shipped in PR #528) is the v2-blocking proxy answer.

---

## 2. Critical Bug Analysis — `--agent` API 400 in hosted agent environments

### Symptom
```
API Error: 400 {"type":"error","error":{"type":"api_error","message":"Invalid request sent to model provider"}}
```
Persistent and unrecoverable when `npx @amplitude/wizard --agent` runs inside Claude Code (VS Code), Cursor, or Cline.

### Hypothesis under test
The wizard's agent harness fights the host agent's auth context — two harnesses sharing an API key, env var, or request shape.

### Verdict on the hypothesis
**Mostly disproved.** The auth-conflict hypothesis is already heavily mitigated:

- `bin.ts:9-10` runs env sanitization at the **first line of execution**, stripping `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_AGENT_SDK_*`, `DEBUG_CLAUDE_AGENT_SDK` before any other import (`src/lib/sanitize-claude-env.ts:21-58`).
- `initializeAgent` re-runs sanitization (`agent-interface.ts:1902`), deletes `ANTHROPIC_AUTH_TOKEN` whenever a direct API key path is taken (line 1920) or local-claude is used (line 1925), and writes the wizard-managed env into a *local* `.claude/settings.local.json` so it beats any user-checked-in `.claude/settings.json` (`claude-settings-scope.ts:68-73`).
- Tests exist: `src/lib/__tests__/sanitize-claude-env.test.ts`, `detect-nested-agent.test.ts`.

### Where the 400 actually originates
Confirmed by reading the wizard-proxy implementation in the App API (`~/amplitude-repos/javascript/server/packages/app-api/src/wizard-proxy/`):

- **The wizard-proxy does no body validation and no schema scrubbing.** `router.ts:677-1224` resolves model against `MODEL_MAPPING`, validates `max_tokens`, runs a rough 1M-token pre-flight, then passes the body verbatim to Vertex via `buildVertexBody` (`vertex.ts:260-271`).
- **The `anthropic-beta` header is passed through verbatim** (`router.ts:443-451`) for any value matching `/^[a-zA-Z0-9\-, ]+$/` — `context-1m-2025-08-07` matches.
- **No code in `wizard-proxy/` touches `$schema`, `additionalProperties`, `exclusiveMinimum`, or any `tools[].input_schema` field.** Grep returns zero hits.
- **The literal `"Invalid request sent to model provider"` string is wrapped by the proxy** at `router.ts:917-974` as a generic "upstream returned 4xx" wrapper. The actual upstream rejection is **Vertex AI's Anthropic publisher endpoint**. The App API logs the real Vertex body server-side at `router.ts:927` via `winston.warn(LOG_PREFIX + ' Upstream error', { status, body: errText.substring(0, 500), ... })` (`LOG_PREFIX = '[WizardProxy]'`) — visible in Datadog if you have access — but the wizard never sees it.

So the 400 is: **Vertex AI rejects → the App API logs the real reason → the App API returns the generic wrapper to the wizard**.

### Actual root cause (ranked)

**1. Highest-priority: `betas: ['context-1m-2025-08-07']` is rejected by Vertex AI.**
At `agent-interface.ts:2969` the agent harness unconditionally opts into the 1M-context beta on the gateway path. The comment claims this is "safe to leave on — falls back to 200K if the backing model doesn't support it" — wrong on Vertex. Vertex AI's Anthropic publisher endpoint does not enable arbitrary `anthropic-beta` previews, returns 400 INVALID_ARGUMENT, and the App API wraps as the generic message. **Confirmation step before shipping:** check the App API's `[WizardProxy] Upstream error` logs for a recent failing request to confirm the real Vertex rejection — the cause may be the beta, the schema noise (#3), or both.

**2. Reinforces #1.** `agent-interface.ts:1950` sets `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=true` in the SDK's child env, but `agent-interface.ts:2969` then *explicitly opts back into* a beta via the SDK's `betas` option, overriding the env disable.

**3. Same class of bug — tool-input-schema noise.** Vertex AI's Anthropic-on-Vertex deployment is stricter than direct Anthropic and rejects `tools[i].input_schema` carrying `$schema`, `additionalProperties`, or `exclusiveMinimum`/`exclusiveMaximum`. zod-to-json-schema emits all of these. wizard-v2 strips `$schema` and `additionalProperties` (`wizard-v2/src/llm/client.ts:41-53, 65-76`); **the shipped wizard does not strip any of them**, and even wizard-v2 is missing `exclusiveMinimum`/`exclusiveMaximum`. The Phase 1 sanitizer must add those four keys, not just port two of them.

**4. Possibly contributing — model id.** `agent-interface.ts:2944-2948` uses `claude-sonnet-4-5-20250514` (gateway path: `'anthropic/claude-sonnet-4-5-20250514'`, direct path: `'claude-sonnet-4-5-20250514'`). Pin to `claude-sonnet-4-6` to match wizard-v2's known-working version (`wizard-v2/src/llm/client.ts:34`).

**5. Long-tail — `ANTHROPIC_CUSTOM_HEADERS` malformed.** `buildAgentEnv` (`agent-interface.ts:1313-1342`) joins headers with `\n` via `createCustomHeaders().encode()`. If session metadata contains a newline or colon, the SDK hands the gateway garbage headers. Cheap to harden.

### Auth pattern decision (must pin in Phase 1)
wizard-v2 (`client.ts:104-112`) uses `apiKey: 'unused-bearer-auth'` + manually injected `Authorization: Bearer <token>` header. wizard-rewrite (`wizard-anthropic-provider.ts:36-42`) uses `createAnthropic({ baseURL, authToken })` — `@ai-sdk/anthropic`'s built-in OAuth bearer mode. These are not drop-in compatible. **Decision: use `authToken` (wizard-rewrite's pattern)**. It's simpler, has fewer moving parts, and is what `@ai-sdk/anthropic` 3.x officially supports. Validate end-to-end against the App API's `authenticate` middleware in Phase 1.

### What needs to change to fix it (Phase 1 scope)

1. Delete or env-gate `betas: ['context-1m-2025-08-07']` at `agent-interface.ts:2969`. Default off; opt back in with `AMPLITUDE_WIZARD_GATEWAY_BETAS=1`. Drop the misleading "falls back to 200K" comment.
2. Add a sanitizing fetch wrapper that strips `anthropic-beta` headers and `$schema`/`additionalProperties`/`exclusiveMinimum`/`exclusiveMaximum` from `tools[].input_schema`. Port wizard-v2's `sanitizingFetch` and **add the two missing exclusive keys** — these are net-new code, not a port.
3. Update `fallbackModel` to `claude-sonnet-4-6`.
4. Tighten the 400 retry classifier (`agent-interface.ts:3492-3552`) to detect `"Invalid request sent to model provider"` and emit `gateway_400_invalid_request` with a clear remediation message ("your wizard build is requesting a beta or schema field the gateway rejects; please update").
5. Add a regression test that asserts the wire request body never contains `$schema`, `additionalProperties`, `exclusiveMinimum`, `exclusiveMaximum`, or `anthropic-beta` headers in a `--agent` run.
6. Workaround for users today (do not ship; communicate): `ANTHROPIC_API_KEY=sk-ant-… npx @amplitude/wizard --agent` skips the gateway entirely (`agent-interface.ts:1913-1921`).

---

## 3. Competitive & Industry Findings (May 2026)

### Vercel AI SDK is now the harness consensus

- AI SDK 6 introduced `ToolLoopAgent` — production-grade reusable agent encapsulating `instructions`, `tools`, `model`, `stopWhen`. Default `stopWhen` moved to `stepCountIs(20)`.
- `prepareStep` is the canonical seam for per-step mutation — context compression, model swapping, system-prompt edits.
- `experimental_createMCPClient` over `stdio` is stable in practice.
- Typed errors (`APICallError.isInstance(e)`, `RetryError`, `NoSuchToolError`, `InvalidToolArgumentsError`) replace hand-rolled regex retry classifiers.
- Per-tool strict mode is opt-in in v6.
- Known traps: `@ai-sdk/anthropic@2.0.45` overwrote user-supplied `anthropic-beta` headers (fixed in 2.0.49 — pin past it). `streamText` errors sometimes surface as a chunk variant rather than thrown exceptions. Zod `.min()/.max()` on numbers emits `exclusiveMinimum`/`exclusiveMaximum` which Vertex rejects (issue vercel/ai #14342).
- AI SDK retries internally with `maxRetries: 2`. Don't double-retry.

### Things wizard should adopt that the first plan draft missed

- **Vercel AI Gateway** for multi-provider failover (Anthropic direct → Bedrock on AWS → Vertex on GCP). Given that the trigger event for this whole migration is a Vertex 400, multi-provider failover is a Phase 1+ item, not a future consideration.
- **Prompt caching** via `@ai-sdk/anthropic` 3.x cache control. Wizard's commandments + active skills are 5K+ tokens of cache-stable prefix. This is free latency reduction and ~90% input-token cost reduction on the cached prefix.
- **MCP server mode for ambient agents.** When wizard detects it's running inside Claude Code, Cursor, or Cline, it should register itself as an MCP server (typed tools: `detect_framework`, `propose_event_plan`, `apply_instrumentation`, `verify_ingestion`) and let the parent agent drive. This eliminates the harness-vs-harness fight by construction. The wizard already has `wizard-mcp-server.ts` (read-only MCP) and `--plan-only` returning `proposedTrackingPlan` — both rewrites have the building blocks.

### Industry has converged on a small set of patterns

- **Skills format** (Anthropic's agentskills.io spec) was adopted by 32 tools within ~3 months. Three-tier progressive disclosure (name+description always loaded ~100 tokens/skill, body on activation <5K, references lazy).
- **MCP everywhere.** Donated to the Linux Foundation's Agentic AI Foundation in Dec 2025. Co-locating *small* low-permission MCP servers (filesystem, project search) with a CLI is now standard; auth-bearing services stay external.
- **AGENTS.md / CLAUDE.md / WIZARD.md** convention — single project-root markdown context file. Wizard does not have this yet.
- **Ambient-agent detection** is now table stakes. The `AI_AGENT` env var convention (Vercel-promoted) plus `CLAUDECODE`, `CURSOR_AGENT`/`CURSOR_CLI`, `CODEX_CI`, `COPILOT_GITHUB_TOKEN`. `@vercel/detect-agent` is a usable reference.
- **Multi-level timeouts** (per-tool / per-task / per-sandbox) are standard.
- **Structured `--json` modes** as versioned API contracts. AWS CLI v2.34+ has `--cli-error-format` for this.
- **OpenTelemetry GenAI semantic conventions** — content stored as span events (drop-able at the Collector). Default redacted, opt-in via `OTEL_LOG_USER_PROMPTS=1`.
- **MCP Apps (SEP-1865)** is becoming the standard for interactive agent responses. Worth adopting in a later phase to replace the bespoke `confirm` / `confirm_event_plan` tools.

### Where wizard is behind
- Doesn't strip `anthropic-beta`, `$schema`, `additionalProperties`, `exclusiveMinimum`/`exclusiveMaximum`. The bug.
- Three LLM client paths (Agent SDK + Agent SDK local-cli spawn + `console-query.ts`).
- 200-LOC `createPreToolUseHook` + 225-LOC `wizardCanUseTool`.
- No first-class ambient-agent detection or MCP-server-mode routing.
- No prompt caching despite stable 5K+ token system prefix.
- No multi-provider failover.
- Ships `latest` skills tag from context-hub instead of pinning a release version.

### Where wizard could lead
- **Schema-strict tool definitions surviving Vertex strict validation by default.** No major peer ships this.
- **Ambient mode as MCP-server-mode.** First-class rather than retro-fit. No peer does this well — Cursor's CLI fails inside Cursor's own integrated terminal because of TTY/env conflicts.
- **First-class skills + version-pinned distribution** colocated with a clear two-cadence release model.

---

## 4. Internal Codebase Findings

### Shipped wizard (`~/worktree-repos/wizard`)

**The single biggest problem is `src/lib/agent-interface.ts` (4,112 LOC).** It mixes:
- SDK loading + dynamic-import type mirrors (lines 97-162).
- Model selection + max-turns + auth detection (lines 218-263, 1889-2053).
- 200-LOC `createPreToolUseHook` (669-871) and four other hook factories (888-1221).
- Stream event filtering (`stripStreamEventNoise`, 544-630) — hand-rolled because `includePartialMessages: true` leaks SDK envelopes into stderr.
- 250-LOC bash policy with allowlist+deny+circuit-breaker (1339-1591).
- 225-LOC `wizardCanUseTool` env-file/path policy (1659-1885).
- A 1,569-LOC `runAgent` function (2301-3870).
- Two LLM client paths (`runAgentLocally` 2119-2236 and `console-query.ts`).

**Other concentrations of complexity:**
- `src/lib/wizard-tools.ts` (1,964 LOC) — single file, 9 tools defined inline.
- `src/lib/agent-runner.ts` (1,835 LOC) — universal runner.
- `src/lib/wizard-session.ts` (1,091 LOC) — load-bearing mutable state.
- `src/ui/tui/store.ts` (2,071 LOC), `screens/DataIngestionCheckScreen.tsx` (1,142 LOC), `AuthScreen.tsx` (965 LOC).
- `src/lib/api.ts` (1,260 LOC), `src/lib/credential-resolution.ts` (663 LOC), `src/commands/default.ts` (1,361 LOC).

**PostHog / Ampli inheritance traces:**
- Forked from `posthog/wizard` (commits `59f5e944`, `d29fc578`, `9047bdd0`, `f9966004`, `6b784cc4`, `5867c81c`, `71158b6e` rebrand). String scrub thorough; the *shape* is the residue.
- Ampli legacy: `src/utils/ampli-settings.ts` (474 LOC) reads/writes OAuth tokens to `~/.ampli.json`; `src/lib/ampli-config.ts` (371 LOC) reads/writes `ampli.json` and migrates `WorkspaceId` → `ProjectId`. 30+ TUI files reference `ampli.json` paths. Pure compatibility tax.
- Dead deps: `zod-to-json-schema` (declared, never imported), `xcode`, pinned `chalk@2.4.2`.
- Two MCP server stacks: `@anthropic-ai/claude-agent-sdk` plus `@modelcontextprotocol/sdk`.
- Mirror types of the SDK at `agent-interface.ts:97-148`, `agent-hooks.ts:5-29`, `middleware/schemas.ts:87+` — duplicated only because of CJS dynamic-import interop.
- Build is bare `tsc` to CJS; no `exports` map.

**TUI architecture is genuinely good and should be carried forward, not rewritten.** Ink + React 19 + nanostores + `@inkjs/ui`. `flows.ts` declarative pipelines + `router.ts` overlay stack + `screen-registry.tsx`. 17 screens, 14 components. Fast-check property-based flow invariant tests are an asset. Coupling is `WizardSession`, not the TUI itself. **Lift, don't rebuild.**

### wizard-v2 (`~/worktree-repos/wizard-v2`)

~12,638 LOC TS. ESM. Clean `LlmClient` (`src/llm/client.ts:80-175`) with **the working sanitizer for the proxy bug** (lines 41-78): `stripSchemaNoise` removes `$schema` + `additionalProperties` (we add `exclusiveMinimum`/`Maximum` in Phase 1). 21 framework detectors, 14 installers, 14 native templates. 17-tool MCP surface with versioned envelope. PKCE OAuth. Skills loader fully wired. Live LLM eval suite with scoring (`evals/`). 47 test files, ~7,580 LOC.

What it gets right: the harness. What it lacks: streaming UI (`generateText`), an explicit presentation interface, mid-run interrupts.

### wizard-rewrite (`~/worktree-repos/wizard-rewrite`)

~9,110 LOC TS. ESM. Cleaner directory layout (`gateway/`, `analytics/`, `auth/`, `core/`, `graph/`, `installers/`, `mcp/`, `cli/wizard-ui/`). Uses `streamText` for the agent loop. **`WizardInstallPresentation` interface** (`src/cli/wizard-ui/types.ts:1-60`) is the explicit "swap to Ink/TUI" seam. LangGraph **interrupts** done correctly via `confirm-framework-node.ts` raising `GraphInterrupt` and `runInstallCli` resuming via `new Command({ resume })`.

**The LangGraph dependency is unjustified for this workload.** Vercel AI SDK v6 now solves the same human-in-the-loop pause/resume via `stopWhen` + tool-call-as-interrupt + `prepareStep`. Adopting wizard-rewrite as-is means the team runs two state machines, two retry models, two telemetry shapes — exactly the two-stack drift this plan elsewhere argues against. **The pieces of wizard-rewrite worth taking are `WizardInstallPresentation` (~60 LOC) and the directory layout. Drop the rest.**

What wizard-rewrite lacks: working sanitizer (same 400 bug), wired agent loop (one demo tool), skills loader, PKCE login, native templates, taxonomy/instrumentation/apply pipeline, multi-account auth, sessions list/show/rm/prune.

### context-hub (`~/worktree-repos/context-hub`)

`@amplitude/context-hub@1.2.0`. Three input streams: `mcp-marketplace` upstream + `transformation-config/` (config-based skills generated from docs + `basics/` example apps) + in-tree `skills/{instrumentation, taxonomy, wizard}`. Output: ~50 skill ZIPs + `manifest.json` + `skill-menu.json` + `skills-mcp-resources.zip` published to a versioned GitHub Release. CI enforces 1 MB per skill / 8 MB bundle, runs prompt-injection scanner, env-var-naming lint, triggers wizard E2E against test apps. Frontmatter has only `name` + `description`. Wizard pulls `latest` unpinned (`wizard/scripts/refresh-skills.sh:96`) — that's the actual drift vector. Runtime fetch infrastructure exists in `wizard-tools.ts` but is currently disabled.

### What to carry forward vs. discard

**Carry forward:**
- The shipped wizard's Ink TUI architecture (lift onto `WizardInstallPresentation`).
- Atomic-write infrastructure, session-checkpointing, storage-paths abstraction.
- Observability infra (`src/lib/observability/`).
- Middleware pipeline, safety scanner.
- context-hub itself: skills format, build pipeline, size budgets, prompt-injection scanner.

**Discard:**
- `runAgentLocally`, `console-query.ts` (third LLM path).
- The 1,569-LOC `runAgent` function — state-machine it.
- 200-LOC `createPreToolUseHook` and 225-LOC `wizardCanUseTool` — drive from a small policy table wrapped via `withWizardPathPolicy(tool)` helper.
- Mirror SDK types — move to ESM, drop dynamic import.
- Dead PostHog frameworks (`unreal`, `unity`, `flutter`, `go`, `java` — verify via telemetry first).
- Hand-rolled `stripStreamEventNoise`.
- One of the two MCP stacks.
- `zod-to-json-schema`, `xcode`, `chalk@2.4.2`.
- `ampli.json` and `~/.ampli.json` reads (major version bump after telemetry confirms).
- **LangGraph from wizard-rewrite — never adopt it.**

---

## 5. Rewrite vs. Incremental Verdict

**Verdict: Single new foundation. Take wizard-v2's harness + sanitizer + tools + skills + evals + templates, lift them onto a fresh repo whose presentation layer matches wizard-rewrite's `WizardInstallPresentation` interface, and ship the Ink TUI as a new implementation of that interface. Drop LangGraph entirely. The shipped wizard goes onto life-support after Phase 1.**

This is not a hedge. It's a specific, defensible call grounded in three observations.

### Why a new foundation, not incremental migration

1. **The legacy debt is concentrated in the files an incremental migration would touch first.** `agent-interface.ts` (4,112 LOC), `wizard-tools.ts` (1,964 LOC), and `agent-runner.ts` (1,835 LOC) are the agent harness — exactly what the Vercel AI SDK migration must replace. Refactoring these in place means rewriting the same code under live production load.

2. **The mirror-types / dynamic-import pattern goes away in ESM.** `agent-interface.ts:97-148`, `agent-hooks.ts:5-29`, `middleware/schemas.ts:87+` are duplication only because the package is CJS. Migrating shipped wizard to ESM is itself a major change touching the same files.

3. **`WizardSession` is the load-bearing coupling between TUI and harness.** Lifting the TUI onto `WizardInstallPresentation` forces a clean re-derivation of session shape; in-place migration would let the legacy shape ossify.

### Why neither rewrite is the foundation as-is

- **wizard-v2 is operationally complete but lacks the presentation seam.** Every `cli/wizard/step-*.ts` calls `@clack/prompts` directly. Building `WizardInstallPresentation` on top of it is a flat rewrite of every step.
- **wizard-rewrite has the seam but its harness is broken (no sanitizer) and depends on LangGraph as a second runtime.** Adopting wizard-rewrite as-is means inheriting a problem this plan otherwise spends pages avoiding (two-stack drift).

The third option — and the right one — is to build a new repo structure modeled on wizard-rewrite's directory layout, port wizard-v2's working pieces in, and adopt `WizardInstallPresentation` as the only piece of wizard-rewrite worth keeping. **LangGraph is not adopted.** The install-graph state becomes a small typed state machine driven by Vercel AI SDK tool calls; mid-run human-in-the-loop pauses are tool calls that throw a typed `AwaitUserConfirmation` error caught by the presentation layer.

### What to call this and where it lives

Two options:
- **Option A:** New repo `wizard-core` (or rename `wizard-rewrite` → `wizard-core` after stripping LangGraph and porting wizard-v2 in). Shipped wizard stays as `@amplitude/wizard@1.x` on life-support. Eventual cutover via major version bump (`@amplitude/wizard@2.0.0`) and same npm name. **Recommended.**
- **Option B:** New npm name (`@amplitude/wizard-core`) for parallel publishing, eventual rename. More marketing churn, less risky technically.

**This plan assumes Option A.** Cutover happens in Phase 7 via major version bump.

### What gets ported, in order
1. `wizard-v2/src/llm/client.ts` (sanitizing fetch + schema scrubber + add the missing `exclusive*` keys + switch to `authToken`) → new repo's `src/llm/`.
2. `wizard-rewrite/src/cli/wizard-ui/types.ts` + `create-install-ui.ts` → new repo's `src/cli/`.
3. `wizard-v2/src/agents/tools.ts` (file-reading + grep with sandbox path resolution) → new repo's `src/agents/`.
4. `wizard-v2/src/agents/skills.ts` + `.agents/skills/` → new repo.
5. `wizard-v2/src/agents/{taxonomy,instrumentation,edit-applier}.ts` → new repo.
6. `wizard-v2/src/auth/oauth-login.ts` (PKCE driver) → new repo.
7. Native templates, live eval suite, self-instrumentation telemetry.
8. The shipped wizard's Ink TUI lifted (not rewritten) as a third `WizardInstallPresentation` implementation.

### The honest counter-argument
If timeline pressure says "ship a parity replacement in <1 quarter," **wizard-v2 is the safer single-bet** — operationally complete today with 4× the test surface. The TUI rebuild on top of it is harder but the substrate is closer to production. Default to wizard-v2 in that case, absorb the harder TUI rebuild later. Otherwise, the new-foundation path is right.

---

## 6. Architectural Recommendations

### Agent harness migration to Vercel AI SDK

**Current shipped abstraction → new (Vercel AI SDK 6) primitive:**

| Current (`wizard/src/lib/`) | New |
|---|---|
| `agent-interface.ts` `runAgent` (1,569 LOC) | `ToolLoopAgent` instance + `streamText` |
| `selectModel` + `fallbackModel` | Per-step `prepareStep` + Vercel AI Gateway for provider failover |
| `AUTH_ERROR_PATTERNS` regex retry | Catch typed `APICallError`, classify by `statusCode` |
| `createPreToolUseHook` (200 LOC) | Per-tool `execute` wrapper + `withWizardPathPolicy(tool)` shared helper |
| `wizardCanUseTool` (225 LOC) | Tool-level deny list via `withWizardPathPolicy(tool)`; emit typed `InvalidToolArgumentsError` |
| `stripStreamEventNoise` (60 LOC) | Drop. Use `streamText.fullStream`, ignore non-text-delta chunks |
| `wizard-tools.ts` (1,964 LOC, 9 tools) | 9 files under `src/agents/tools/`; honest expectation ~150-220 LOC each |
| `wizard-mcp-server.ts` (external stdio MCP) | Generated from same tool definitions to avoid two-stack drift |
| `mcp-with-fallback.ts` (746 LOC) | `experimental_createMCPClient` + small fallback path; realistic ~150 LOC |
| `agent-driver.ts` + `scripted-agent-driver.ts` | Keep port pattern; point at Vercel AI SDK |
| `claude-settings-scope.ts` | Delete. Pass `apiKey`/`baseURL`/`headers` explicitly to `createAnthropic` |
| `sanitize-claude-env.ts` | Keep, but only for child processes the wizard spawns (e.g. `pnpm test` runs) |

**Honesty about what won't shrink as much as the table suggests:**
- The Anthropic Agent SDK gives you bash sandboxing, hook ordering, and PreToolUse semantics for free. Vercel AI SDK does not. The 250 LOC of bash policy and `wizardCanUseTool` won't *vanish*; they'll move to a tool-call middleware. Plan for 150-200 LOC, not 50.
- `wizard-tools.ts` decomposes into 9 files of 150-220 LOC each, not 100-200. The original average is ~218 LOC/tool.

**Cross-cutting additions (new):**
- **Vercel AI Gateway** for multi-provider failover. Configure Anthropic direct → Bedrock → Vertex routing in the gateway, retry-on-provider-error in the SDK. Phase 1 enables it for the harness; Phase 2 adopts it everywhere.
- **Prompt caching** via `@ai-sdk/anthropic` 3.x cache control. The commandments + active skill prefix is 5K+ stable tokens — apply `cache_control: { type: 'ephemeral' }` to the system block. Free latency reduction + ~90% cost reduction on cached prefix tokens. Phase 2.
- **Compaction.** AI SDK v6 leaves context compression to userland; use `prepareStep` + a hand-rolled summarizer. Carry forward the existing `state/<attemptId>.json` snapshot pattern.
- **MCP `experimental_` prefix** is load-bearing. Wrap behind an internal interface so a v7 rename isn't a 50-file diff.

**Patterns that need rearchitecting:**
- The 1,569-LOC `runAgent` function decomposes into:
  - `agent.run({ prompt, abortSignal })` — thin wrapper around `streamText`.
  - `journey-state.ts` — journey advancement + stall timer + heartbeat.
  - `tool-result-watcher.ts` — dashboard + event-plan polling.
  - `stream-pill.ts` — throttled status-pill renderer.
  - `model-output-capture.ts` — diagnostics capture.
- `wizard-session.ts` splits into `session-state.ts` (read-only view for screens) + `session-events.ts` (mutations as discrete events).

### Ambient-agent / nested-harness story

When wizard detects it's running inside Claude Code, Cursor, or Cline, route to **MCP-server mode**, not just NDJSON output:

- Wizard registers itself as an MCP server (typed tools: `detect_framework`, `propose_event_plan`, `apply_instrumentation`, `verify_ingestion`).
- The host agent calls these tools instead of the wizard running its own agent loop.
- Eliminates the harness-vs-harness fight by construction — the wizard never makes its own LLM calls in ambient mode.
- Reuses `wizard-mcp-server.ts` (already exists for `amplitude-wizard mcp serve`).
- NDJSON output remains the fallback for ambient harnesses that don't speak MCP (CI runners, generic agents).

This is a structurally better answer than "detect and emit JSON."

### Skills / context architecture

**Recommendation: Keep context-hub as a separate repo. Tighten the contract.**

- **Pin the wizard to a context-hub release version** instead of `latest` (`refresh-skills.sh:96`). Use the existing `SKILLS_BASE_URL` machinery in `wizard-tools.ts`.
- **Add frontmatter validation** in context-hub CI: every skill must have `name`, `description`, `version`, `tools-allowed`, `triggers`.
- **Add a token-budget linter** (≤2,000 tokens per SKILL.md body; references larger but lazy-loaded). Replicate the `wizard-prompt-supplement` lazy-load pattern for heavy instrumentation skills.
- **Add cross-skill invariant tests** for the autocapture-events list.
- **Re-enable runtime `load_skill_menu` / `install_skill`** in `wizard-tools` so per-run skill selection by category works. Three-tier progressive disclosure (name+description always, body on activation, references lazy) becomes a runtime contract, not just CI.
- **Move `skills/wizard/wizard-prompt-supplement`** into the wizard repo (it's wizard-only). Keep instrumentation/taxonomy/integration in context-hub.
- **MCP Apps (SEP-1865)** for interactive responses — adopt in Phase 6+ to replace the bespoke `confirm` / `confirm_event_plan` tools.

### Repo structure rationalization

- Three repos: new wizard foundation (becomes `@amplitude/wizard@2.0.0`), context-hub, and (during transition only) shipped `@amplitude/wizard@1.x` on life-support.
- **Delete `wizard-v2` and `wizard-rewrite` after the port is complete.** Don't maintain four CLI repos.
- `marketplace-internal`, `mcp-marketplace`, `builder-skills` — **[unverified — not local]**. Open question.

### Wizard-proxy: extract from the App API

The current `wizard-proxy/` namespace inside the App API (`router.ts`, `vertex.ts`, `auth.ts`, ~50 files) is the unit of extraction.

**Why extract:** the App API is Amplitude's main web app server, handling the majority of GUI requests. Adding active LLM-request rewriting (sanitization, multi-provider failover, real-Vertex-error passthrough) to a high-traffic monolith means a wizard-proxy bug can take down the GUI for every Amplitude user. The blast radius is wrong. The earlier draft of this plan recommended modifying the App API in place; that recommendation is reversed once the App API's actual scope is acknowledged.

**Where to extract:** a small dedicated service on existing AWS or GCP infrastructure. The wizard-proxy is stateless (Hydra introspection via Redis, a single forward to Vertex) so it fits cleanly on Cloud Run, ECS Fargate, or App Runner — pick based on existing Amplitude platform conventions, not first-principles. Keep Hydra introspection and Redis caching verbatim; don't rebuild auth.

**What lands on the extracted service (not the App API):**
1. **Beta-header allowlist.** Replace the regex pass-through at `app-api/src/wizard-proxy/router.ts:443-451` with an explicit allowlist of betas Vertex actually honors. Today's regex `/^[a-zA-Z0-9\-, ]+$/` admits any token-shaped string; Vertex rejects most.
2. **Tool-schema sanitization.** Add a recursive walker to `buildVertexBody` (`app-api/src/wizard-proxy/vertex.ts:260-271`) that strips `$schema`, `additionalProperties`, `exclusiveMinimum`, `exclusiveMaximum`, `$id`, `$ref` from every `tools[].input_schema`. Backstops every `npx`-pinned wizard build still in the wild — the client-side fix in Phase 1 only protects users who upgrade.
3. **Real-Vertex-error passthrough on 4xx.** Today `router.ts:917-974` clamps every 4xx to one of seven hardcoded messages, which destroys debuggability. Pass through Vertex's error JSON for 400/404/422 (where the *client* caused the issue and needs the detail), keep the wrapper for 401/403/429/5xx (where leaking provider internals could be sensitive). Strip any auth-echoing fields defensively.
4. **Multi-provider failover.** Anthropic direct → AWS Bedrock → GCP Vertex. Live at the proxy, not the client, because: auth credentials for Anthropic/Bedrock can't ship to every `npx` install, the 4xx-vs-5xx routing decision belongs adjacent to the upstream response, and observability stays unified.

**The App API gets:** a one-line route deletion when the extracted service is dialed up to 100% traffic.

---

## 6.5. v2 Cherry-Pick Prescription

Cherry-picked from a feature-by-feature inventory of all three repos (shipped, wizard-v2, wizard-rewrite). The version below is the binding allocation. Each line is an instruction for the v2 build, not a suggestion.

### Lift from shipped wizard (`~/worktree-repos/wizard`) — the foundation
- **Entire Ink TUI surface, lifted not rewritten.** `src/ui/tui/{App.tsx, store.ts, router.ts, flows.ts, screen-registry.tsx, console-commands.ts, start-tui.ts, ink-ui.ts}` + all 17 screens + components + hooks + the property-based `flow-invariants.test.ts` (24 fast-check properties). The only decoupling is at the `ink-ui.ts`/`store.ts` boundary, where `WizardSession` shape gets cleaned up.
- **Yargs CLI surface — verbatim, this is the v2 backwards-compat contract.** `bin.ts` flag definitions + every command in `src/commands/{default, login, logout, whoami, feedback, slack, region, detect, projects, plan, apply, verify, status, auth, mcp, manifest, reset}.ts`. Strict parser, env-passthrough shadows, `--app-id` numeric validation, hidden legacy flags (`--workspace-id`, `--org`, `--env`) preserved as parsed-but-ignored for one major release.
- **All 14 slash commands** from `src/ui/tui/console-commands.ts:39-67` (`/region`, `/login`, `/logout`, `/whoami`, `/create-project`, `/mcp`, `/slack`, `/feedback`, `/clear`, `/debug`, `/diagnostics`, `/snake`, `/exit`) plus `/help` (currently undocumented in the registry, add it).
- **Apply lock:** `src/utils/apply-lock.ts`. Only impl across the three repos; ships immediately.
- **Session checkpointing:** `src/lib/session-checkpoint.ts` + Zod schema, scoped per install dir, atomic-write contract, no credentials.
- **Ambient/nested-agent detection:** `src/lib/{sanitize-claude-env, detect-nested-agent}.ts`. Runs before any other import in `bin.ts:9-10`. Critical for nested Claude Code runs.
- **Storage paths + atomic write + token refresh:** `src/utils/{storage-paths, atomic-write, token-refresh, storage-migration}.ts`.
- **Self-instrumentation analytics:** `src/utils/analytics.ts`. Most mature of the three (group analytics on `'org id'`, dev/prod split, lowercase-with-spaces property keys per Amplitude convention).
- **MCP installer coverage** (Claude Code + Cursor + Desktop + VSCode + Zed + Codex): `src/steps/`. Widest editor coverage.
- **Skills loader + context-hub integration:** `skills/{integration, instrumentation, taxonomy}/` + `pnpm skills:refresh`.
- **Observability:** `src/lib/observability/` structured logger + Sentry init.
- **Pipe-error / safety-net handlers:** `src/utils/{pipe-errors, safety-net}.ts`.

### Lift from wizard-v2 (`~/worktree-repos/wizard-v2`) — clean isolated wins
- **Multi-account auth** (the user's explicit requirement): `src/auth/{accounts, oauth-login, token-refresh, types, amplitude-urls}.ts`. Only impl with `auth list / use / whoami / token` parity. Rebase storage to shipped wizard's `~/.amplitude/wizard/` layout (preserve backward-compat read of `~/.ampli.json` + `~/.amplitude-wizard-v2/accounts.json` for one release).
- **Vercel AI SDK harness** (already partly ported in PR `wizard-rewrite#5`): `src/llm/client.ts` + `src/agents/{tools, project-survey, instrumentation, taxonomy, edit-applier, diff}.ts`. The per-role tool-set pattern (`src/agents/tools.ts:57-80`) is genuinely better isolation than shipped wizard's monolithic `wizard-tools.ts`. **This wins over shipped wizard's Claude Agent SDK** for v2 because (a) `tool()` + Zod is more portable, (b) no Anthropic-specific subprocess lock-in, (c) the eval harness already targets it.
- **Native templates (all 11)** as inline files, not skill references: `src/templates/{swift, kotlin, java, go, flutter, unity, unreal, android, react-native, python, node, browser}/*.template`. Shipped wizard delegates to skills for native frameworks, which is fine for instructions but loses the one-step-install ergonomic. wizard-v2's templates fix that.
- **Eval harness** (only impl): `evals/{runner, scoring, fixtures, index}.ts` + `eval:llm` / `eval:scoring` scripts. Ports as-is.
- **Setup-report writer:** `src/cli/setup-report.ts`. Markdown + JSON sibling. Shipped wizard prints `report_status` only.
- **Sessions list/show/rm/prune:** `src/cli/commands/sessions.ts` + `src/graph/sessions.ts` (rip out the LangGraph dependency, keep the persistence layer).
- **NDJSON output channels:** `src/cli/output.ts` `resolveChannels` / `emitNdjson` / `NoTtyPromptError`. Composes well with the shipped wizard's `agent-ui.ts`.
- **Detector breadth:** `src/detectors/{android, kotlin, swift, go, java, flutter, unity, unreal, react-native}.ts` — fills the gaps where shipped wizard relied on skills.

### Lift from wizard-rewrite (`~/worktree-repos/wizard-rewrite`) — minimal, two things
- **`WizardInstallPresentation` interface:** `src/cli/wizard-ui/{types.ts, clack-install.ts, machine-install.ts}`. The abstraction that lets v2 swap Ink / clack / JSON without touching install logic. Used as the boundary between shipped wizard's Ink TUI and wizard-v2's install pipeline.
- **The 11-node install-pipeline decomposition** (just the file split, *not* LangGraph): `src/graph/nodes/{detect-resolve, confirm-framework, prepare-install, install-sdk, inject-entry, write-init, write-env, write-env-example, starter-events, ingestion-verify, slack-connect}-node.ts`. Good architecture even after dropping LangGraph — port each to a plain async function with typed `AwaitUserConfirmation` errors caught by `WizardInstallPresentation`.

### Discard entirely
- **Shipped wizard:** the parts of `src/lib/middleware/benchmark*` not load-bearing for the agent loop; the legacy `--workspace-id` / `--org` / `--env` flag *branching* (keep parse-and-ignore for backcompat); `src/lib/scripted-agent-driver.ts` (replaced by AI SDK harness); the dual MCP server stacks (consolidate to one).
- **wizard-v2:** `src/cli/wizard/step-*.ts` clack-based steps (replaced by shipped wizard Ink screens via `WizardInstallPresentation`); `src/cli/index.ts` yargs surface (shipped wizard wins on flag names); duplicated `src/auth/token.ts` single-account path (multi-account is canonical now); `evals` JSON fixtures should move to a top-level `evals/` package, not bundled into the npm tarball.
- **wizard-rewrite:** `@langchain/langgraph` dependency + `src/graph/installation-graph.ts` graph-runner glue + `src/graph/routing*.ts` (per `wizard-rewrite/docs/drop-langgraph-plan.md`); `src/agent/wizard-agent-loop.ts` (wizard-v2's harness replaces it); `src/cli/wizard-ui/machine-install.ts` (replaced by shipped wizard's `agent-ui.ts` NDJSON).

### Greenfield in v2 (no repo has these)
- **Ambient mode as MCP server.** When wizard detects it's running inside Claude Code / Cursor / Cline, register itself as a long-lived MCP server (typed tools: `detect_framework`, `propose_event_plan`, `apply_instrumentation`, `verify_ingestion`) and let the parent agent drive. Eliminates the harness-vs-harness fight by construction. Shipped wizard's `wizard-mcp-server.ts` is read-only today; needs write surface + lifecycle.
- **Property-based test coverage for the install pipeline** (shipped wizard has it for flows only). Mirror the `flow-invariants.test.ts` pattern onto the install graph.
- **First-class CI provider artifacts** (GitHub Actions, GCP Cloud Build, AWS CodeBuild) — none of the three repos ships these.
- **The v2 backwards-compat test suite.** A test file that asserts every flag in the shipped wizard's `bin.ts` still parses identically in v2, every slash command still resolves, every env var still has the same effect. Without this, the "preserve CLI for backwards compat" directive drifts silently.

### v2 Backwards-Compat Contract (binding)
- **Same npm package name:** `@amplitude/wizard@2.0.0`. No new package name; major version bump is the cutover.
- **Every yargs subcommand and flag** in shipped wizard's `bin.ts` and `src/commands/` parses identically in v2. `npx @amplitude/wizard --agent`, `--ci`, `--yes`, `--debug`, `--app-id`, `--app-name`/`--project-name`, `--api-key`, `--auth-onboarding`, `--default`, `--force`, `--install-dir`, `--json`/`--human` all behave the same.
- **All 14 slash commands** resolve.
- **Storage paths** (`~/.amplitude/wizard/oauth-session.json`, `~/.amplitude/wizard/credentials.json`, `~/.amplitude/wizard/runs/<sha>/`, `<install>/.amplitude/{events.json, project-binding.json, dashboard.json}`) read identically. New writes use the same paths.
- **Backward-compat reads** for one release: `~/.ampli.json`, per-project `ampli.json`, `WorkspaceId` legacy fields, wizard-v2's `~/.amplitude-wizard-v2/accounts.json`. Drop in a 2.x minor release after telemetry confirms migration.
- **Hidden legacy flags** (`--workspace-id`, `--org`, `--env`, `--signup`) parse without erroring; the v2 implementation may ignore them, but the parser must accept.
- **Exit codes** (`0`, `2`, `3`, `4`, `10`, `130`) preserved per `src/lib/exit-codes.ts`.
- **NDJSON event schema** in `--agent` mode preserved per `src/ui/agent-ui.ts`. Schema versioning added (`schema_version: '2'`) but v1 consumers continue to parse.

---

## 6.6. Adoption from the main Amplitude monorepo

The main monorepo at `~/amplitude-repos/amplitude` contains two pieces of production infrastructure the wizard plan should adopt rather than rebuild. Discovery via dedicated agent run.

### `amplitude_ai` (`langley/amplitude_ai/`) — adopt for Python detection + LLM-analytics workflows
A shipping PyPI package with multi-provider LLM SDK (OpenAI, Anthropic, Bedrock, Azure OpenAI, Gemini, Mistral) at `langley/amplitude_ai/amplitude_ai/providers/`, integrations for LangChain/LlamaIndex/CrewAI/openai-agents/Claude Agent SDK/OpenTelemetry at `langley/amplitude_ai/amplitude_ai/integrations/`, and a 739-LOC pure-Python AST scanner at `langley/amplitude_ai/amplitude_ai/mcp/scan_project.py` that detects Python frameworks (FastAPI, Flask, Django), every major LLM provider, agent frameworks, streaming, multi-agent patterns, and message queues. Exposed as an MCP server with `scan_project`, `validate_file`, `instrument_file`, and `generate_verify_test` tools. Includes a 4-phase **Detect → Discover → Instrument → Verify** instrumentation contract at `langley/amplitude_ai/amplitude-ai.md:1-50` aimed at coding agents.

**Wizard adoption:**
- **Python detection delegates to `amplitude_ai`'s MCP server.** When the wizard detects a Python project, call `scan_project` for framework/provider/agent-library detection rather than duplicating the AST scan in TS. Two detection engines is the failure mode here — `amplitude_ai` is more thorough than the wizard's TS detectors and is owned by a separate team that updates it as the Python ecosystem moves.
- **LLM-analytics customer path delegates to `amplitude_ai`'s skill.** A `langley/amplitude_ai/.cursor/skills/instrument-with-amplitude-ai/SKILL.md` already exists. The wizard's instrumentation skill should *route to* this for LangChain/CrewAI/openai-agents users rather than ship a competing instruction pack.
- **The 4-phase contract is the canonical Amplitude story.** The wizard's overall workflow (currently: detect framework → install SDK → instrument events → confirm dashboard) should align verbatim with Detect → Discover → Instrument → Verify so the wizard and `amplitude_ai` tell users a single coherent story.
- **The wizard does NOT replace `amplitude_ai`.** The wizard is for product analytics + onboarding ergonomics + multi-platform (web + mobile + native). `amplitude_ai` is for LLM analytics in Python LLM apps. They are complementary surfaces.

### `mcp_gateway/` — adopt for any wizard-side MCP server delivery
Production-grade MCP gateway built on `mcp-contextforge-gateway` (PyPI). Already solves OAuth (DCR), SSRF protection, identity forwarding via `x-amp-login-id`, cost guard, PII detection, three tenancy modes (BYO, org-managed, org-managed + user auth). API documented at `mcp_gateway/API.md:80-450`. Conventions per `mcp_gateway/CLAUDE.md:24-28`: tables `amp_*`, env vars `AMP_*`, new MCP integrations land as Context-Forge plugins (no forks; "upstream upgrades via `pip install --upgrade`").

**Wizard adoption:**
- The "wizard exposes itself as MCP server in ambient mode" greenfield item (per §6.5) lands as a Context-Forge plugin under `mcp_gateway/plugins/amplitude_wizard/`, not as a free-standing service. This inherits OAuth, SSRF, identity forwarding, cost guard, and PII detection from the gateway for free.
- Ambient-mode behavior: when wizard detects it's running inside a host agent that talks MCP, route to `mcp_gateway` rather than running its own `wizard-mcp-server.ts` process.

### `houston/chat` — out of scope but adjacent
`houston/` (FastAPI + Temporal + OpenSearch + `pydantic_ai`) hosts the in-app Amplitude assistant. Mentioned for context — the wizard does **not** embed runtime chat; that's a separate service with heavy infra. Don't reinvent here.

### `dynconfv2` — the only feature-flag system
Per `amplitude/CLAUDE.md:50-53`, all wizard-side feature flags (e.g. the Phase 4 `AMPLITUDE_WIZARD_NEXT=1` opt-in) should be backed by `dynconfv2`, not invented in the wizard. Types are immutable — never reuse a flag key with new types.

### `builder-skills` — out of scope for v2
Public OSS marketplace of PM/analyst/marketer prompt templates. Different audience (knowledge workers vs. coding agents), different shape (prose templates vs. instruction packs that affect code), different lifecycle (curated by Amplitude product team vs. generated by code-detection logic). Should remain separate from context-hub. The earlier `[unverified — not local]` flag is removed; the answer is "out of scope for v2."

### Constraints the v2 plan respects
- Branch naming `JIRA-TICKET/<service>/feature-description` per `langley/CLAUDE.md:330-335`.
- All new gateway tables prefixed `amp_`; env vars `AMP_*`.
- Reuse canonical types in `amp/amp_typing/`, `amp/model/`; never widen types.
- Detection logic must live next to `amplitude_ai`, not in TS-only code, or it will diverge.

---

## 7. Phased Migration Roadmap

**Total estimate: 28-36 engineer-weeks across 9 phases for v2 delivery** (Phase P moved out of v2 critical path — see "Future / non-blocking" section below).

**Ship order optimized for user value:** 1 → 2a → 5 → 3 → 2b → 4 → 6 → 7 → 8 → 9. Ambient-agent ships before TUI rebuild because it's the higher-leverage user win (today's pain is bug + agent friction, not TUI).

### Phase 1 — Stop the bleeding (1-2 weeks, 1 engineer)
**Goal:** Fix the `--agent` API 400 bug for users on shipped wizard today.
**Pre-work (1 day):** Confirm the exact Vertex rejection by reading the App API's `[WizardProxy] Upstream error` logs in Datadog for a recent failing request. The proxy logs the upstream body (truncated to 500 chars) at `app-api/src/wizard-proxy/router.ts:927`. This tells us whether to ship just the beta strip, just the schema strip, or both.
**Scope:**
- In `wizard/src/lib/agent-interface.ts:2969`, env-gate `betas: ['context-1m-2025-08-07']` behind `AMPLITUDE_WIZARD_GATEWAY_BETAS=1`. Default off on the gateway path. Delete the misleading "falls back to 200K" comment.
- Add a sanitizing fetch wrapper that strips `anthropic-beta` and `$schema`/`additionalProperties`/`exclusiveMinimum`/`exclusiveMaximum` from `tools[].input_schema`. Port wizard-v2's `sanitizingFetch` and **add the two missing exclusive keys**.
- Update `fallbackModel` to `claude-sonnet-4-6`.
- Tighten the 400 retry classifier (`agent-interface.ts:3492-3552`) to detect `"Invalid request sent to model provider"` and emit `gateway_400_invalid_request` with a clear remediation message.
- Add a regression test that asserts the wire request body never contains `$schema`, `additionalProperties`, `exclusiveMinimum`, `exclusiveMaximum`, or `anthropic-beta` headers in `--agent` mode.
- Ship as `@amplitude/wizard@<next-patch>`.
**Definition of done:** Users running `npx @amplitude/wizard --agent` inside Claude Code, Cursor, and Cline complete a wizard run without 400. Telemetry shows the 400 rate on `--agent` drops by ≥95%.

### Phase 2a — Foundation harness (3 weeks, 1-2 engineers)
**Goal:** New repo with a working agent loop end-to-end on Vercel AI SDK, against the live proxy, with one real tool.
**Status:** Slice 1 of this phase has shipped — see PR `wizard-rewrite#5` (sanitizer port with `exclusiveMinimum`/`exclusiveMaximum` additions onto wizard-rewrite).
**Scope:**
- Pick `wizard-rewrite` as the *layout* foundation. Strip LangGraph (separate PR per `wizard-rewrite/docs/drop-langgraph-plan.md`). Rename to `wizard-core` (or merge into `wizard` and delete `wizard-rewrite`).
- Pin auth pattern: `authToken` via `@ai-sdk/anthropic` 3.x. Validate end-to-end against the App API's `authenticate` middleware on day 1. **Done in PR `wizard-rewrite#5`.**
- Pin model id: `claude-sonnet-4-6` via `WIZARD_CLAUDE_MODEL`.
- Port wizard-v2's `LlmClient` sanitizer (with `exclusive*` additions) into `src/llm/`. **Done in PR `wizard-rewrite#5`.**
- Port wizard-rewrite's `WizardInstallPresentation` interface + `ClackWizardInstallPresentation` + `MachineJsonInstallPresentation`.
- Wire `streamText` via `ToolLoopAgent` for the agent loop (not `generateText`).
- One real tool end-to-end: `read_file` from wizard-v2.
- Prompt caching via `cache_control: { type: 'ephemeral' }` on the commandments system block.
- Live LLM evals harness ported (`evals/runner.ts`, scoring rubric).
**Definition of done:** Agent loop runs against the live proxy with sanitization + caching. Live LLM evals match wizard-v2's baseline on the read_file path. (Multi-provider failover deferred to the wizard-proxy extraction phase below — not a client concern.)

### Phase 5 — Ambient agent first-class support (2 weeks, 1 engineer)
**Goal:** Wizard runs cleanly inside any agent harness via MCP-server-mode.
**Scope:**
- Vendor or port `@vercel/detect-agent`'s detection table.
- When ambient agent detected: route to `wizard-mcp-server.ts` (already exists for `amplitude-wizard mcp serve`). Wizard exposes typed tools (`detect_framework`, `propose_event_plan`, `apply_instrumentation`, `verify_ingestion`); the host agent drives. No wizard LLM calls in ambient mode.
- Fallback path for ambient harnesses that don't speak MCP: NDJSON output with versioned schema, semantic exit codes.
- Refuse to run with `sk-ant-oat01-…` OAuth subscription tokens (Anthropic policy) — emit structured error.
- E2E tests: spawn wizard inside Claude Code CLI, assert successful MCP-tool-call completion.
- Document the env-var contract in `docs/ambient-agent-mode.md`.
**Definition of done:** `npx amplitude-wizard install` inside Claude Code completes without 400 and via the MCP-server path. Smoke-tested on Cursor, Cline, Codex CLI, Copilot CLI.

### Phase 3 — Native templates and detection parity (2-3 weeks, 1 engineer + 1 week telemetry analysis)
**Goal:** Match shipped wizard's framework matrix using wizard-v2's inline templates instead of relying on context-hub skills for native frameworks.
**Pre-work:** Pull telemetry on framework usage from the shipped wizard. **If `unreal`, `unity`, `flutter`, `java`, `go` show <0.5% usage, drop them.** Owner + deadline must be assigned in Phase 2a.
**Scope:**
- Port wizard-v2's 11 native templates from `src/templates/{swift, kotlin, java, go, flutter, unity, unreal, android, react-native, python, node, browser}/*.template` — minus whatever telemetry kills.
- Port the detectors shipped wizard / wizard-rewrite are missing from wizard-v2's `src/detectors/{android, kotlin, swift, go, java, flutter, unity, unreal, react-native}.ts`.
**Definition of done:** Detector + installer parity for every framework with non-trivial usage. E2E tests against test apps pass. Native-framework users no longer wait on a context-hub skill load to install.

### Phase 2b — Foundation breadth (4 weeks, 1-2 engineers)
**Goal:** Port the rest of wizard-v2's working pieces onto the new foundation per the §6.5 cherry-pick prescription.
**Scope:**
- Port wizard-v2's `src/agents/tools.ts` (file-reading + grep with sandbox path resolution) — 9 tools across `src/agents/tools/`. Per-role tool-set pattern preserved.
- Port wizard-v2's `src/agents/skills.ts` and `.agents/skills/`; wire to context-hub at runtime.
- Port wizard-v2's `src/agents/{taxonomy, instrumentation, edit-applier, project-survey, diff}.ts`.
- **Port wizard-v2's full multi-account auth stack** (`src/auth/{accounts, oauth-login, token-refresh, types, amplitude-urls}.ts`). Rebase storage to shipped wizard's `~/.amplitude/wizard/` layout; preserve backward-compat read of `~/.ampli.json` and `~/.amplitude-wizard-v2/accounts.json` for one minor release.
- Port wizard-v2's `src/cli/setup-report.ts` (Markdown + JSON sibling writer).
- Port wizard-v2's `src/cli/output.ts` (`resolveChannels`, `emitNdjson`, `NoTtyPromptError`).
- Port wizard-v2's sessions list/show/rm/prune (`src/cli/commands/sessions.ts` + `src/graph/sessions.ts`, sans LangGraph).
- 17-tool MCP surface on the new foundation, generated from the same tool definitions used by the agent loop.
- Lift wizard-rewrite's 11-node install-pipeline file split (sans LangGraph) — each node becomes a plain async function with typed `AwaitUserConfirmation` errors caught by `WizardInstallPresentation`.
- Replace shipped wizard's `src/utils/analytics.ts` self-instrumentation port (already in §6.5 lift list).
**Definition of done:** All wizard-v2 unit tests pass on the new foundation. Multi-account flows (`auth list / use / whoami / token`) work end-to-end. Live LLM evals match or exceed wizard-v2's baseline across taxonomy and instrumentation paths.

### Phase 4 — TUI lift (6-8 weeks, 2 engineers)
**Goal:** Lift the shipped wizard's Ink TUI onto v2 wholesale, plugged in as `InkWizardInstallPresentation`. Visual + UX parity is the *starting point*, not the goal — most files copy verbatim.
**Scope:**
- Lift the entire `src/ui/tui/` tree from shipped wizard to v2: `App.tsx`, `store.ts`, `router.ts`, `flows.ts`, `screen-registry.tsx`, `console-commands.ts`, `start-tui.ts`, `ink-ui.ts`, all 17 screens, all components, all hooks, all primitives, the property-based `flow-invariants.test.ts`.
- Implement `InkWizardInstallPresentation` as the adapter between v2's install pipeline and the lifted TUI's `InkUI` impl of `WizardUI`. Single new file, ~200 LOC.
- **Decouple from `WizardSession` only at the `ink-ui.ts`/`store.ts` boundary.** Carry forward the session-as-source-of-truth invariant; clean up the *shape* of session, not the principle.
- Decompose `AuthScreen.tsx` (965 LOC) and `DataIngestionCheckScreen.tsx` (1,142 LOC): extract IO/business logic into hooks/services; keep screens render-only. Most other screens lift unchanged.
- All 14 slash commands carried forward verbatim. `/help` added (currently undocumented in the registry).
- **Opt-in beta flag:** users can run `AMPLITUDE_WIZARD_NEXT=1 npx amplitude-wizard` to try v2 ahead of cutover. Default stays on shipped wizard until Phase 7.
- **Backwards-compat test suite** (greenfield per §6.5): assert every flag in shipped wizard's `bin.ts` parses identically in v2, every slash command resolves, every env var has the same effect.
**Definition of done:** New TUI passes shipped wizard's flow invariant property tests verbatim. Backwards-compat test suite green. Visual diff shows no regression on golden-path screenshots. Two weeks of internal dogfood passes without showstoppers. Beta flag enabled in production for opt-in users.

### Phase 6 — context-hub contract tightening (2 weeks, 1 engineer)
**Goal:** Skills delivery is versioned, validated, token-budgeted.
**Scope:**
- Pin wizard-core to a specific context-hub release tag (replace `latest` lookup).
- Add frontmatter validator in context-hub CI: enforce `name`, `description`, `version`, `tools-allowed`, `triggers`.
- Add token-budget linter: ≤2,000 tokens per SKILL.md body; references larger but only loaded on demand.
- Add cross-skill invariant test for the autocapture-events list.
- Re-enable `load_skill_menu` / `install_skill` runtime tools.
- Move `skills/wizard/wizard-prompt-supplement` into the wizard repo.
**Definition of done:** context-hub CI fails on missing required frontmatter or oversized skills. Wizard pulls a pinned context-hub version per release.

### Phase 7 — Cutover and packaging (3-4 weeks, 1 engineer)
**Goal:** New foundation becomes `@amplitude/wizard@2.0.0`. Single repo, single LLM client, ESM, modern packaging.
**Scope:**
- Major version bump: `@amplitude/wizard@2.0.0` published from the new repo.
- `@amplitude/wizard@1.x` enters maintenance-only mode (security fixes only, no new features).
- Modern package.json: ESM-only library, CJS bin, `tsup` build, `exports` map, Node 22+.
- `bunx amplitude-wizard@latest` parity with `npx`.
- Changesets for release automation; trusted publishing on CI.
- Single MCP stack (Vercel AI SDK's `experimental_createMCPClient` + the standalone MCP server generated from the same tool defs).
- Final cut of dead deps (`zod-to-json-schema`, `xcode`, `chalk@2.4.2`).
- Documented migration guide for users (mostly a no-op since same package name + flags preserved).
**Definition of done:** v2.0.0 published. Telemetry shows no regression vs. shipped wizard on activation, time-to-first-event, run completion rate. v1.x marked maintenance-only.

### Phase 8 — Drop Ampli legacy and OTel observability (3 weeks, 1 engineer)
**Goal:** Cut compatibility tax + adopt OTel GenAI semantic conventions.
**Scope:**
- Stop reading `~/.ampli.json` and per-project `ampli.json` (`src/utils/ampli-settings.ts` 474 LOC, `src/lib/ampli-config.ts` 371 LOC). One-shot migration on upgrade; old paths read-only for one minor cycle, then deleted.
- Remove `WorkspaceId` migration code in `session-checkpoint.ts`.
- Drop frameworks Phase 3 telemetry killed.
- Adopt OpenTelemetry GenAI semantic conventions for prompt/completion/tool-call spans, content as span events (drop-able at the Collector). Default redacted, opt-in via `OTEL_LOG_USER_PROMPTS=1`.
- Ship as `@amplitude/wizard@2.x` minor.
**Definition of done:** 0 references to `ampli.json` outside one-shot migration code. OTel spans visible in Datadog with content redacted by default. No customer escalation in two weeks post-release.

### Phase 9 — Single-file binary distribution (2 weeks, 1 engineer)
**Goal:** Reduce install funnel friction via a self-contained binary.
**Scope:**
- Evaluate Bun compile vs Node SEA (Feb 2026 improvements) against the wizard's CJS-bin pattern.
- Ship single-file binaries for darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64.
- Distribute via GitHub Releases + Homebrew tap.
- Keep npm install path as the primary distribution.
**Definition of done:** `curl -fsSL https://amplitude.com/install-wizard | sh` works on macOS and Linux. Telemetry shows install funnel drop-off improves.

### Total estimate
~28-36 engineer-weeks across 9 phases for v2 delivery. Phases 1, 2a, 5, 3 are independently shippable user wins delivering value in months 1-3. Phase 4 (TUI rebuild) is the biggest variance driver — budget 8-10 weeks honestly, not 4-6.

---

## 7.5. Future work (post-v2, non-blocking)

These items are recommended but explicitly **out of v2 scope**. Schedule after v2 ships.

### Phase P — Wizard-proxy extraction from the App API (2-3 weeks, 1 engineer + 1 week SRE/platform partner)
**Status:** deferred per team direction. The Phase 1 client-side fix (PR #528) addresses the user-facing 400 today; extraction is a longer-term hardening project, not a v2 blocker.
**Goal:** move the LLM-rewriting logic out of Amplitude's main web app server (the App API) into a focused service. The App API has GUI-scale blast radius; LLM-request rewriting belongs on a service whose failure mode is bounded to wizard users.
**Where it lands when scheduled:** existing AWS or GCP infra (Cloud Run / ECS Fargate / App Runner / equivalent), matching the conventional Amplitude platform pattern. Pick based on what the platform team is already operating; don't introduce a new hosting provider for one service. Hydra introspection + Redis caching carry over verbatim.
**Scope when picked up:**
- Lift `app-api/src/wizard-proxy/{router, vertex, auth, constants, *}.ts` into a focused service.
- Replace the `anthropic-beta` regex pass-through (`router.ts:443-451`) with an explicit Vertex-honored allowlist.
- Add a recursive `tools[].input_schema` sanitizer to `buildVertexBody` (`vertex.ts:260-271`) stripping `$schema`, `additionalProperties`, `exclusiveMinimum`, `exclusiveMaximum`, `$id`, `$ref`.
- Real-Vertex-error passthrough on 400/404/422; keep generic wrappers for 401/403/429/5xx.
- Multi-provider failover (Anthropic direct → AWS Bedrock → GCP Vertex), credentials held only on the proxy service.
- Mirror traffic behind a feature flag, dial up over 1-2 weeks, then delete the route from the App API.
**Why this is genuinely non-blocking:** the in-the-wild `--agent` 400 rate is dominated by users on builds that pre-date PR #528. As that build ages out via npm `latest`, the urgency drops. The extraction's value shifts from "fix users today" to "harden the service boundary" — important, not urgent.

---

## 8. Decisions and Open Questions

Three of the original "open questions" were really decisions deferred. Decisions are pinned here; remaining open questions are below.

### Decisions made in this plan (binding unless reopened by team)
1. **Foundation strategy:** new repo `wizard-core` (or merged into `wizard`), structured per the §6.5 cherry-pick — shipped wizard's TUI/CLI/safety-nets + wizard-v2's harness/auth/templates/evals + wizard-rewrite's `WizardInstallPresentation` only. No LangGraph.
2. **Auth pattern:** `authToken` via `@ai-sdk/anthropic` 3.x.
3. **Model id:** `claude-sonnet-4-6` via `WIZARD_CLAUDE_MODEL`.
4. **Cutover:** same npm name (`@amplitude/wizard`), major version bump `@amplitude/wizard@2.0.0` in Phase 7. CLI flag and slash-command surface preserved verbatim per the §6.5 backwards-compat contract.
5. **TUI:** lift, don't rewrite. The shipped Ink TUI carries forward verbatim behind `InkWizardInstallPresentation`.
6. **Multi-account auth:** lifted from wizard-v2 (`src/auth/{accounts, oauth-login, ...}`). Storage rebased to shipped wizard's `~/.amplitude/wizard/` paths with backward-compat reads of `~/.ampli.json` and `~/.amplitude-wizard-v2/accounts.json` for one minor release.
7. **Native templates:** wizard-v2's inline templates win over shipped wizard's skill-only delegation for native frameworks. Lift all 11 (Swift/Kotlin/Java/Go/Flutter/Unity/Unreal/Android/RN/Python/Node).
8. **Ambient mode:** MCP-server-mode primary, NDJSON fallback. The MCP-server-mode delivery lands as a Context-Forge plugin under `mcp_gateway/plugins/amplitude_wizard/`, not a free-standing service.
9. **Wizard-proxy strategy:** Phase 1 client-side fix (already shipped in PR #528) is the v2 answer. Proxy extraction (Phase P) is **deferred to post-v2** as future work — recommended long-term, not blocking. When scheduled, lands on existing AWS or GCP infra matching Amplitude platform conventions.
10. **Multi-provider routing for the wizard's own model calls:** stays on the App API's `wizard-proxy` for v2. When Phase P is scheduled post-v2, multi-provider failover (Anthropic direct → AWS Bedrock → GCP Vertex) lives at the extracted proxy.
11. **Adopt `amplitude_ai`** from the main monorepo for Python framework/provider/agent detection (delegate to its MCP server) and for LLM-analytics customer paths (route to its instrumentation skill). Don't rebuild detection in TS for Python projects.
12. **Adopt `mcp_gateway`** from the main monorepo for any wizard-side MCP server delivery. Plugins land as Context-Forge plugins; tables `amp_*`, env `AMP_*`. Don't fork.
13. **Align with `amplitude_ai`'s 4-phase Detect → Discover → Instrument → Verify contract** as the canonical wizard workflow vocabulary.
14. **Feature flags:** all wizard-side flags backed by `dynconfv2`. Never reuse a flag key with new types.
15. **`builder-skills`:** out of scope for v2. Different audience (knowledge workers vs. coding agents), different lifecycle. Keep separate from context-hub.

### Remaining open questions
1. **`marketplace-internal` and `mcp-marketplace` access.** Not in the local worktree. context-hub references `mcp-marketplace` as the upstream source for instrumentation skills (`scripts/refresh-instrumentation-skills.sh`). `builder-skills` is now confirmed local and out of v2 scope. **Action:** confirm whether `marketplace-internal` / `mcp-marketplace` are real Amplitude repos and grant access if they are. **Owner needed.**
2. **Native framework cut.** Phase 3 depends on telemetry analysis to drop dead frameworks. **Action:** assign owner + deadline for the framework-usage telemetry pull before Phase 2a kicks off. **Owner needed.**
3. **`amplitude_ai` integration interface.** Wizard delegates Python detection to `amplitude_ai`'s MCP server (`scan_project`). The contract details (which MCP transport, error envelope, version pinning) need to be agreed with the `amplitude_ai` team. **Action:** spike with `amplitude_ai` owner before Phase 2b.
4. **context-hub reorganization downstream consumers.** This plan moves `skills/wizard/wizard-prompt-supplement` into the wizard repo and keeps shared skills in context-hub. The Amplitude MCP server (and possibly other consumers) may expect the wizard skills in context-hub's release. **Action:** check downstream consumers before Phase 6.
5. **Telemetry redaction default.** Plan recommends matching Anthropic Claude Code's default (redacted with `OTEL_LOG_USER_PROMPTS=1` opt-in). **Action:** confirm with security/legal before Phase 8.
6. **Shipped wizard life-support window and ownership.** Phases 2-7 ship to a new repo while users remain on `@amplitude/wizard@1.x` for ~6 months. Plan says "security only," but no owner is named. **Action:** name a maintenance owner before Phase 2a.
7. **Single-file binary platform matrix.** Phase 9 lists five targets. **Action:** confirm Windows is in scope; Bun compile has weaker Windows support than Node SEA today.
8. **MCP Apps (SEP-1865) adoption timing.** Plan flags it as Phase 6+. **Action:** decide whether MCP Apps replaces `confirm_event_plan` in v2 or v3.
9. **Beta flag policy.** Phase 4 introduces `AMPLITUDE_WIZARD_NEXT=1` for opt-in TUI (backed by `dynconfv2`). **Action:** decide rollout cohorts (employees only first? % rollout? Customer council?).
10. **Phase P scheduling.** Deferred out of v2 critical path. **Action:** revisit after Phase 1 telemetry shows sustained low 400 rate; if customer-on-old-build 400s remain meaningful, Phase P moves earlier in the post-v2 queue.
