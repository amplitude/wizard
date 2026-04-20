# Wizard vision & bets

## TL;DR

`npx @amplitude/wizard` takes a developer from zero to their first Amplitude chart in one command. It authenticates, detects the framework, runs a Claude agent to instrument the SDK and events, and walks the user through a dashboard.

The CLI is well-architected but its guts — the AI agent loop, the telemetry spine, and the LLM proxy — are undertuned relative to what they could be. This directory lays out the program that fixes that. It's five **bets** (see below for what "bet" means here) sequenced so every one compounds on the previous.

## What a "bet" is

Not "a feature." A **commitment of resources to a testable hypothesis, with a quantitative threshold that triggers a revert if the hypothesis fails.**

Example: Bet 2's prompt-caching change assumes a ≥50% cache-hit rate on run 2+. If it doesn't clear 40% after two weeks of bake, it gets flag-gated and rolled back. Every bet has a kill criterion like that, stated explicitly in its brief.

Bets are sequenced (not parallel) because early bets build the measurement surface later bets need to prove themselves. Shipping Bet 2 without Bet 1's telemetry spine would be flying blind on whether the 50–80% cost reduction actually materialized.

## Why these five bets

Ten independent expert reviews of the codebase converged on three gaps:

1. **The AI agent loop is opaque.** No prompt caching (50–80% of input tokens wasted). Status scraped from plaintext markers the model emits. No eval harness — prompt changes ship untested.
2. **Nothing correlates across the wire.** No trace headers between CLI → proxy → LLM → MCP. Cost/token data hidden behind a dev-only `--benchmark` flag. Device ID regenerates per run, silently breaking experiment assignment.
3. **The LLM proxy is a single-provider shim.** Hardcoded model. No failover. No budget protocol. No way to ship a model-routing change without a wizard release.

Every expert's "bold bet" traced back to one of these three. The five bets in this directory are the coherent story that closes each gap and composes the results.

## The five bets

| # | Bet | Fixes which gap | Depends on | Kill criterion |
|---|-----|-----------------|------------|----------------|
| [1](./bet-1-observability-spine.md) | **Observability spine** — run_id as the universal primary key, always-on cost/tokens, canonical funnel events, persistent anonymousId, session-trace artifact | #2 | — | (unblocks every later measurement) |
| [2](./bet-2-agent-loop.md) | **Agent loop overhaul** — prompt caching, three-phase Planner → Integrator → Instrumenter pipeline, structured status, real hooks, eval harness | #1 | Bet 1 | cache hit rate <40% after 2 weeks → revert |
| [3](./bet-3-ai-gateway.md) | **AI Gateway** — multi-provider failover, edge prompt cache, flag-driven model routing, per-org budget protocol, shadow-replay evals | #3 | Bet 1 | failover adds >100ms p95 → route only failover paths through the new router |
| [4](./bet-4-mcp-first.md) | **MCP-first repositioning** — ship as "Amplitude for Claude Code / Cursor," harden `mcp serve`, wire the 13 context-hub skills | distribution | Bets 2 + 3 | MCP signups <10% after 2 quarters → MCP becomes a side channel, CLI stays primary |
| [5](./bet-5-recovery-ux.md) | **Recovery & delight** — error outro as launchpad, persistent launch-pad TUI, `/help` overlay, kill auth for returning users, PLG teammate-invite loop | UX | — (parallel) | teammate-invite k <0.05 after 30 days → drop the prompt |

## Sequence

```
Bet 1 (obs spine)  ──┬──→  Bet 2 (agent loop)  ──┬──→  Bet 4 (MCP-first)  ──→  ...
                     │                            │
                     └──→  Bet 3 (gateway)  ──────┘
                                                        Bet 5 (UX) runs in parallel throughout.
                                                        Hardening runs in parallel throughout.
```

Bets 1 and 5 and hardening started immediately. Bets 2 and 3 are unblocked when Bet 1 lands; they overlap. Bet 4 waits for 2 + 3 because MCP clients need Bet 2's structured agent surface and the gateway (Bet 3) doesn't want to lock to one LLM before then.

## North Star

**Time-to-first-event-in-chart**, segmented by framework × first-vs-returning × region. Published weekly. Every bet rolls out behind a flag; 14-day bake; gate promotion against lift.

## What's deliberately NOT in scope

- A TUI rewrite on `@clack/prompts`. The Ink stack cost is known; the return isn't there until Bet 4 clarifies whether the TUI is still primary.
- A hosted "paste-URL-get-PR" orchestrator. If Bet 4 works, that becomes a natural consequence. Don't build it first.
- Per-framework first-class configs for Unreal / Unity / Go / Java — cut in Bet 4.
- New slash commands beyond `/help` until existing ones match the README.

## Where to go next

- **Reading order for new engineers:** start with [`vision.md`](./vision.md) (longer narrative, same material as above plus the full strategic framing), then the specific bet brief(s) relevant to your work.
- **Live PR rollup:** [tracking issue #143](https://github.com/amplitude/wizard/issues/143). Auto-checks off as PRs merge. Every PR is stacked on its predecessor; oldest-first merge order.
- **Updating:** when a bet changes materially (new deliverable, scope cut, kill criterion tripped), edit the relevant brief file in this directory and link the PR from the tracking issue. The briefs are the source of truth; don't let them drift from reality.
