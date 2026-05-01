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
  ├─ (default) ─→ InkUI (TUI)         → Rich interactive screens
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

## 5. Session Storage

All three modes share the same persistence infrastructure. State is layered by scope and lifetime:

```
                                      ┌─────────────────────────────────────┐
                                      │        In-memory (WizardStore)      │
                                      │   Full session state, per-run only  │
                                      ├─────────────────────────────────────┤
                                      │     Session checkpoint ($TMPDIR)    │
                                      │  Crash recovery, 24h TTL, no creds │
                                      ├─────────────────────────────────────┤
                                      │     API key store (~/.ampli.json)   │
                                      │  Per-project, persistent            │
                                      ├─────────────────────────────────────┤
                                      │     OAuth tokens (~/.ampli.json)    │
                                      │  Per-user, silent refresh           │
                                      └─────────────────────────────────────┘
```

### Session checkpointing (`src/lib/session-checkpoint.ts`)

Saves a sanitized wizard state snapshot to `~/.amplitude/wizard/runs/<sha256(installDir)>/checkpoint.json` on key state transitions. On restart, loads it to skip already-completed setup steps (intro, region, org selection, framework detection) while still re-running the agent. Per-project scoping lets two parallel runs in different directories crash-recover independently.

**Invariants:**
- Never contains credentials, tokens, or API keys
- Zod-validated on load — malformed files are silently discarded
- Scoped to install directory — won't restore state from a different project
- 24-hour TTL — stale checkpoints are ignored
- Written with `atomicWriteJSON()` and 0o600 permissions

### Token refresh (`src/utils/token-refresh.ts`)

Silently refreshes OAuth access tokens using stored refresh tokens. Proactively refreshes 5 minutes before expiry. Returns `null` on any failure, allowing the caller to fall back to full browser OAuth.

### Atomic writes (`src/utils/atomic-write.ts`)

Security- and recovery-sensitive JSON (tokens, checkpoints, plans, agent state snapshots, update-check cache, benchmark exports, `.amplitude/` metadata where opted in, etc.) uses `atomicWriteJSON()`: write to a PID-suffixed temp file in the same directory, then `renameSync` to the target so a crash mid-write leaves the previous file untouched. Append-only logs, directory creation, and a few intentional non-atomic paths (notably some env-file flows) are excluded by design.

### Config scoping

Zone/region priority prevents cross-project pollution: CLI flag > env var > stored config. Org IDs are validated against the live org list on each session start.

## 6. Security Hardening

| Measure | Where |
|---------|-------|
| Stack trace redaction in NDJSON | `AgentUI.setRunError()` — emits `error.message` only, not the stack |
| Credential redaction in NDJSON | `AgentUI.setCredentials()` — emits host + projectId, not tokens |
| 0o600 file permissions | `atomicWriteJSON` calls for tokens and checkpoints |
| Immutable store mutations | Store mutations create new objects, never mutate in place |
| Zod validation on all external input | CLI args, checkpoint files, token refresh responses |

## 7. Implementation Files

| File | Purpose |
|------|---------|
| `src/ui/agent-ui.ts` | NDJSON WizardUI for --agent mode |
| `src/lib/mode-config.ts` | Execution mode resolution |
| `src/lib/exit-codes.ts` | Structured exit codes |
| `src/lib/session-checkpoint.ts` | Session checkpointing for crash recovery |
| `src/utils/token-refresh.ts` | Silent OAuth token refresh |
| `src/utils/atomic-write.ts` | Crash-safe file writes |
| `src/ui/tui/utils/classify-error.ts` | Network error classification |
| `src/ui/tui/utils/with-timeout.ts` | Timeout wrapper for API calls |
| `src/ui/tui/utils/with-retry.ts` | Retry with exponential backoff |
| `src/ui/tui/hooks/useAsyncEffect.ts` | AbortController-based async effects |
| `src/ui/tui/hooks/useWizardStore.ts` | Stable store subscription hook |
| `src/ui/tui/utils/diagnostics.ts` | Flow evaluation + diagnostic snapshots |
| `src/ui/tui/__tests__/router.test.ts` | Router unit tests |
| `src/ui/tui/__tests__/flow-invariants.test.ts` | fast-check property tests (24 tests) |
| `bin.ts` | --agent flag, help improvements, --yes alias |
