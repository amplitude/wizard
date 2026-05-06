# Wizard evolution plan — iterative work inside `amplitude/wizard`

**Status:** active engineering plan (May 2026)  
**Supersedes (organizationally):** the “ship v2 from a new repo / rename to wizard-core” default called out in `MIGRATION_PLAN.md` §5–7.  
**Retains (technically):** the diagnoses and library recommendations from `MIGRATION_PLAN.md`, `SKILLS_AND_CONTEXT_DESIGN.md`, and audits of `wizard-rewrite` / `wizard-v2` — but treats those repos as **reference implementations**, not the long-lived home of production code.

**Goal:** make `@amplitude/wizard` more **composable**, **performant**, **structured**, and **aligned with modern agent libraries** (Vercel AI SDK, typed tools, MCP) **without** a big-bang migration to another GitHub repository. Major version bumps (`2.x`) remain available for breaking packaging changes (ESM, exports map), not for “we moved the source tree.”

---

## 1. Why stay in this repo

1. **Distribution and trust** — `npx @amplitude/wizard`, docs, skills refresh, CI, and community contributions already anchor here. A second “core” repo duplicates releases, issues, and security review surface unless the old repo is truly retired quickly (which prior plans admitted is hard while 1.x stays on life support).

2. **Risk-managed delivery** — `src/lib/agent-interface.ts` and related files are load-bearing. Replacing them behind a feature flag inside the same package lets us ship fixes to the Anthropic Agent SDK path while the AI SDK path catches up (contrast with freezing `main` on 1.x while racing to completeness elsewhere).

3. **What we still want from the spin-offs** — `wizard-rewrite` and `wizard-v2` already paid for spikes (gateway sanitization, `WizardInstallPresentation`, eval harness shapes, multi-step install decomposition). Those wins should land as **focused PRs** into this tree, not as a mandate to switch remotes for day-to-day work.

---

## 2. What we learned from sibling repos (May 2026 snapshot)

### `amplitude/wizard-rewrite` (`@amplitude/wizard-core` 0.x in its package)

- **Stack:** `ai` ^6, `@ai-sdk/anthropic` ^3, Zod 4, `@modelcontextprotocol/sdk`, Ink 7, `@clack/prompts`, `yargs` 18, `execa`, `pino`, OpenTelemetry exporters, `undici`, `magicast`, `nanostores`.
- **High-value artifacts to port (not the repo wholesale):**
  - **`WizardInstallPresentation`** (`src/cli/wizard-ui/types.ts`) — explicit boundary between orchestration and human/machine UI; optional streaming hooks (`appendAgentText`, `appendToolStart`, `appendToolResult`) already anticipate AI SDK chunk shapes.
  - **`sanitizeWizardRequestInit` / `stripSchemaNoise` / `sanitizingFetch`** (`src/llm/wizard-anthropic-provider.ts`) — recursive strip of `$schema`, `additionalProperties`, `exclusiveMinimum`, `exclusiveMaximum`, plus removal of `anthropic-beta` on gateway paths; aligns with Vertex strictness called out in `MIGRATION_PLAN.md` §2.
  - **Install graph as plain modules** — `src/graph/nodes/*` is a good *file-level* decomposition even if we **do not** adopt LangGraph as the runtime (same conclusion as §5 of the prior plan).
- **Intentionally not required for parity:** carrying the rewrite’s CLI surface, package name, or Node 22 engine floor into this repo unless product asks for it.

### `amplitude/wizard-v2` (also published as `@amplitude/wizard-core` historically)

- **Stack:** `ai` ^6, `@ai-sdk/anthropic` ^3, Zod 4, MCP SDK, **`@langchain/langgraph`** (graph orchestration), `pino`, `execa`, `yargs` 18.
- **Take:** reuse **detectors**, **template** layout ideas, **eval runner** patterns, and **LLM client** lessons. Treat LangGraph as **optional** — any graph-like flow in this repo should be implementable with AI SDK `ToolLoopAgent` / `prepareStep` + explicit pause/resume (per `MIGRATION_PLAN.md` §5).

### This repo (`amplitude/wizard` today)

- **Strengths:** Ink TUI, yargs CLI contract, nested-agent sanitization, session/checkpointing, observability, BDD + Vitest depth, context-hub skills pipeline.
- **Pain:** monolithic agent harness (`agent-interface.ts`, `wizard-tools.ts`, `agent-runner.ts`), duplicated MCP stacks, large per-turn prompts (`SKILLS_AND_CONTEXT_DESIGN.md`), CJS-first packaging vs. ESM-first libraries.

---

## 3. Design principles for in-tree evolution

| Principle | What it means here |
|-----------|---------------------|
| **Composable seams** | Introduce small interfaces (`InstallPresentation`, `LlmTransport`, `ToolPolicy`) implemented by existing code first, then swap internals. |
| **Performance** | Prompt caching (AI SDK cache control), three-tier skills (menu → body → references), parallel detection where safe, avoid double-retries with SDK defaults. |
| **Structured modules** | New code lives under `src/lib/agent/` with one concern per file; legacy files shrink by extraction, not copy-paste into a new repo. |
| **Library strategy** | **Vercel AI SDK** (`ai`, `@ai-sdk/anthropic`) is the **target** inner loop for new work; Anthropic Agent SDK remains until parity tests pass. MCP stays on `@modelcontextprotocol/sdk` with one consolidation story. |
| **Compatibility** | CLI flags, NDJSON schema, storage paths, and exit codes stay stable across minor versions; breaking changes ride `2.0.0` with an explicit checklist (reuse “v2 Backwards-Compat Contract” from `MIGRATION_PLAN.md` §6.6 as a test suite target). |

---

## 4. Phased roadmap (all work lands in `amplitude/wizard`)

Estimates are order-of-magnitude; parallelize where dependencies allow.

### Phase A — Reliability & gateway correctness (1–2 weeks)

**Already largely in flight on `main`:** gateway `betas` gated (`AMPLITUDE_WIZARD_GATEWAY_BETAS`), `thinking` disabled where it caused 400s, model aliases pinned to Sonnet 4.6 family.

**Remaining A-work in this repo:**

- Wire **automated tests** that assert outbound gateway JSON never contains forbidden schema keys when tools are present (mirror rewrite’s pure `sanitizeWizardRequestInit` tests, adapted to whatever fetch surface the Agent SDK exposes).
- Tighten user-visible remediation when the proxy returns the generic 400 wrapper (`MIGRATION_PLAN.md` §2).

### Phase B — Presentation + orchestration decoupling (2–4 weeks)

- **Done (scaffold):** `src/ui/install-presentation/` defines `WizardInstallPresentation` + `InstallSpinnerPresenter` (`install-presentation-types.ts`), a **`WizardUI` bridge** (`createWizardUiInstallPresentation`), and a **noop** harness (`createNoopWizardInstallPresentation`). Exported from `src/ui/index.ts`. Interactive prompts **throw** on the bridge (Ink still owns full-screen flows); optional streaming hooks mirror wizard-rewrite.
- **Next:** Route **non-agent** or **thin** install steps through the adapter (welcome / confirm / spinner), then align `--agent` NDJSON with the same orchestration for human-visible events.
- **Outcome:** Ink TUI and `--agent` NDJSON share one orchestration path for human-visible events.

### Phase C — Skills & context economics (2–6 weeks, can overlap B)

Follow `SKILLS_AND_CONTEXT_DESIGN.md`:

1. **Tier 1** — inject `skill-menu.json` (narrowed post-detection) into the system prefix; cap token budget.
2. **Tier 2** — single `load_skill` tool returning markdown bodies **without** copying full trees to `.claude/skills/` unless we must for host compatibility.
3. **Tier 3** — `load_skill_reference` or lazy `Read` of packaged references; dedupe oversized reference blobs like `browser-sdk-2.md` in context-hub over time.
4. **Pinning** — CI and release branches should consume a **specific context-hub release tag**, not only `releases/latest`. `scripts/refresh-skills.sh` supports `CONTEXT_HUB_TAG` for that purpose.

### Phase D — Agent harness strangling + AI SDK path (6–12 weeks)

**Objective:** shrink `agent-interface.ts` by moving coherent blocks to `src/lib/agent/*` and add **`AMPLITUDE_WIZARD_AI_SDK=1`** (name TBD) experimental path:

| Extract | Target module(s) |
|---------|-------------------|
| Model alias / fallback / env | `agent/model-config.ts` |
| Bash + path policy | `agent/tool-policy.ts` |
| Stream pill / lifecycle | `agent/stream-presenter.ts` |
| Gateway sanitizing fetch | `agent/gateway-sanitize.ts` (port tests from rewrite) |
| `runAgent` loop | `agent/run-agent.ts` thin orchestrator |

**AI SDK slice order:** `read_file` / grep-equivalent tools → full wizard tool surface → MCP bridge → default-on after parity harness (Vitest + live gateway smoke + eval fixtures).

### Phase E — `wizard-tools` decomposition (4–8 weeks)

- Split `wizard-tools.ts` into `src/lib/wizard-tools/*.ts` (one tool per module + shared schemas).
- Generate or mirror MCP tool definitions from the same Zod sources to avoid two-stack drift.

### Phase F — Packaging 2.0 (when D+E are green)

- ESM `exports` map, drop dead deps (`chalk@2` where safe, unused `zod-to-json-schema` imports), consider Node LTS floor — ship as `@amplitude/wizard@2.0.0` **from this repository**.

---

## 5. Library guidance (target end state)

| Concern | Preferred | Interim |
|---------|-----------|---------|
| LLM calls / streaming | `ai` + `@ai-sdk/anthropic` | Anthropic Agent SDK `query` |
| Schemas | Zod 4 | Zod 4 (already) |
| MCP | `@modelcontextprotocol/sdk` | Consolidate duplicate stacks |
| CLI parsing | yargs (keep flags stable) | — |
| TUI | Ink + `@inkjs/ui` | — |
| Logging / OTEL | Align with rewrite’s `pino` + OTLP optional hooks when we split processes | Current structured logger + Sentry |

---

## 6. Relationship to upstream services

Keep `MIGRATION_PLAN.md` §6.6 **as written**: wizard stays TS-first and team-owned; no hard dependency on Amplitude monolith Python services. Optional **wizard-proxy** hardening remains a **server** initiative; client-side sanitization is still defense in depth.

---

## 7. How we know we are done (per phase)

- **A:** `--agent` nested in host agents succeeds on gateway; 400 rate near zero; tests cover sanitized bodies.
- **B:** One orchestration path drives both TUI and machine JSON for a subset of screens; no duplicate prompt strings.
- **C:** Measured ≥35% drop in median system prompt tokens for representative integrations; skills pin reproducible in CI (`CONTEXT_HUB_TAG`).
- **D:** AI SDK path runs full setup on sample apps with the same CLI; Agent SDK path remains available behind a flag until confidence interval met.
- **E:** No single file >2k LOC in the hot path without an approved exception list.
- **F:** Release-please ships `2.0.0` with backwards-compat test suite from prior plan.

---

## 8. Immediate next commits (execution backlog)

1. ✅ **Document** this plan (`NEW_MIGRATION_PLAN.md`) and link it from `CLAUDE.md` / `README.md` only if the team wants public visibility (optional follow-up).
2. ✅ **Pin context-hub in CI** via `CONTEXT_HUB_TAG` support in `scripts/refresh-skills.sh`.
3. **Port pure `sanitizeWizardRequestInit` + tests** into `src/lib/gateway-request-sanitize.ts` (done) and **wire into the Claude Code subprocess** via `NODE_OPTIONS=--require …register-gateway-fetch-sanitize-bootstrap.js` (`gateway-fetch-sanitize-node-options.ts`, `agent-interface.ts`). Opt out with `AMPLITUDE_WIZARD_GATEWAY_SANITIZE_FETCH=0`. Skipped for direct `ANTHROPIC_API_KEY` and local-CLI paths.
4. **Scaffold `src/lib/agent/`** with `model-config` extraction (no behavior change).
5. **Prototype `load_skill`** per `SKILLS_AND_CONTEXT_DESIGN.md` §2 behind `AMPLITUDE_WIZARD_SKILL_TIERS=1`.
6. ✅ **`WizardInstallPresentation` seam** — `src/ui/install-presentation/` + `createWizardUiInstallPresentation` / `createNoopWizardInstallPresentation` (Phase B scaffold).

---

## 9. References

- Prior org-wide migration write-up: `MIGRATION_PLAN.md`
- Token / skills architecture: `SKILLS_AND_CONTEXT_DESIGN.md`
- Reference repos: [amplitude/wizard-rewrite](https://github.com/amplitude/wizard-rewrite), [amplitude/wizard-v2](https://github.com/amplitude/wizard-v2)
