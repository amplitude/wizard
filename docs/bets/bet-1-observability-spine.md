## Bet 1 — Unified Observability Spine

**Branch:** `kelsonpw/obs-spine`
**Depends on:** nothing. Ship first.
**Effort:** ~1 sprint.

### Goal

Make `run_id` the universal primary key across CLI ↔ proxy ↔ model ↔ MCP ↔ Amplitude API. Collapse split outcome schemas into one. Make cost/token data always-on. Persist identifiers across runs so experiments stick. Add an opt-in session-trace artifact users upload on failure.

### Why this is first

Every other bet needs `run_id` propagation and always-on cost data. You can't prove Bet 2's cache wins, call experiment winners from Bet 3, or measure any change against the North Star without this layer.

### Deliverables

#### Trace propagation
- [ ] Stamp W3C `traceparent` + `X-Wizard-Run-Id` / `X-Wizard-Session-Id` / `X-Wizard-Version` / `X-Wizard-Mode` / `X-Wizard-Integration` on every outbound call.
- [ ] Extend `buildAgentEnv` in `src/lib/agent-interface.ts` to inject headers into the Claude agent subprocess.
- [ ] Audit every `fetch` in `src/lib/api.ts`, `src/lib/mcp-with-fallback.ts`, `src/utils/` — add headers.

#### Always-on cost/token telemetry
- [ ] Move `CostTrackerPlugin` and `TokenTrackerPlugin` out from behind `session.benchmark` at `src/lib/agent-runner.ts:298`. Run unconditionally; keep only the JSON write opt-in.
- [ ] Emit `wizard cli: agent completed` with full breakdown: `input tokens`, `output tokens`, `cache read input tokens`, `cache creation 5m tokens`, `cache creation 1h tokens`, `total cost usd`, `cache hit rate`, `model`, `fallback used`, `turns`.

#### Canonical funnel schema
- [ ] New event: `wizard cli: run started` with `mode`, `wizard version`, `node version`, `os`, `is first run`, `days since last run`, `prior runs count`, `prior outcome`, `cli flags`.
- [ ] New event: `wizard cli: step completed` with `step`, `outcome` (`completed|skipped|failed|cancelled`), `duration ms`, `attempt`. Fire from `WizardStore` on screen unmount.
- [ ] New event: `wizard cli: run ended` with `outcome` (`activated|configured|error|cancelled`), `exit code`, `failure category`, `failure subcategory`, `mcp outcome`, `slack outcome`, `activated` (bool from `dataIngestionConfirmed && dashboardUrl`), `time to first event ms`, `time to activation ms`.
- [ ] Deprecate `session ended` in the same release; keep for 30 days then remove.

#### Taxonomy cleanup
- [ ] Fix Title-Case violations: rename events emitted from `src/ui/tui/store.ts:567,578`, `src/ui/tui/screens/CreateProjectScreen.tsx:155,225,232`, `src/lib/api.ts:346` to `lowercase with spaces` per CLAUDE.md convention.
- [ ] Replace `wizard remark` as a long-string property value (cardinality bomb). Store the reflection as an event-level text field, capped at 4KB. Full blob goes into the session-trace upload.
- [ ] Collapse framework-version-as-property-key (`nextjs-version`, `django-version`) at `src/lib/agent-runner.ts:154` into one `framework version` column.

#### Stable identifiers
- [ ] Persist `anonymousId` to `~/.ampli.json` (currently `uuidv4()` in the `Analytics` constructor regenerates per run, breaking experiment stickiness).
- [ ] Persist `flagAssignments` in the session checkpoint (`src/lib/session-checkpoint.ts`) so a crash/resume inside the same run doesn't re-bucket.
- [ ] `setOnce('first wizard run at', timestamp)` in `identifyUser` on first-ever run.

#### Tool-call telemetry
- [ ] Wire the `Stop` hook in `src/lib/agent-hooks.ts` to emit aggregated `wizard cli: tool summary` with `tool calls total`, `failures total`, `top tools` (top-5 name+count), `compactions`, `permission requests`, `subagent spawns`. Don't emit per-call — summarize.

#### Session-trace uploader
- [ ] On `run ended {outcome: 'error'}`, offer "press U to upload diagnostic trace".
- [ ] Uploads compressed JSONL tail from `/tmp/amplitude-wizard.log` + output of `createDiagnosticSnapshot()` + last 50 Sentry breadcrumbs to a GCS bucket keyed by `run_id`.
- [ ] Surface the upload URL in `/feedback` and in the error outro.
- [ ] Respect `DO_NOT_TRACK`; never upload without explicit user keypress.

#### Experiment registry
- [ ] New file `src/lib/experiments.ts`: typed variant payloads per flag. Shape: `{ key, description, defaultVariant, variants: { ... }, scope: 'per-run' | 'per-user' | 'per-org' }`.
- [ ] `useExperiment(key)` helper memoizing `wizardCapture('experiment exposed', { flag, variant, 'run id' })` exactly once per run per key.

### Verification

- New Amplitude funnel chart: `wizard cli: run started` → per-step funnel → `wizard cli: run ended {activated: true}`. Segment by framework × first-vs-returning × region.
- Baseline 10 real framework fixtures via `pnpm try --benchmark`; capture cost / cache hit rate / duration / activated per fixture. Store in `tests/evals/baselines/` (feeds Bets 2 + 3).
- Two consecutive `pnpm try` runs produce the same `anonymousId`.
- Amplitude Experiment dashboard shows non-zero `wizard cli: experiment exposed` within 24h of any test rollout.
- New unit tests covering funnel event emission on happy path + each failure path.

### Out of scope

- Per-tool-call events (too high volume; `tool summary` aggregates instead).
- Auto-upload on error (always gate behind explicit keypress).
- Retiring Sentry (complementary to trace propagation, not replaced by it).
