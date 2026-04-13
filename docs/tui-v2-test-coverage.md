# TUI v2 Test Coverage

> Generated 2026-04-12. Reflects the `kelsonpw/tui-v2-pipeline` branch.

## How to run each test layer

| Layer | Command | Notes |
|-------|---------|-------|
| Unit tests | `pnpm test` | vitest, ~2s |
| Unit (watch) | `pnpm test:watch` | vitest --watch |
| BDD / Cucumber | `pnpm test:bdd` | cucumber-js, features/*.feature |
| E2E | `pnpm test:e2e` | Builds first, runs against test-applications/ |
| Proxy | `pnpm test:proxy` | Validates LLM proxy connectivity |

---

## Current test results

All tests pass.

- **Unit**: 45 test files, **818 passed**, 17 skipped (1 file skipped entirely: `setup-utils.test.ts`)
- **BDD**: 10 feature files, **95 scenarios**, **397 steps** -- all pass

---

## Unit test inventory

### TUI layer (`src/ui/tui/__tests__/`)

| File | Tests | What it covers |
|------|------:|----------------|
| `router.test.ts` | 64 | `WizardRouter` resolution: basic flow advancement, screen visibility (show predicates), overlay stack (push/pop/LIFO), cancel fast-path, direction tracking, all 5 flows (Wizard/McpAdd/McpRemove/SlackSetup/RegionSelect), edge cases (idempotency, error path skipping) |
| `flow-invariants.test.ts` | 24 | Property-based testing with fast-check: random state mutation sequences verify invariants (resolve never throws, always returns valid Screen/Overlay, error phase never resolves to post-run screens, cancel always goes to Outro). Parameterized happy path + complete flow + overlay behavior + error phase exhaustive grid |
| `store.test.ts` | 76 | `WizardStore`: construction, change notification, React `useSyncExternalStore` contract, all session setters, analytics event emission, screen resolution (derived state), overlay navigation, status messages, tasks/syncTodos, concurrent/rapid-fire mutations, full wizard flow simulation, setupComplete promise |
| `console-commands.test.ts` | 5 | `parseFeedbackSlashInput`: extraction, trimming, case-insensitivity, missing/other commands |

**TUI total: 169 tests**

### Core business logic (`src/lib/__tests__/`)

| File | Tests | What it covers |
|------|------:|----------------|
| `agent-interface.test.ts` | 62 | Agent creation, MCP server config, model selection, permissions, hook wiring |
| `detect-amplitude.test.ts` | 37 | Amplitude SDK detection across frameworks and file patterns |
| `wizard-tools.test.ts` | 28 | In-process MCP server tools (check_env_keys, set_env_values, etc.) |
| `ampli-config.test.ts` | 23 | ampli.json reading, writing, validation |
| `package-manager-detection.test.ts` | 20 | npm/yarn/pnpm/bun/pip detection heuristics |
| `wizard-session.test.ts` | 10 | `buildSession`, default values, overrides |
| `helper-functions.test.ts` | 2 | Miscellaneous helpers |

**Lib total: 182 tests**

### Middleware (`src/lib/middleware/__tests__/`)

| File | Tests | What it covers |
|------|------:|----------------|
| `phase-detector.test.ts` | 18 | Run phase detection from agent messages |
| `pipeline.test.ts` | 15 | Benchmark pipeline execution and ordering |
| `config.test.ts` | 14 | Middleware configuration and schema validation |

**Middleware total: 47 tests**

### Health checks (`src/lib/health-checks/__tests__/`)

| File | Tests | What it covers |
|------|------:|----------------|
| `health-checks.test.ts` | 37 | Runtime health check utilities |

### Framework integrations (`src/frameworks/*/__tests__/`)

| File | Tests | What it covers |
|------|------:|----------------|
| `python/utils.test.ts` | 24 | Python framework detection utilities |
| `javascript-web/utils.test.ts` | 15 | JS/Web framework detection |
| `fastapi/utils.test.ts` | 13 | FastAPI detection |
| `nextjs/utils.test.ts` | 10 | Next.js detection |
| `flask/utils.test.ts` | 10 | Flask detection |
| `django/utils.test.ts` | 9 | Django detection |
| `react-router/utils.test.ts` | 4 | React Router detection |

**Frameworks total: 85 tests**

### Steps (`src/steps/*/__tests__/`)

| File | Tests | What it covers |
|------|------:|----------------|
| `claude.test.ts` | 23 | Claude MCP server installation |
| `codex.test.ts` | 9 | Codex MCP server installation |
| `defaults.test.ts` | 9 | MCP default configuration |
| `vercel.test.ts` | 6 | Vercel env var upload |

**Steps total: 47 tests**

### Utilities (`src/utils/__tests__/`)

| File | Tests | What it covers |
|------|------:|----------------|
| `ampli-settings.test.ts` | 26 | ampli settings read/write |
| `package-manager.test.ts` | 25 | Package manager utilities |
| `semver.test.ts` | 21 | Semver parsing and comparison |
| `login-flow.test.ts` | 15 | OAuth login flow |
| `logging.test.ts` | 14 | Debug logging |
| `debug.test.ts` | 13 | Debug utilities |
| `environment.test.ts` | 13 | Environment variable handling |
| `package-json.test.ts` | 12 | package.json read/write |
| `analytics.test.ts` | 10 | Analytics tracking |
| `anthropic-status.test.ts` | 10 | Anthropic status page checks |
| `urls.test.ts` | 8 | URL construction |
| `get-api-key.test.ts` | 7 | API key retrieval |
| `ci-credentials.test.ts` | 5 | CI credential resolution |
| `track-wizard-feedback.test.ts` | 3 | Feedback event tracking |
| `file-utils.test.ts` | 2 | File utilities |
| `setup-utils.test.ts` | 3 (skipped) | Setup utilities (all skipped) |

**Utils total: 187 tests** (3 skipped)

### Top-level (`src/__tests__/`)

| File | Tests | What it covers |
|------|------:|----------------|
| `cli.test.ts` | 43 (14 skipped) | CLI argument parsing, yargs command definitions, mode flags |
| `wizard-abort.test.ts` | 11 | SIGINT/abort handling, graceful shutdown |
| `run.test.ts` | 2 | Main wizard orchestration entry |

**Top-level total: 56 tests** (14 skipped)

---

## BDD feature file coverage

| Feature file | Scenarios | Covers |
|--------------|----------:|--------|
| `01-top-level-commands.feature` | ~12 | login, logout, whoami, feedback top-level commands |
| `02-wizard-flow.feature` | ~10 | Full wizard spine: Intro -> RegionSelect -> Auth -> DataSetup -> Run -> Mcp -> DataIngestionCheck -> Checklist -> Slack -> Outro |
| `03-activation-check.feature` | ~8 | Activation levels (none/partial/full), routing based on event counts |
| `04-susi-flow.feature` | ~8 | OAuth, org/workspace pickers, API key entry, ampli.json writes |
| `05-data-setup-flow.feature` | ~10 | DataIngestionCheck skip/show/advance, Checklist items |
| `07-framework-detection.feature` | ~8 | Auto-detect, generic fallback, --menu picker, setup questions |
| `08-outro.feature` | ~6 | Success/error/cancel outro states, auth failure recovery |
| `09-slash-commands.feature` | ~10 | /login, /logout, /slack, /whoami, /region, /help, /feedback |
| `10-ampli-config.feature` | ~12 | ampli.json read/write/validation, cross-project isolation |
| `11-slack-integration.feature` | ~11 | Slack screen position in flow, skip/complete, EU region handling |

**BDD total: 95 scenarios, 397 steps**

---

## What is NOT tested

### No unit tests exist for:

1. **TUI v2 screens** (`src/ui/tui-v2/screens/`) -- 14 screen components with zero test files. These are the new Ink/React screen implementations (IntroScreen, AuthScreen, RunScreen, OutroScreen, etc.)
2. **TUI v2 components** (`src/ui/tui-v2/components/`) -- AmplitudeLogo, BrailleSpinner, HeaderBar, KeyHintBar, JourneyStepper, ConsoleView
3. **TUI v2 hooks** (`src/ui/tui-v2/hooks/`) -- useScreenInput, useStdoutDimensions, useWizardStore, useAsyncEffect
4. **TUI v2 utilities** (`src/ui/tui-v2/utils/`) -- diagnostics, with-retry, with-timeout, classify-error
5. **TUI v2 store/router/flows** (`src/ui/tui-v2/`) -- store.ts, router.ts, flows.ts (note: the v1 equivalents ARE tested)
6. **AgentUI** (`src/ui/agent-ui.ts`) -- the `--agent` mode JSON-line output handler
7. **Session checkpoint** (`src/lib/session-checkpoint.ts`) -- save/load/clear checkpoint, Zod validation, staleness, directory matching
8. **Token refresh** (`src/utils/` or `src/lib/`) -- silent OAuth token refresh logic
9. **Atomic writes** (`src/utils/atomic-write.ts`) -- temp-file-then-rename write pattern
10. **Agent runner** (`src/lib/agent-runner.ts`) -- the universal agent orchestrator (complex, side-effect heavy)
11. **Agent hooks** (`src/lib/agent-hooks.ts`) -- lifecycle callbacks for the Claude agent

### Not covered in BDD features:

1. **`--agent` flag** -- no scenarios for structured JSON output mode or exit codes
2. **`--yes` flag** -- no scenarios for non-interactive confirmation bypass
3. **Checkpoint resume flow** -- no scenario for "resume previous session" prompt in IntroScreen
4. **`/region` persistence fix** -- no scenario verifying region sticks across session restarts
5. **Token refresh** -- no scenario for silent credential refresh mid-session
6. **Coaching tips in DataIngestionCheck** -- no scenario for rotating tips while polling
7. **Celebration delay with continue prompt** -- no scenario for the post-ingestion animation

---

## Priority test additions

### P0 -- High value, low effort

| What | Why | Effort |
|------|-----|--------|
| `session-checkpoint.test.ts` | Pure functions, no UI. Save/load/clear/stale/dir-mismatch/malformed JSON are all testable in isolation | Small |
| `--agent` and `--yes` CLI flag parsing in `cli.test.ts` | Existing test file already covers flag parsing; just add cases for the new flags | Small |
| BDD scenario for `--agent` mode exit codes | Verifies structured output contract for automation consumers | Small |

### P1 -- High value, medium effort

| What | Why | Effort |
|------|-----|--------|
| TUI v2 `router.test.ts` + `store.test.ts` + `flow-invariants.test.ts` | Mirror the existing v1 tests for v2; same patterns apply. Critical if v2 will replace v1 | Medium |
| `agent-ui.test.ts` | Verify JSON-line output format, exit code mapping, error serialization | Medium |
| BDD scenarios for checkpoint resume | "Resume previous session" / "Start fresh" routing is user-facing and tricky | Medium |
| `classify-error.test.ts` | Error classification drives UX; pure function, easy to test | Small |

### P2 -- Nice to have

| What | Why | Effort |
|------|-----|--------|
| TUI v2 screen rendering tests | Ink test renderer for each screen component; useful but requires fixture setup | Large |
| `with-retry.test.ts` / `with-timeout.test.ts` | Utility functions; valuable for edge cases | Small |
| Token refresh integration test | Requires mocking OAuth endpoints; more of an integration test | Medium |
| `atomic-write.test.ts` | File system edge cases (permissions, concurrent writes) | Small |
