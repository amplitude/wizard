# Haiku-vs-Sonnet quality A/B harness

A small operator tool for measuring whether Haiku 4.5 is "good enough" for the wizard's one-shot LLM call sites moved to the Haiku tier in #590, or whether a specific call site should revert to Sonnet 4.6.

This is **not** part of CI (yet). Run it manually before keeping or reverting a Haiku assignment, and paste the structured report into the PR.

## What this measures

Two call sites were moved to Haiku in [#590](https://github.com/amplitude/wizard/pull/590):

| Call site | File | Surface |
|---|---|---|
| Gateway transport probe | `src/lib/agent/ai-sdk-gateway-probe.ts` | Single-shot connectivity check, max 32 output tokens, no system prompt |
| Console-query (slash-prompt Q&A) | `src/lib/console-query.ts` (Vercel AI SDK path, gated by `AMPLITUDE_WIZARD_AI_SDK_CONSOLE=1`) | Free-form user questions during a wizard session |

The inner agent loop in `runAgent` (`src/lib/agent-interface.ts`) stays on Sonnet — out of scope.

## How it works

1. **`run-quality-ab.mjs`** loads `fixtures/<call-site>.json`, runs every prompt N times against both Haiku and Sonnet via `streamText` + `@ai-sdk/anthropic`, and writes a JSONL results file under `results/<run-id>.jsonl`. Each row captures latency (TTFT, total), token usage, and the full output text. Auth uses `WIZARD_OAUTH_TOKEN` (Amplitude LLM gateway) or `ANTHROPIC_API_KEY` (direct).
2. **`score-quality.mjs`** reads the JSONL, applies deterministic structural scorers (length, required/forbidden keywords, JSON parseability, refusal detection), then for each (prompt, attempt) pair pits Haiku's output against Sonnet's via an LLM judge (Sonnet 4.6 by default, A/B order randomised to defeat positional bias). It writes a JSON report and prints a per-fixture summary.

## How to run it

```bash
# 1. Run the A/B against the console-query fixture (5 attempts/model/prompt).
WIZARD_OAUTH_TOKEN=...  WIZARD_EXPIRES_AT=...  \
  node evals/model-quality/run-quality-ab.mjs --fixture console-query --runs 5

# Prints the path to a results JSONL on stdout. Captured progress is on stderr.

# 2. Score it (Sonnet judge will use the same auth).
WIZARD_OAUTH_TOKEN=...  WIZARD_EXPIRES_AT=...  \
  node evals/model-quality/score-quality.mjs \
    --results evals/model-quality/results/<run-id>.jsonl

# 3. Same flow for the gateway probe (binary fixture, judge skipped automatically
#    when structural pass and only one prompt).
node evals/model-quality/run-quality-ab.mjs --fixture gateway-probe --runs 5
node evals/model-quality/score-quality.mjs --results evals/model-quality/results/<run-id>.jsonl
```

Auth precedence (mirrors the wizard CI path):

1. `WIZARD_OAUTH_TOKEN` (preferred) — routes through the Amplitude LLM gateway. Gateway URL comes from `ANTHROPIC_BASE_URL` -> `WIZARD_LLM_PROXY_URL` -> `https://core.amplitude.com/wizard`.
2. `ANTHROPIC_API_KEY` — direct to Anthropic. Skips the gateway, so this path **cannot** catch gateway-specific regressions. Fine for measuring model quality in isolation.

Useful flags:

* `--runs N` — runs per (model, prompt) pair (default 5).
* `--no-judge` (scorer) — structural-only, no LLM judge call.
* `--judge-model <alias>` (scorer) — override the judge alias (default `claude-sonnet-4-6`).
* `--dry-run` (runner) — load fixture + auth without calling the API. Good for sanity-checking config.

## Decision framework

After scoring, the report's `summary.recommendation` is one of:

* **`keep-haiku`** — every Haiku output passed structural scorers AND the median Haiku judge score is `>= 4`. Keep `'oneshot'` routing the call site to Haiku.
* **`revert-to-sonnet`** — Haiku had at least one structural failure OR median judge score `< 4`. Switch this call site back to `'standard'` (Sonnet) by passing `mode: 'standard'` (or omitting the override) to `selectModel(...)` at the call site.
* **`inconclusive`** — not enough data (e.g. all Haiku rows errored). Re-run with more attempts or investigate the errors before deciding.

Apply the decision per call site, not globally — the gateway probe is a binary connectivity check (Haiku is almost certainly fine), while the console-query slash-prompt path is far more sensitive to regressions in instruction-following and SDK domain knowledge.

## Scoring rubric

Structural (deterministic):

* `minLength` / `maxLength` — output sanity bounds.
* `expectKeywords` — every entry must appear (case-insensitive).
* `expectKeywordsAnyOf` — at least one entry must appear.
* `forbiddenKeywords` — none may appear. Catches refusals like "I cannot help" / "as an AI".
* `expectJson` — output (after stripping a single ```json fence) must `JSON.parse`. With optional `jsonRequiredKeys` for keys that must exist anywhere in the parsed structure.

LLM-judge (Sonnet 4.6, A/B order randomised):

* Rates each output 1-5 on combined accuracy, helpfulness, completeness.
* Picks a winner: A, B, or tie.
* Returns JSON. The scorer parses, normalises, and aggregates per fixture.

## Rubric version pinning

Every fixture pins a `rubricVersion` (currently `2026-05-07.1`). The scorer cross-checks the results-file header against the fixture and refuses to score if they disagree — re-running the harness against the current fixture is required when the rubric changes meaningfully (new structural check, judge reword, threshold change). Bump the version any time scoring would produce different recommendations on the same outputs.

## Fixture authoring

Add a new fixture at `fixtures/<call-site>.json` with the shape:

```json
{
  "callSite": "<id>",
  "description": "what this call site does and why we're measuring it",
  "rubricVersion": "2026-05-07.1",
  "system": "<system prompt or null>",
  "maxOutputTokens": 256,
  "prompts": [
    {
      "id": "<unique-stem>",
      "userMessage": "...",
      "structuralChecks": {
        "minLength": 60,
        "maxLength": 4000,
        "expectKeywords": ["foo"],
        "expectKeywordsAnyOf": ["bar", "baz"],
        "forbiddenKeywords": ["I cannot help"],
        "expectJson": false
      }
    }
  ]
}
```

## Related

* `src/lib/agent/model-config.ts` — `selectModel(...)` and the `'oneshot'` tier added in #590.
* `src/lib/agent/ai-sdk-gateway-probe.ts` — call site #1.
* `src/lib/console-query.ts` — call site #2.
* `evals/README.md` — the larger SDK-integration eval suite. This harness is deliberately lighter weight; it measures one-shot model quality, not full wizard runs.
