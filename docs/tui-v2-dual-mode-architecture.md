# Dual-Mode CLI Architecture: TUI + Agent Mode

Research synthesis from Vercel CLI, GitHub CLI, Stripe CLI, Terraform, and fast-check.
Applied to the Amplitude Wizard to create a robust CLI that works as both a pretty TUI
and a scriptable agent tool.

---

## Architecture Overview

Three execution modes, one business logic layer:

```
bin.ts (yargs)
  │
  ├─ --tui-v2 ──→ InkUI (TUI v2)     → Rich interactive screens
  ├─ --agent ───→ AgentUI (NDJSON)    → Structured JSON streaming
  └─ --ci ──────→ LoggingUI (plain)   → Human-readable non-interactive
```

All three implement the same `WizardUI` interface. Business logic in `run.ts`,
`agent-runner.ts`, and `agent-interface.ts` is unchanged.

## 1. ModeConfig — Resolve Once, Thread Everywhere

```ts
type ExecutionMode = 'interactive' | 'ci' | 'agent';

interface ModeConfig {
  mode: ExecutionMode;
  autoApprove: boolean;  // --yes or CI or agent
  jsonOutput: boolean;   // --json or agent
  quiet: boolean;        // suppress non-essential output
}
```

## 2. AgentUI — NDJSON WizardUI Implementation

Emits one JSON object per line to stdout. Agents/scripts consume via readline + JSON.parse.

```json
{"@timestamp":"...","type":"status","message":"Detecting framework..."}
{"@timestamp":"...","type":"progress","data":{"task":"Install SDK","status":"completed"}}
{"@timestamp":"...","type":"result","data":{"success":true,"events":["Page Viewed","Sign Up"]}}
```

Key behaviors:
- `promptConfirm()` → auto-approve (returns true)
- `promptChoice()` → auto-select first option
- `promptEventPlan()` → auto-approve
- `setRunError()` → emit error event, return false (no retry in agent mode)
- No spinners, no colors, no TUI rendering

## 3. Help System Improvements

- Group commands by intent: "Setup:", "Account:", "Integrations:"
- Add EXAMPLES section with 3 real invocations
- Add ENVIRONMENT section documenting env vars
- Enable yargs `recommendCommands()` for "did you mean?" suggestions
- Add `--yes` as alias for `--ci` (universal convention)

## 4. Testing Strategy

| Layer | Tool | What it catches |
|-------|------|----------------|
| Flow invariants | fast-check model-based | Wrong screen order, unreachable states |
| Router logic | Vitest parameterized | Screen resolution regressions |
| Screen rendering | ink-testing-library | Visual regressions, broken prompts |
| API errors | MSW mock server | Unhandled error states |
| Exit codes | Process spawn tests | CI integration regressions |

## 5. Implementation Files

| File | Purpose |
|------|---------|
| `src/ui/agent-ui.ts` | NDJSON WizardUI for --agent mode |
| `src/lib/mode-config.ts` | Execution mode resolution |
| `src/lib/exit-codes.ts` | Structured exit codes |
| `src/ui/tui/__tests__/router.test.ts` | Router unit tests |
| `src/ui/tui/__tests__/flow-invariants.test.ts` | fast-check property tests |
| `bin.ts` | --agent flag, help improvements, --yes alias |
