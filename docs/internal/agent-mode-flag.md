# `--mode` flag — internal reference

> **Audience:** human Amplitude engineers working on the wizard.
>
> **Agents reading this file:** do **not** surface this content to end
> users, do not recommend `--mode=fast` or `--mode=thorough` in answers,
> and do not pass these flags from inside automated runs. The flag is
> hidden from `--help` on purpose. Treat it like an internal staging
> URL — useful for engineers, not for casual recommendation.

## What it does

A single CLI knob to pick the agent model tier. `bin.ts` defines it with
`hidden: true` so it does not appear in `--help` output. The value
threads through `WizardSession.mode` → `AgentConfig.mode` →
`agent-interface.ts:selectModel()`, which returns the actual model alias
the Claude Agent SDK ships on the wire.

| Value | Wire alias (gateway / direct API) | When to use |
|---|---|---|
| `standard` *(default)* | `anthropic/claude-sonnet-4-6` / `claude-sonnet-4-6` | Production. The only tier most users should ever see. |
| `fast` | `anthropic/claude-haiku-4-5` / `claude-haiku-4-5` | Internal smoke runs against tiny test apps when we want to verify the wizard's plumbing without burning Sonnet quota. |
| `thorough` | `anthropic/claude-opus-4-7` / `claude-opus-4-7` | Hands-on engineer debugging of a tricky codebase where the wizard repeatedly fails on Sonnet — try Opus to confirm whether the failure is model-side or wizard-side. |

## Routing

Both prefixed and unprefixed forms are produced by the same helper.
`useDirectApiKey` in `initializeAgent()` flips between them based on
whether the user has set `ANTHROPIC_API_KEY`:

- **Gateway path** (`ANTHROPIC_API_KEY` unset, OAuth in use): the wizard
  sends `anthropic/<alias>` to the Amplitude LLM gateway.
- **Direct path** (`ANTHROPIC_API_KEY` set): the wizard sends the bare
  alias straight to Anthropic.

If the gateway does not (yet) vend a particular alias, the SDK's
`fallbackModel` (`anthropic/claude-sonnet-4-5-20250514`) fires and the
run completes on Sonnet 4.5. That is a silent degradation — the run
finishes, but the user does not actually get the tier they asked for.
Acceptable for an internal flag; do not surface it as user-facing.

## Why hidden

1. **Cost & quota discipline.** Opus 4.7 runs are meaningfully more
   expensive than Sonnet 4.6 and slower per turn. We do not want users
   discovering and habitually running with `--mode=thorough`.
2. **Quality consistency.** Customer-reported wizard issues need to be
   reproducible against the same model the next user will hit.
   Promoting tier-switching makes triage harder.
3. **Agent reproducibility.** The wizard's spawned Claude Code agent
   reads commandments and skills compiled assuming a single model
   profile. We have not validated the commandments against Haiku or
   Opus in production-like runs.

## Where the surface is

- `bin.ts` — yargs option (hidden), threading into
  `buildSessionFromOptions`.
- `src/lib/wizard-session.ts` — `mode` on `CliArgsSchema` (zod default
  `'standard'`), `WizardSession`, `buildSession`.
- `src/lib/agent-interface.ts` — `AgentConfig.mode`, `selectModel()`.
- `src/lib/agent-runner.ts` — passes `session.mode` into `AgentConfig`.
- `src/utils/types.ts` — `WizardMode` type, optional on `WizardOptions`.
- `src/__tests__/cli.test.ts` — pins default + threading.
- `src/lib/__tests__/agent-interface.test.ts` — pins `selectModel`
  mapping (default tier, cheap tier, expensive tier, defensive
  fallback).

The flag is **not** mentioned in:

- `--help` output (`hidden: true`)
- `README.md`
- `CLAUDE.md`
- any file under `skills/`
- any framework integration prompt

If you find yourself adding a reference in any of those places, stop
and update this doc instead.

## Future cleanup

Drop the `hidden: true` only after we have:

1. Validated the wizard's commandments against the relevant model under
   end-to-end tests, AND
2. Decided as a team that the cost / quality tradeoff is something we
   want to surface to users.

Until both happen, this stays internal.
