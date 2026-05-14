/**
 * Agent-mode NDJSON event schema.
 *
 * The wizard's `--agent` mode emits one JSON line per significant moment to
 * stdout. Outer agents (Claude Code, Cursor, Codex, custom orchestrators)
 * parse these to drive their own UX — display login URLs, inspect plans,
 * decide whether to retry, surface choices to the human.
 *
 * This module is the source of truth for that wire format. Every event is a
 * member of `AgentEvent` and shares the `AgentEventEnvelope` shape:
 *
 *   { v, '@timestamp', type, message, session_id, run_id, data, level? }
 *
 * Schema rules:
 *   - `v` is the wire-format version. Bump on any breaking shape change.
 *   - Discriminator is `data.event` for `lifecycle` / `prompt` / `result` / `error` events.
 *   - Never include access tokens, API keys, refresh tokens, or full URLs
 *     containing query-string secrets in any payload.
 *   - Resume hints (`resumeFlags`, `resumeCommand`) are arrays of CLI argv,
 *     not shell strings, so outer agents can spawn directly.
 *
 * The `AgentUI` class (`src/ui/agent-ui.ts`) is the only writer of these
 * events. New events MUST land here first so the schema doc and the emitter
 * stay in sync.
 */

/**
 * Envelope (top-level) wire-format version. Bump on any breaking change
 * to the FRAME shape — i.e. the keys directly on the JSON line itself
 * (`v`, `@timestamp`, `type`, `message`, `session_id`, `run_id`,
 * `level`, `data`, `data_version`).
 *
 * Per-event `data` shapes get their own version on the envelope via
 * `data_version` (see below). Bumping `v` is for the framing layer
 * only.
 */
export const AGENT_EVENT_WIRE_VERSION = 1 as const;

/**
 * Orchestrator-facing protocol version. Distinct from
 * `AGENT_EVENT_WIRE_VERSION` (which gates the envelope FRAME shape)
 * and from `EVENT_DATA_VERSIONS` (which gates per-event `data`
 * shapes): `WIZARD_PROTOCOL_VERSION` is the SEMVER-flavoured number
 * an orchestrator branches on to decide "do I speak this wizard's
 * dialect at all?".
 *
 * Bump only on a contract change that breaks orchestrators who were
 * happy with the previous value — adding a new event-key to the
 * registry is non-breaking (orchestrators see it absent from their
 * known set and ignore the envelope), while removing or renaming an
 * existing event-key, or changing the meaning of `mode`, is.
 *
 * Currently `2` because this is the first version that ships the
 * v2 event family (run_phase, decision_id, retry events,
 * cold_start_breakdown, tool_call_summary, mcp_status, and the
 * capability announcement itself). Wizard binaries earlier than this
 * branch implicitly emit a v1 stream (which would not carry a
 * `wizard_capabilities` envelope at all — capability absence IS the
 * v1 signal).
 */
export const WIZARD_PROTOCOL_VERSION = 2 as const;

/**
 * Per-event-type data-shape version. The key insight from orchestrator
 * feedback: pinning to envelope `v: 1` doesn't protect orchestrators
 * from breaking changes inside `data`. Adding/renaming a field on
 * (say) `event_plan_proposed` keeps envelope v=1 stable but silently
 * shifts the contract for that one event.
 *
 * Solution: every event whose `data` shape is part of the public API
 * carries a `data_version` integer on the envelope. Orchestrators
 * should branch on `(type, data?.event, data_version)` rather than
 * envelope `v` alone. The default for events without a registered
 * version is 1 — adding `data_version` to an event for the first time
 * is itself the v=1 baseline. Bump to 2 on the first breaking change.
 *
 * Why a flat number per event-type+discriminator instead of one global
 * counter: a global counter forces every orchestrator to upgrade in
 * lockstep when any event changes. Per-event versions let one event's
 * shape evolve without invalidating an orchestrator that only cares
 * about (e.g.) `tool_call` and `dashboard_created`.
 *
 * Registry: see `EVENT_DATA_VERSIONS` below — single source of truth.
 * To bump a version, update that map AND add a regression test pinning
 * the new shape.
 */
export const EVENT_DATA_VERSIONS = {
  // Lifecycle
  start_run: 1,
  /**
   * Terminal lifecycle event — emitted exactly once per run, immediately
   * before the process exits via `wizardSuccessExit` / `wizardAbort`.
   * Carries the structured outcome (`success` / `error` / `cancelled`),
   * the exit code the process is about to return, and the run duration.
   * Orchestrators should treat absence of `run_completed` as
   * "wizard crashed mid-stream" — distinct from a clean failure exit.
   */
  run_completed: 1,
  intro: 1,
  outro: 1,
  cancel: 1,
  /**
   * v2 — added `midRun`, `preserveFiles`, `partialProgress`,
   * `authSubkind`, plus the `amplitude_token_expired` /
   * `gateway_token_expired` reason discriminators. Lets agent-mode
   * orchestrators distinguish a pre-run credential-resolution failure
   * (where no work has been done) from a mid-run 401 that leaves
   * partial progress on disk. v1 callers continue to work — every new
   * field is optional.
   */
  auth_required: 2,
  /**
   * `auth_retry_exhausted` — emitted by the SDK retry-loop boundary
   * (`agent-interface.ts`) once the wizard has observed
   * AUTH_RETRY_LIMIT consecutive auth-flavoured api_retry messages.
   * Fires BEFORE the controller.abort('auth_failed') and the
   * subsequent AUTH_ERROR routing, so orchestrators can observe the
   * exhaustion event in the stream (rather than just inferring it
   * from a 401-flavoured `auth_required`). Carries the attempt count
   * and the auth subkind (`amplitude` / `llm-gateway`).
   */
  auth_retry_exhausted: 1,
  /**
   * `run_error` — anonymous-until-now `error` envelope from
   * `AgentUI.setRunError`. Previously the `data` payload carried
   * `{ name, recoverable, suggestedAction }` with NO `event`
   * discriminator, breaking the convention used by every other
   * lifecycle / progress / result event. Orchestrators relying on
   * `data.event` to branch saw nothing for run-aborting errors and
   * had to special-case `type === 'error'` alone — making the wire
   * harder to filter.
   *
   * Bumping to v1 = the first registered version (the schema didn't
   * carry data_version before — orchestrators treat absence as 1 by
   * convention). Future bumps land here.
   */
  run_error: 1,
  /**
   * `run_phase` — coarse-grained progress signal emitted at the four
   * canonical phase boundaries of an agent run (`cold_start` →
   * `agent_running` → `finalizing` → `completed` | `error`). Lets a
   * parent agent render a faithful progress indicator without
   * parsing every tool_call / status / progress event in the stream.
   * Distinct from `pushStatus` (free-form sub-line for the TUI) and
   * `journey transitions` (fine-grained four-step journey stepper)
   * — `run_phase` is the orchestrator-facing five-state contract.
   */
  run_phase: 1,
  nested_agent: 1,
  inner_agent_started: 1,
  // Project create. Discriminators must match the actual `data.event`
  // strings emitted by AgentUI — bugbot caught a previous mismatch
  // (`project_created` vs the emitted `project_create_success`) that
  // silently dropped the data_version stamp from those events.
  project_create_start: 1,
  project_create_success: 1,
  project_create_error: 1,
  // Tool / file changes
  tool_call: 1,
  file_change_planned: 1,
  file_change_applied: 1,
  file_changed: 1,
  // Event plan
  event_plan_proposed: 1,
  event_plan_confirmed: 1,
  event_plan: 1,
  event_plan_set: 1,
  // Verification
  verification_started: 1,
  verification_result: 1,
  // Other results
  events_detected: 1,
  dashboard_created: 1,
  /**
   * `setup_context` — emitted by `plan` (in the JSON envelope) and at
   * `apply_started`, before any work happens. Carries the resolved
   * Amplitude scope (region, org, project, app, env) so the outer
   * agent can SHOW the user exactly what's about to be modified before
   * asking them to approve. Without this, an outer agent has no
   * authoritative handle on which Amplitude app the wizard will write
   * to and may render data from a stale project for follow-up queries.
   *
   * Each scope field carries a `source` discriminator (`auto` /
   * `flag` / `saved` / `recommended`) so the orchestrator can decide
   * whether a re-confirm is warranted (e.g. `auto` from a single-match
   * still benefits from a "look right?" prompt).
   */
  setup_context: 1,
  /**
   * `setup_complete` — terminal artifact event emitted exactly once
   * per successful `apply` run, immediately before `run_completed`.
   * Single source of truth for the artifacts the outer agent needs
   * for follow-up work: which app to query, which files were
   * written, which env vars were set, which dashboard URL to render.
   *
   * Skill rule: after this event fires, the outer agent MUST replace
   * any cached Amplitude project context with `amplitude.appId` —
   * otherwise follow-up MCP queries (charts, dashboards, events) hit
   * the wrong project.
   */
  setup_complete: 1,
  /**
   * `agent_metrics` — emitted once per agent run at finalize time
   * with aggregated token usage, tool call counts, and run duration.
   * Lets orchestrators bill / cap / monitor cost without re-parsing
   * the full event stream. Token counts come straight from the
   * Claude Agent SDK's terminal `result` message.
   */
  agent_metrics: 1,
  /**
   * `needs_input` — structured prompt asking the orchestrator (or
   * human) for one of N choices. Carries the question, choices,
   * recommended pick, manual-entry hint, and pagination. The most
   * orchestrator-facing event in the wire — without this `data_version`
   * stamp consumers couldn't safely evolve schema for it.
   *
   * v2 — added `decisionId` (e.g. `dec_001`), a stable, monotonically
   * numbered correlation id that lets orchestrators pair a request
   * with its `decision_auto` resolution. Previously orchestrators had
   * to reconstruct the pairing by timing + `code` heuristics, which
   * fails the moment two prompts share a code (e.g. two `confirm`
   * dialogs back-to-back). Field is optional at the consumer end —
   * v1 readers that don't know about `decisionId` continue to work
   * because they were already keying off `code` alone; consumers
   * that want strict correlation branch on `data_version >= 2`.
   */
  needs_input: 2,
  /**
   * `decision_auto` — emitted alongside a `needs_input` whenever the
   * wizard auto-resolves the prompt (under `--auto-approve` /
   * `--yes` / `--ci` / `--force`, OR the `--agent`-implies-autoApprove
   * back-compat path). Lets orchestrators distinguish "you should
   * surface this question to a human" from "FYI, I auto-picked the
   * recommended value." Without it, a strict orchestrator subscribing
   * to `needs_input` would race the wizard's auto-resolve.
   *
   * Fires AFTER the corresponding `needs_input` so a single-event
   * subscriber that sees `needs_input` first is guaranteed to see the
   * auto-resolution next on the same stream.
   *
   * v2 — added `decisionId` mirroring the value from the preceding
   * `needs_input`. Pair `decision_auto.decisionId` with
   * `needs_input.decisionId` for exact correlation; this replaces
   * the brittle "match on `code` + emission order" heuristic that
   * broke when two prompts shared a code. Field is optional at the
   * consumer end for v1-compat.
   */
  decision_auto: 2,
  /**
   * `heartbeat` — periodic liveness signal emitted every ~10s while
   * the inner agent is running. Carries elapsed wall-clock time, the
   * current retry attempt count, and the rolling tail of pushStatus
   * messages so an orchestrator can render a "still working…" widget
   * without going dark when a long tool call (Bash, MCP, file edit
   * chain) eats 30+ seconds of silence. Always fires on the cadence,
   * regardless of whether the agent has been chatty — absence of
   * heartbeat events is the canonical signal that the wizard is
   * stalled.
   */
  heartbeat: 1,
  /**
   * `checkpoint_saved` — emitted whenever the wizard writes a session
   * snapshot to `~/.amplitude/wizard/runs/<sha>/checkpoint.json`.
   * Lets orchestrators know there's a recoverable state on disk so
   * a rerun can pass `--resume` to skip already-completed steps
   * (region pick, OAuth, framework detection, etc.).
   */
  checkpoint_saved: 1,
  /**
   * `checkpoint_loaded` — emitted at startup in agent / CI mode when
   * `--resume` finds a fresh, schema-valid checkpoint and restores
   * the session from it. Carries the file age so an orchestrator can
   * decide whether the checkpoint is too stale to trust ("you saved
   * this 22h ago, are you sure you want to keep going?").
   */
  checkpoint_loaded: 1,
  /**
   * `checkpoint_cleared` — emitted when the wizard removes a saved
   * checkpoint. The `reason` discriminator covers the three legitimate
   * triggers (`success` after a clean run, `manual` from a slash
   * command, `logout` after sign-out). Lets orchestrators avoid
   * showing a "resume?" prompt once the underlying state is gone.
   */
  checkpoint_cleared: 1,
  /**
   * `transient_retry` — emitted by the OUTER `runAgent` retry loop on
   * every wizard-driven retry decision (stall timer, transient API
   * error reclassification, SDK thrown transient). Distinct from the
   * SDK-internal `api_retry` system messages, which are tracked via
   * the existing `setRetryState` banner. Carries the next backoff and
   * the SDK-reported `Retry-After` floor so stall-visibility consumers
   * can render an accurate "retrying in Xs" indicator.
   */
  transient_retry: 1,
  /**
   * `attempt_started` — emitted at the TOP of each outer retry-loop
   * iteration in `agent-interface.ts` so orchestrators can tell when
   * a retry attempt actually BEGINS (vs `transient_retry`, which
   * fires WHEN the wizard decides to retry, well before backoff has
   * elapsed). Pair with the existing `auth_retry_exhausted` and
   * `transient_retry` envelopes to render an accurate attempt lifecycle.
   *
   *   transient_retry  → "decided to retry; sleeping Ns"
   *   attempt_started  → "attempt N now beginning"
   *   ...inner work...
   *   transient_retry  → "decided to retry; sleeping Ns" (if it fails)
   *   ...
   *   auth_retry_exhausted | run_error → terminal
   *
   * `reason` discriminates why we entered this attempt:
   *   - `cold_start`    — first attempt of the run (attempt 1)
   *   - `stall_retry`   — previous attempt hit the stall timer
   *   - `auth_refresh`  — previous attempt failed auth and we refreshed tokens
   *   - `network_retry` — previous attempt failed with a transient API error
   *                       (502 / 503 / 504 / ECONNRESET / `terminated`)
   */
  attempt_started: 1,
  /**
   * `progress_estimate` — emitted at every meaningful step boundary
   * inside a multi-item operation (post-agent step queue,
   * multi-editor MCP install, multi-event plan write). Carries the
   * canonical `(stage, current, total, percent)` tuple so an
   * orchestrator can render a progress bar without re-deriving it
   * from a stream of finer-grained events.
   *
   *   `stage`   — short stable id of the operation
   *               (e.g. `'post_agent_steps'`)
   *   `current` — items completed so far (0..total)
   *   `total`   — total items in the operation
   *   `percent` — `Math.round(100 * current / total)` (0..100)
   *
   * Distinct from `post_agent_step` / `tool_call`: those are
   * fine-grained per-item events; `progress_estimate` is the
   * orchestrator-facing rollup. An orchestrator that wants to render
   * a single progress bar subscribes to `progress_estimate` and
   * ignores the fine-grained stream.
   */
  progress_estimate: 1,
  /**
   * `compaction_started` — emitted by the PreCompact hook just before
   * the SDK summarises conversation history. Lets orchestrators render
   * a "compacting…" indicator during what would otherwise be silent
   * (compactions often take 60–120s on large contexts).
   */
  compaction_started: 1,
  /**
   * `compaction_completed` — emitted on the SDK's `compact_boundary`
   * system message. Carries pre/post token counts and duration so
   * orchestrators can attribute lost context to a specific compaction
   * cycle when surfacing "the agent forgot X" failures.
   */
  compaction_completed: 1,
  /**
   * `discovery_fact` — mirrors the TUI's cold-start "discovery feed"
   * chips onto NDJSON so parent agents (Claude Code, Cursor, Codex)
   * can render the same vertical / app-type / framework / package-
   * manager / region facts the wizard surfaces in Ink. Cosmetic only
   * (the agent already receives these values via the preflight
   * context block), but lets orchestrators pin a "here's what we
   * detected" header without parsing every status message. Each
   * fact carries a stable `id` so re-publishing on a retry path is
   * a no-op on the receiving end — orchestrators key off the id to
   * upsert chips.
   */
  discovery_fact: 1,
  /**
   * `current_file` — coarse rollup of the file the inner agent is
   * currently editing, debounced to ~1 emission per 250ms per
   * (path, operation) tuple. Distinct from `tool_call` /
   * `file_change_planned` / `file_change_applied`, which are
   * fine-grained: orchestrators that want a single "now editing X"
   * header subscribe to `current_file`, while audit-trail consumers
   * keep parsing the existing fine-grained events. Debouncing
   * happens at the wire-boundary emitter; the consumer sees one
   * event per logical activity transition rather than one per write.
   */
  current_file: 1,
  /**
   * `stall_status` — coaching-tier mirror of the TUI's stall hints.
   * Tiers escalate as silence grows: `noticed` at 10s, `concerning`
   * at 30s, `critical` at 60s. Carries the duration since last
   * activity plus an optional human-readable hint orchestrators can
   * surface verbatim. Distinct from `heartbeat` (which fires on a
   * fixed cadence regardless of progress) — `stall_status` only
   * fires when the wizard has been quiet long enough to deserve
   * escalated UX.
   */
  stall_status: 1,
  /**
   * `run_resumed` — emitted as the first envelope after `run_started`
   * when the wizard restarts from a checkpoint (post-crash,
   * post-SIGINT, post-token-expiry). Lets orchestrators distinguish
   * "fresh run from cold" from "resumed run from checkpoint" without
   * parsing the run-start status. Carries the checkpoint timestamp,
   * the last-known phase, and a free-form summary of what state was
   * restored (e.g. "region+org+project bound, framework=Next.js").
   */
  run_resumed: 1,
  /**
   * `file_change_failed` — emitted at PostToolUse when a write tool
   * (Edit / Write / MultiEdit / NotebookEdit) reports an error.
   * Distinct from a generic `tool_call` failure: pairs with the
   * preceding `file_change_planned` (same path) so an orchestrator
   * can show "tried to edit X, failed because Y" without parsing
   * tool_result text. `errorClass` discriminates the common failure
   * modes (permission, not-found, syntax, generic) so the
   * orchestrator can branch on the kind rather than the message.
   */
  file_change_failed: 1,
  /**
   * `cold_start_breakdown` — per-phase timing rollup emitted at the
   * END of each cold-start phase boundary. The coarse `run_phase:
   * cold_start` envelope tells an orchestrator "the wizard is
   * cold-starting"; this event tells them WHICH phase consumed the
   * time. Cold start is 5-30s of perceived silence on the spinner,
   * and the lion's share is one of a handful of identifiable
   * phases (skill staging, package-manager probing, framework
   * preflight, MCP bootstrap, gateway probe). Pinning each phase
   * with a measured `durationMs` lets the parent agent:
   *
   *   - render which phase is CURRENTLY active during the spinner
   *     (subscribe to the events as they fire),
   *   - surface "your cold start is slow because phase X took Ys"
   *     diagnostics on a hung run,
   *   - aggregate per-phase timings across runs for performance
   *     tracking without re-parsing log lines.
   *
   * Critical: each phase emits in a `try/finally` boundary inside
   * the runner so a thrown phase still ships its timing breadcrumb
   * — the orchestrator sees "framework_detection took 800ms" even
   * when a later mcp_bootstrap blows up. Absence of a phase event
   * on the wire means the runner exited before that phase ran (or
   * before it got far enough to register a start time).
   */
  cold_start_breakdown: 1,
  /**
   * `tool_call_summary` — aggregated rollup of every tool call the inner
   * agent made during this run. Today the wizard emits one fine-grained
   * `tool_call` envelope per PreToolUse — a typical run produces 30-200
   * such events, and a parent agent that wants to render a "tool usage"
   * summary at completion time has to maintain its own running counts.
   *
   * `tool_call_summary` ships that aggregate from the wizard side:
   *
   *   { totalCalls, byTool, byOutcome, durationMsTotal, durationMsAvg,
   *     topToolByCount? }
   *
   * Emitted at two boundaries:
   *   1. Phase finalize — fires before `run_phase: finalizing` so an
   *      orchestrator can render the inner-agent tool summary before
   *      the post-agent steps section appears.
   *   2. Terminal exit — fires inside `wizardSuccessExit` /
   *      `wizardAbort` (after any finalizing steps that themselves
   *      issue tool calls land in the accumulator), so the orchestrator
   *      always sees a final cumulative rollup covering the WHOLE run.
   *
   * Dedup-safety: the emitter no-ops when the payload signature
   * (`totalCalls` + outcome breakdown) is identical to the previous
   * emission. A duplicate `emitToolCallSummary()` call at the same
   * boundary doesn't double-count, and a terminal emission with no
   * new tool calls since finalize stays off the wire entirely.
   *
   * `totalCalls === 0` is suppressed at the wire — orchestrators
   * watching for this event treat absence as "no tools were called",
   * which is cleaner than receiving a zero-valued payload.
   */
  tool_call_summary: 1,
  /**
   * `mcp_status` — MCP server lifecycle state transition. Two servers
   * are tracked: `wizard_tools` (the in-process MCP server the inner
   * agent calls into) and `editor_install` (the wizard-mcp install
   * into the user's editor — Claude Code / Cursor / Codex / etc.).
   *
   * Today parent agents parsing the NDJSON stream have no visibility
   * into MCP server state transitions — the wizard silently boots its
   * in-process server, silently detects (or doesn't) supported editors,
   * silently installs (or skips) the editor MCP config. This event
   * fills the gap: a `{ server, state, transition_ts, detail? }`
   * envelope at every state boundary so an orchestrator can render
   * "MCP server: available", "Editor install: needs your choice",
   * "Editor install: skipped", etc. without re-parsing the per-tool
   * call stream.
   *
   * `state` enum covers the v2 foundation DoD list: `unavailable`,
   * `available`, `needs_auth`, `needs_install`, `needs_user_choice`,
   * `install_skipped`, `installed`, `failed`, `not_applicable`. Not
   * every state fires for both servers — `needs_auth` and
   * `needs_install` are reserved for future editor-install flavours
   * where the wizard would otherwise be silent about a pre-install
   * blocker.
   */
  mcp_status: 1,
  /**
   * `wizard_capabilities` — startup announcement emitted as the FIRST
   * orchestrator-facing envelope after `run_started`, before any
   * `run_phase: cold_start`. Lets a parent agent (Claude Code, Codex,
   * custom orchestrator) detect what protocol the wizard speaks
   * BEFORE any contract-shaped event lands on the stream.
   *
   * Why it exists: without this, orchestrators have to either
   * hard-code feature detection ("wizard >= 0.40 speaks v2 events")
   * or parse-and-discover at runtime ("I saw `mcp_status`, so the
   * wizard must support it"). Both are fragile. A single up-front
   * capability envelope lets orchestrators:
   *   - Detect protocol version mismatches early ("wizard speaks v1,
   *     I expect v2") and either downgrade their parser or refuse to
   *     proceed before any user-visible state has been mutated.
   *   - Pre-allocate UI for events they know will fire (vs the
   *     wait-and-see pattern of allocating on first sighting).
   *   - Gate optional UX on capability presence — e.g. only render
   *     the per-phase cold-start sparkline if
   *     `cold_start_breakdown` is in `supportedEvents`.
   *
   * Payload: `protocolVersion` (currently 2 — bump on any
   * orchestrator-breaking contract change), `eventDataVersions` (the
   * full `EVENT_DATA_VERSIONS` registry mirrored verbatim so
   * orchestrators can branch per-event without a wizard upgrade),
   * `supportedEvents` (sorted list of every event-key for cheap
   * `has`-style lookups), and `mode` (`'agent' | 'ci' |
   * 'interactive'` — currently always `'agent'` because only AgentUI
   * emits NDJSON, but the field is on the contract so future CI /
   * interactive modes that learn to emit capabilities don't need a
   * schema bump).
   */
  wizard_capabilities: 1,
  /**
   * `model_used` — orchestrator-facing observability event announcing
   * which Claude model the wizard is running for a particular
   * subsystem (inner agent, classifier, taxonomy). Today parent
   * agents have NO visibility into the wizard's model selection —
   * the inner agent might be on Sonnet 4.6, the Haiku one-shot
   * classifier on Haiku 4.5, and an orchestrator wanting to render
   * "wizard is using model X" or attribute cost / latency to a tier
   * has to either parse the wizard binary version or guess.
   *
   * Lifecycle: fires when each subsystem starts its first message —
   * the inner agent's first attempt boundary (after the SDK has
   * settled on the resolved model alias) and at each classifier
   * call-site (today the Haiku gateway probe and the slash-console
   * AI-SDK path). The emitter de-dups on the `(model, context)`
   * pair so a long run doesn't spam the wire with duplicate
   * announcements — orchestrators see exactly one envelope per
   * unique (model, context) combination.
   *
   * Distinct from `wizard_capabilities`: capabilities pins what the
   * wizard CAN emit (protocol contract), while `model_used` pins
   * what the wizard IS RUNNING (operational state). Parent agents
   * branch on `data.context` to attribute the model to the right
   * subsystem and on `data.modelTier` for cost / capability tiering
   * without parsing the raw `data.model` alias.
   */
  model_used: 1,
} as const;

/** All NDJSON event-level types. */
export type AgentEventType =
  | 'lifecycle'
  | 'log'
  | 'status'
  | 'progress'
  | 'session_state'
  | 'prompt'
  | 'needs_input'
  | 'diagnostic'
  | 'result'
  | 'error';

/** Base envelope shared by every NDJSON line. */
export interface AgentEventEnvelope<TData = unknown> {
  v: typeof AGENT_EVENT_WIRE_VERSION;
  '@timestamp': string;
  type: AgentEventType;
  message: string;
  session_id?: string;
  run_id?: string;
  level?: 'info' | 'warn' | 'error' | 'success' | 'step';
  /**
   * Per-event-type data-shape version. Optional because not every
   * event's `data` is part of the orchestrator-facing contract (e.g.
   * `log`, `status`, `progress` carry free-form payloads). When
   * present, orchestrators should branch on this value to handle
   * breaking changes to `data`.
   */
  data_version?: number;
  data?: TData;
}

// ── needs_input ─────────────────────────────────────────────────────
//
// Emitted whenever the wizard would otherwise auto-select or silently choose
// a default. Outer agents can inspect `choices` + `recommended`, surface the
// decision to a human, and resume with `resumeFlags` (preferred) or by
// piping a JSON line to stdin matching `responseSchema`.
//
// When `--auto-approve` is set, `needs_input` is still emitted (for audit)
// but the wizard proceeds with `recommended` automatically. When neither
// `--auto-approve` nor `--yes` are set in agent mode, the wizard exits with
// `INPUT_REQUIRED` (exit code 12) after emitting this event.

/**
 * UI rendering hints — a tiny "UI protocol over NDJSON" that lets the
 * wizard nudge outer agents (Claude Code, Cursor, Codex) toward the right
 * widget without assuming any specific renderer is available. Outer agents
 * are free to ignore the hints and fall back to a plain numbered list, but
 * when they're respected the human-facing UX is dramatically better.
 */
export interface UiHints {
  /**
   * Suggested widget. Outer agents pick the closest match they can render:
   *   - 'searchable_select' — long lists; pair with `pagination`/`searchPlaceholder`
   *   - 'select'            — short list, no search needed
   *   - 'multiselect'       — pick N (not yet used)
   *   - 'confirmation'      — yes/no
   *   - 'secret_input'      — free text but mask on display (API key, token)
   *   - 'text_input'        — free text, no masking
   */
  component:
    | 'searchable_select'
    | 'select'
    | 'multiselect'
    | 'confirmation'
    | 'secret_input'
    | 'text_input';
  /** Importance signal — `required` blocks; `optional` can be skipped. */
  priority?: 'required' | 'recommended' | 'optional';
  /** Heading for the widget. Use the message for short context, title for the heading. */
  title?: string;
  /** One-sentence supporting context shown beneath the title. */
  description?: string;
  /** Placeholder shown in the search field of `searchable_select`. */
  searchPlaceholder?: string;
  /** Message rendered when `choices` is empty (e.g. "No projects yet — create one"). */
  emptyState?: string;
}

/** Pagination signals for long choice lists. */
export interface PaginationInfo {
  /** Total number of choices the wizard knows about across all pages. */
  total: number;
  /** Number of choices included in this event. */
  returned: number;
  /**
   * Optional CLI invocation an outer agent can run to fetch the next page or
   * a search-filtered subset. Pre-built so orchestrators don't have to
   * compose the command themselves.
   */
  nextCommand?: string[];
  /** When set, indicates the choices in this event are filtered by `query`. */
  query?: string;
}

/** Free-form fallback when the right answer isn't in `choices`. */
export interface ManualEntryHint {
  /**
   * CLI flag the outer agent should use to pass the value back. Pairs with
   * `--app-id 769610`-style rerun semantics so manual entry is just another
   * resume flag.
   */
  flag: string;
  /** Placeholder the renderer can show in the input. */
  placeholder?: string;
  /**
   * Optional regex the outer agent SHOULD validate against before submitting.
   * Stringified — outer agents that don't speak regex should treat this as
   * documentation only.
   */
  pattern?: string;
}

export interface NeedsInputChoice<V = string> {
  /** Stable machine value to round-trip back via stdin or resume flags. */
  value: V;
  /** Short human-readable label for the outer agent's UI. */
  label: string;
  /** Optional secondary hint (e.g. environment name, framework version). */
  hint?: string;
  /**
   * One-line supporting description — used by `searchable_select` widgets
   * to render a secondary line under the label. Distinct from `hint` so
   * outer agents can choose to render hint as a badge and description as
   * a sub-label.
   */
  description?: string;
  /**
   * Structured key/value metadata the outer agent can use for richer
   * rendering (org name, env name, region, last-used timestamp, etc.).
   * Keep values primitive — strings, numbers, booleans — so they render
   * cleanly in any widget.
   */
  metadata?: Record<string, string | number | boolean>;
  /**
   * Per-choice argv that re-invokes the wizard with this choice already
   * picked. Equivalent to the top-level `resumeFlags` lookup keyed by
   * `value`, but inlined on each choice so outer agents can produce
   * "click this card to continue" copy without two-step lookups.
   */
  resumeFlags?: string[];
}

export interface NeedsInputData<V = string> {
  /**
   * Stable machine code identifying *what* is being asked. Outer agents key
   * off this to decide how to surface the question. Examples:
   *   - 'environment_selection'
   *   - 'project_selection'
   *   - 'framework_disambiguation'
   *   - 'event_plan_approval'
   *   - 'destructive_overwrite_confirm'
   */
  code: string;
  /**
   * Stable, monotonically-numbered correlation id paired with the
   * subsequent `decision_auto` (or other resolution envelope) that
   * answers this request. Format: `dec_<NNN>` zero-padded to 3
   * digits. Generated process-locally by the emitter — orchestrators
   * MUST NOT synthesize their own ids. Two prompts that happen to
   * share a `code` (back-to-back `confirm` dialogs, paginated
   * choosers) carry different `decisionId`s, which is the only
   * sound way to pair request and response.
   *
   * Optional in the type signature for back-compat — `emitNeedsInput`
   * auto-fills it when callers omit it. Always present on the wire
   * for `data_version >= 2` consumers.
   */
  decisionId?: string;
  /** Short human-readable description of the question. */
  message: string;
  /** Rendering hints the outer agent can use to pick the right widget. */
  ui?: UiHints;
  /** Available choices, in display order. */
  choices: NeedsInputChoice<V>[];
  /** Recommended choice value (used when `--auto-approve` is set). */
  recommended?: V;
  /** Why `recommended` was chosen — surfaced in the UI as a tooltip / badge. */
  recommendedReason?: string;
  /**
   * argv that, when re-invoked, resolves this prompt for each choice.
   * Outer agents prefer this to piping to stdin since it's stateless.
   * Per-choice flags are also available on each `NeedsInputChoice.resumeFlags`.
   */
  resumeFlags?: { value: V; flags: string[] }[];
  /**
   * Optional JSON shape the wizard accepts on stdin instead of a re-invoke.
   * Documents the round-trip format for stdin-driven orchestrators.
   */
  responseSchema?: Record<string, string>;
  /** Pagination metadata for long choice lists. */
  pagination?: PaginationInfo;
  /**
   * When `true`, the outer agent MAY collect free-form input from the user
   * instead of one of the listed choices. `manualEntry` describes the flag
   * to use when re-invoking with that input.
   */
  allowManualEntry?: boolean;
  manualEntry?: ManualEntryHint;
}

/**
 * Wire-format shape of the `data` field in a `needs_input` NDJSON line.
 *
 * `emitNeedsInput` hoists `message` to the envelope level and injects the
 * `event` discriminator, so the on-wire `data` omits `message` and includes
 * `event: 'needs_input'`.
 */
export interface NeedsInputWireData<V = string> {
  event: 'needs_input';
  code: string;
  /**
   * Correlation id paired with the subsequent `decision_auto` /
   * response envelope. See `NeedsInputData.decisionId` for the
   * full contract. Always present on the wire for v2 consumers.
   */
  decisionId: string;
  ui?: UiHints;
  choices: NeedsInputChoice<V>[];
  recommended?: V;
  recommendedReason?: string;
  resumeFlags?: { value: V; flags: string[] }[];
  responseSchema?: Record<string, string>;
  pagination?: PaginationInfo;
  allowManualEntry?: boolean;
  manualEntry?: ManualEntryHint;
}

export type NeedsInputEvent<V = string> = AgentEventEnvelope<
  NeedsInputWireData<V>
>;

// ── waiting_for_user (documented alias for `needs_input`) ───────────
//
// Orchestrators reading the protocol docs see two names for the same
// concept ("needs_input" in the wire / source, "waiting for user" in
// human-facing copy and some early design notes). PR B2 deferred
// reconciling these because `NeedsInputData` already provides the
// typed schema and the wire emitter was settled.
//
// This module re-exports the same schema under the `waiting_for_user`
// name so orchestrator authors can import whichever spelling matches
// their mental model. The two are intentionally type-identical — adding
// fields to `NeedsInputData` automatically picks them up here, and we
// never emit a second envelope for the same event.
//
// CRITICAL: this is a documentation + type alias only. There is NO
// `waiting_for_user` envelope on the wire — orchestrators that want
// to subscribe still subscribe to `type === 'needs_input'`. We do not
// register a separate `EVENT_DATA_VERSIONS.waiting_for_user` entry
// because there is no separate event to version.

/**
 * Type alias for `NeedsInputData`. Documented name for the same wire
 * event — orchestrators that prefer the "waiting for user" phrasing
 * can import this type without changing the underlying schema. See
 * `NeedsInputData` for the full contract.
 *
 * Use this for prompt-handling code paths where the human-facing copy
 * reads "waiting for user input" but you want the typed schema. The
 * wire-format `event` discriminator on `data` remains `'needs_input'`.
 */
export type WaitingForUserData<V = string> = NeedsInputData<V>;

/**
 * Type alias for `NeedsInputWireData`. The wire-format shape (with
 * `event: 'needs_input'` discriminator) read from NDJSON. There is no
 * separate `waiting_for_user` wire event — this is purely a name
 * orchestrators may import when the readability of their consumer
 * code benefits from it.
 */
export type WaitingForUserWireData<V = string> = NeedsInputWireData<V>;

/**
 * Type alias for `NeedsInputEvent`. The full envelope shape for the
 * NDJSON `needs_input` line under its alternate name. See
 * `NeedsInputEvent` for the canonical export.
 */
export type WaitingForUserEvent<V = string> = NeedsInputEvent<V>;

/**
 * Wire shape of the `data` field on a `decision_auto` envelope.
 * Carries the resolved value plus the `decisionId` from the matching
 * `needs_input` so orchestrators can pair request and response
 * exactly. See `EVENT_DATA_VERSIONS.decision_auto` for the full
 * contract.
 */
export interface DecisionAutoData {
  event: 'decision_auto';
  /** Echoes the `code` from the matching `needs_input`. */
  code: string;
  /**
   * Correlation id from the matching `needs_input`. Always present
   * for `data_version >= 2`. Optional in the type signature for
   * forward-compat with synthetic test fixtures.
   */
  decisionId?: string;
  /** The auto-picked value. */
  value: unknown;
  /**
   * Why the wizard auto-resolved instead of waiting for input.
   * `auto_approve` — `--yes` / `--ci` / `--force` was set.
   * `back_compat` — `--agent` implies-autoApprove path.
   */
  reason: 'auto_approve' | 'back_compat';
}

// ── decision_id generator ───────────────────────────────────────────
//
// Process-local counter used to mint a fresh correlation id for every
// `needs_input` request. The id is the single source of truth that
// pairs a request envelope with its `decision_auto` resolution; without
// it, an orchestrator would have to reconstruct pairing by timing +
// `code` heuristics, which breaks the moment two prompts share a code
// (back-to-back `confirm` dialogs, paginated choosers).
//
// Why a counter and not UUID:
//   - Stable across log replay — a transcript replayed offline reads
//     the SAME ids it read live. UUIDs would re-randomize.
//   - Zero-padded `dec_NNN` reads cleanly in `grep` / `jq` filters
//     against a transcript.
//   - Wrap at 999 isn't a concern: a single wizard run never asks
//     hundreds of questions. (If it did, that's the real bug.)

let _decisionIdCounter = 0;

/**
 * Mint the next `decision_id` for a `needs_input` request. Format:
 * `dec_<NNN>` zero-padded to 3 digits (e.g. `dec_001`, `dec_042`).
 * Monotonic within a single Node process; resets when the wizard
 * restarts (orchestrators correlate per-run, not across runs).
 *
 * Test-only: use `__resetDecisionIdCounterForTests()` to get a
 * deterministic sequence inside `beforeEach`.
 */
export function nextDecisionId(): string {
  _decisionIdCounter += 1;
  return `dec_${String(_decisionIdCounter).padStart(3, '0')}`;
}

/**
 * Test helper — reset the process-local counter so each test starts
 * from `dec_001`. NEVER call this from production code; the counter
 * MUST be monotonic across an entire wizard run so orchestrators see
 * stable, non-reused ids.
 */
export function __resetDecisionIdCounterForTests(): void {
  _decisionIdCounter = 0;
}

// ── Inner-agent lifecycle ───────────────────────────────────────────
//
// The wizard runs a Claude SDK agent under the hood. Today, outer agents
// have no visibility into what that inner agent is doing — they see start
// + stop + the final outro. The events below surface the in-flight state
// so an outer orchestrator can mirror the inner agent's progress, attribute
// file changes to specific tools, and decide when to abort.
//
// Each event is emitted from a hook (PreToolUse / PostToolUse / SessionStart /
// Stop) on the inner Claude SDK. They land on the SAME stdout NDJSON stream
// as the rest of the agent-mode events, so outer agents only need one parser.

/** `inner_agent_started` — emitted at SessionStart of the inner Claude run. */
export interface InnerAgentStartedData {
  event: 'inner_agent_started';
  model: string;
  /** 'plan' / 'apply' / 'verify' / 'wizard' depending on the entry command. */
  phase: 'plan' | 'apply' | 'verify' | 'wizard';
  /** Optional plan ID when running under `apply --plan-id`. */
  planId?: string;
}

/**
 * `run_completed` — terminal lifecycle event emitted exactly once per
 * run, immediately before the process calls `process.exit()`.
 *
 * Why this event exists: prior to this, an orchestrator parsing NDJSON
 * had no way to distinguish "wizard finished cleanly and closed
 * stdout" from "wizard crashed mid-stream and Node tore the pipe
 * down." Both look identical (stream EOF) to the consumer.
 *
 * Contract: orchestrators MUST treat absence of `run_completed` before
 * the stream ends as "wizard crashed" and surface a generic failure to
 * their caller. The presence of `run_completed` with `outcome:
 * "success"` and `exitCode: 0` is the only signal of a clean run.
 *
 * The event is wired into the singular exit funnels in
 * `src/utils/wizard-abort.ts` (`wizardSuccessExit` and `wizardAbort`).
 * Anything that calls `process.exit()` directly bypasses this event,
 * which is by design — direct exits are bugs and should be migrated.
 */
export interface RunCompletedData {
  event: 'run_completed';
  /**
   * High-level outcome. Distinct from `exitCode` because two different
   * exit codes can map to the same outcome (e.g. AGENT_FAILED and
   * INTERNAL_ERROR are both `error`), and orchestrators frequently
   * just want a tri-state for log-line color / dashboard rollups.
   */
  outcome: 'success' | 'error' | 'cancelled';
  /** Numeric exit code the process is about to return. */
  exitCode: number;
  /** Wall-clock duration of the run, in milliseconds. */
  durationMs: number;
  /**
   * Optional reason string when `outcome !== 'success'`. Sanitized via
   * the same redactor used by `setRunError` — paths / URLs scrubbed.
   * Free-form, intended for orchestrator log lines, not for
   * programmatic branching (use `exitCode` for that).
   */
  reason?: string;
}

/**
 * `tool_call` — emitted at PreToolUse for every tool the inner agent calls.
 * Carries a sanitized summary so secrets / large prompts don't leak.
 */
export interface ToolCallData {
  event: 'tool_call';
  tool: string;
  /** Short summary of the input — file path for Read/Edit, command head for Bash, etc. */
  summary?: string;
}

/**
 * `file_change_planned` — emitted at PreToolUse for write tools (Edit /
 * Write / MultiEdit / NotebookEdit). The change has been requested by the
 * agent but not yet executed; outer agents can stream this to a human to
 * preview before approving.
 */
export interface FileChangePlannedData {
  event: 'file_change_planned';
  path: string;
  operation: 'create' | 'modify' | 'delete';
}

/**
 * `file_change_applied` — emitted at PostToolUse for write tools that
 * succeeded. Pairs with `file_change_planned` (same path) so outer agents
 * can build an audit trail of "the wizard wrote these N files."
 */
export interface FileChangeAppliedData {
  event: 'file_change_applied';
  path: string;
  operation: 'create' | 'modify' | 'delete';
  /** Optional byte size of the new content for sanity checking. */
  bytes?: number;
}

/**
 * `file_changed` — emitted at PostToolUse with diff metadata so outer
 * agents can render per-file change previews without re-reading anything
 * themselves. Pairs with `file_change_applied` (same path) and adds the
 * additions/deletions/hunks the wizard's session-scoped ledger computed.
 */
export interface FileChangedData {
  event: 'file_changed';
  path: string;
  operation: 'create' | 'modify' | 'delete';
  additions: number;
  deletions: number;
  /** Lightweight hunk metadata (line ranges) for ambient diff rendering. */
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
  }>;
}

/** `event_plan_proposed` — emitted when the inner agent calls `confirm_event_plan`. */
export interface EventPlanProposedData {
  event: 'event_plan_proposed';
  events: Array<{ name: string; description: string }>;
}

/** `event_plan_confirmed` — emitted after the user/orchestrator decides on the plan. */
export interface EventPlanConfirmedData {
  event: 'event_plan_confirmed';
  /**
   * How the decision was made:
   *   - 'auto' — `--auto-approve` / `--yes` / `--ci` / `--agent` silently approved
   *   - 'human' — interactive TUI user pressed approve
   *   - 'flag' — explicit `--approve-events` flag (future)
   */
  source: 'auto' | 'human' | 'flag';
  decision: 'approved' | 'skipped' | 'revised';
}

/** `verification_started` — emitted just before the wizard runs its post-apply checks. */
export interface VerificationStartedData {
  event: 'verification_started';
  phase: 'sdk_present' | 'api_key' | 'ingestion' | 'overall';
}

/** `verification_result` — emitted after each verification phase. */
export interface VerificationResultData {
  event: 'verification_result';
  phase: 'sdk_present' | 'api_key' | 'ingestion' | 'overall';
  success: boolean;
  /** Human-readable reasons for failure. Empty when success=true. */
  failures?: string[];
}

/**
 * `discovery_fact` — wire shape of a single cold-start discovery chip
 * mirrored from the TUI's `DiscoveryFeed`. Stable `id` enables
 * orchestrator-side upsert so a re-publish on retry is idempotent.
 * `label` / `value` are pre-formatted, human-readable strings (e.g.
 * `"Framework"` / `"Next.js (App Router)"`) — orchestrators render
 * them verbatim. Per-fact `discoveredAt` lets orchestrators sort
 * chips chronologically or hide stale ones.
 */
export interface DiscoveryFactData {
  event: 'discovery_fact';
  id: string;
  label: string;
  value: string;
  /** Wall-clock ms when the fact was first published. */
  discoveredAt: number;
}

/**
 * `current_file` — coarse "now editing X" rollup emitted from the
 * write-tool hook, debounced so that repeated edits to the same
 * file inside a 250ms window collapse into a single event. The
 * `relativePath` (when resolvable against `installDir`) is the
 * orchestrator-friendly version; absolute `path` is preserved for
 * audit. `operation` mirrors `FileChangeAppliedData['operation']`
 * — `'create' | 'modify' | 'delete'`. Distinct from `tool_call`
 * (which fires per write) so an orchestrator can pin a single
 * file-focus header without parsing every tool invocation.
 */
export interface CurrentFileData {
  event: 'current_file';
  /** Raw absolute path the inner agent passed to the tool. */
  path: string;
  /**
   * `path` relativized against the wizard's `installDir`, when
   * resolvable. Falls back to `path` otherwise so the consumer
   * always has a renderable string.
   */
  relativePath: string;
  operation: 'create' | 'modify' | 'delete';
}

/**
 * `stall_status` — coaching-tier mirror of the TUI's stall hints.
 * Three escalating tiers fire at 10s / 30s / 60s of silence (no tool
 * calls or status updates from the inner agent). Each tier emits at
 * most once per stall window; activity resets the gate. Orchestrators
 * surface `hint` verbatim when set and otherwise compose their own
 * copy from `tier + durationMs`.
 */
export type StallTier = 'noticed' | 'concerning' | 'critical';
export interface StallStatusData {
  event: 'stall_status';
  tier: StallTier;
  /** Milliseconds since the last observed activity. Monotonic-ish. */
  durationMs: number;
  /**
   * Wall-clock ms timestamp of the most recent observed activity
   * the stall detector saw. Lets orchestrators reconcile against
   * their own clock when rendering "stalled for Ns".
   */
  lastActivity: number;
  /** Optional pre-composed hint string — surface verbatim when set. */
  hint?: string;
}

/**
 * Tier thresholds (ms since last activity). Match the TUI's stall
 * hint banner so InkUI / AgentUI escalate in lockstep — a parent
 * agent that subscribes to `stall_status` sees the same coaching
 * cadence the in-terminal user would.
 */
export const STALL_TIER_THRESHOLDS_MS: Readonly<Record<StallTier, number>> =
  Object.freeze({
    noticed: 10_000,
    concerning: 30_000,
    critical: 60_000,
  });

/**
 * Pure helper — derive the highest stall tier reached for a given
 * silence duration. Returns `null` when below the `noticed` threshold,
 * which lets callers cleanly suppress emission while the wizard is
 * still within its expected response window.
 */
export function deriveStallTier(durationMs: number): StallTier | null {
  if (durationMs >= STALL_TIER_THRESHOLDS_MS.critical) return 'critical';
  if (durationMs >= STALL_TIER_THRESHOLDS_MS.concerning) return 'concerning';
  if (durationMs >= STALL_TIER_THRESHOLDS_MS.noticed) return 'noticed';
  return null;
}

/**
 * `run_resumed` — emitted at startup, after `run_started`, when the
 * wizard restarts from a checkpoint (post-crash, post-SIGINT,
 * post-token-expiry). Lets orchestrators distinguish a fresh cold
 * start from a continuation without parsing the run-start status
 * message. Carries the checkpoint timestamp + last-known phase + a
 * free-form summary of what state was restored.
 */
export interface RunResumedData {
  event: 'run_resumed';
  /** ISO timestamp of when the checkpoint was last persisted. */
  from_checkpoint_at: string;
  /** The most recent `RunPhase` recorded on the checkpoint. */
  last_phase: RunPhase | 'unknown';
  /**
   * Free-form, human-readable summary of restored state (region,
   * org, project, framework, etc.). Pre-redacted at emit time.
   */
  restored_state_summary: string;
}

/**
 * `progress_estimate` — orchestrator-facing rollup for multi-item
 * operations. See `EVENT_DATA_VERSIONS.progress_estimate` for the full
 * contract. The `stage` strings the wizard emits today:
 *
 *   `'post_agent_steps'`  — post-agent queue advance (commit-events,
 *                           create-dashboard, etc.)
 *   `'mcp_install'`       — multi-editor MCP install loop
 *   `'event_plan_write'`  — event-plan track() write loop
 *
 * Additional `stage` strings are added as new long-running operations
 * land. Orchestrators MUST treat `stage` as opaque — branching on
 * specific stage strings is fine, but the absence of one shouldn't
 * change consumer behaviour.
 */
export interface ProgressEstimateData {
  event: 'progress_estimate';
  /** Stable, opaque stage id (e.g. `'post_agent_steps'`). */
  stage: string;
  /** Items completed so far. Monotonically non-decreasing. */
  current: number;
  /** Total items in this stage. Must be >= 1 (no zero-total stages). */
  total: number;
  /** Pre-computed `Math.round(100 * current / total)` (0..100). */
  percent: number;
}

/**
 * Pure helper — derive the `progress_estimate` payload from a
 * `(stage, current, total)` triple. Clamps `current` to the
 * `[0, total]` window so a misbehaving caller can't ship a percent
 * outside `[0, 100]`. Returns `null` when `total < 1` (no work to
 * do — orchestrators should not see a `progress_estimate` for a
 * zero-item operation).
 *
 * Pure for unit testing — used by both the emitter and the
 * regression suite.
 */
export function buildProgressEstimate(
  stage: string,
  current: number,
  total: number,
): ProgressEstimateData | null {
  if (!Number.isFinite(total) || total < 1) return null;
  const clamped = Math.max(0, Math.min(total, Math.floor(current)));
  const percent = Math.round((100 * clamped) / total);
  return {
    event: 'progress_estimate',
    stage,
    current: clamped,
    total,
    percent,
  };
}

/**
 * Reason an outer-loop attempt began. Discriminates the four canonical
 * entry paths the runner takes. See `EVENT_DATA_VERSIONS.attempt_started`
 * for the orchestrator-facing contract.
 */
export type AttemptStartedReason =
  | 'cold_start'
  | 'stall_retry'
  | 'auth_refresh'
  | 'network_retry';

/**
 * `attempt_started` — emitted at the TOP of each outer retry-loop
 * iteration, AFTER any backoff sleep has elapsed and a fresh
 * AbortController has been wired up but BEFORE the inner SDK query
 * actually fires. Orchestrators that subscribed to `transient_retry`
 * (the "deciding to retry" signal) pair it with `attempt_started`
 * (the "now actually running" signal) to render an accurate retry
 * lifecycle banner.
 *
 *   transient_retry → "decided to retry in Ns"
 *   ...backoff sleep...
 *   attempt_started → "attempt N now running"
 *   ...
 *
 * `backoffMs` carries the actual sleep that just elapsed (zero for
 * the cold-start attempt). Useful for accounting / metrics: a
 * stack-aware orchestrator can sum the inter-attempt sleeps without
 * re-parsing `transient_retry` events.
 */
export interface AttemptStartedData {
  event: 'attempt_started';
  /** 1-indexed attempt number for this run. `1` on cold start. */
  attemptNumber: number;
  /**
   * Total attempt budget for this run (`MAX_RETRIES + 1` in
   * `agent-interface.ts`). Lets orchestrators render
   * "attempt N/M" without knowing the wizard's constant.
   */
  totalBudget: number;
  /** Why this attempt began. */
  reason: AttemptStartedReason;
  /**
   * Backoff that just elapsed before this attempt. `0` for the
   * cold-start attempt (no preceding sleep). Matches the value
   * passed to `emitTransientRetry`'s `nextRetryInMs` on the
   * decision envelope that paired with this attempt.
   */
  backoffMs?: number;
}

/**
 * `file_change_failed` — emitted at PostToolUse for write tools
 * (Edit / Write / MultiEdit / NotebookEdit) when the tool reported
 * a failure. Pairs with the preceding `file_change_planned` for
 * the same path so an orchestrator can label the failure on the
 * already-rendered preview without parsing tool_result text.
 *
 * `errorClass` discriminates the common failure modes so an
 * orchestrator can branch by kind:
 *   - `permission` — EACCES / "permission denied"
 *   - `not_found`  — ENOENT / "no such file"
 *   - `syntax`     — agent-side string-match failure on Edit / MultiEdit
 *   - `timeout`    — ETIMEDOUT / "operation timed out" / SDK timeout —
 *                   transient; an orchestrator can safely re-issue the
 *                   write without changing the input. Distinct from
 *                   `generic` so retry-aware consumers don't burn
 *                   budget on a permanent failure.
 *   - `generic`    — anything else
 *
 * Adding a new variant is a `data_version` bump on `file_change_failed`
 * (see `EVENT_DATA_VERSIONS`). Renaming an existing variant is also a
 * bump because orchestrators key off the literal string.
 */
export type FileChangeErrorClass =
  | 'permission'
  | 'not_found'
  | 'syntax'
  | 'timeout'
  | 'generic';
export interface FileChangeFailedData {
  event: 'file_change_failed';
  path: string;
  operation: 'create' | 'modify' | 'delete';
  errorClass: FileChangeErrorClass;
  /** Sanitized message — paths / URLs already redacted. */
  errorMessage: string;
}

/**
 * Phases of cold start the wizard times explicitly. Five discrete
 * blocks; a single run emits each phase at most once. See
 * `EVENT_DATA_VERSIONS.cold_start_breakdown` for the orchestrator-facing
 * contract.
 *
 *   skill_staging             — bundled-skill copy + on-disk integration
 *                                skill resolution
 *   package_manager_detection — npm / yarn / pnpm / bun / pip probe
 *   framework_detection       — preflight context build (project-size
 *                                scan, framework refinement)
 *   mcp_bootstrap             — wizard-tools MCP server boot + Amplitude
 *                                MCP config
 *   gateway_probe             — LLM-gateway liveness + optional AI SDK
 *                                streaming probe
 *
 * Adding a new phase is a `data_version` bump on
 * `cold_start_breakdown` (see `EVENT_DATA_VERSIONS`). Renaming an
 * existing variant is also a bump because orchestrators key off the
 * literal string.
 */
export type ColdStartPhase =
  | 'skill_staging'
  | 'package_manager_detection'
  | 'framework_detection'
  | 'mcp_bootstrap'
  | 'gateway_probe';

/**
 * Wire shape of the `data` field on a `cold_start_breakdown` envelope.
 * Emitted at the END of each cold-start phase boundary — see
 * `EVENT_DATA_VERSIONS.cold_start_breakdown` for the full contract.
 *
 * Timing fields are in milliseconds, derived from `Date.now()` at the
 * phase boundaries:
 *
 *   startedAt   — ms timestamp captured BEFORE the phase work begins
 *   finishedAt  — ms timestamp captured in the `finally` after the phase
 *                  exits (success OR thrown)
 *   durationMs  — `finishedAt - startedAt`, floored at 0 (guards against
 *                  a non-monotonic clock pushing the value negative)
 *
 * Orchestrators that just want the duration read `durationMs`; consumers
 * doing cross-phase correlation (e.g. drawing a timeline) read
 * `startedAt` / `finishedAt`.
 */
export interface ColdStartBreakdownData {
  event: 'cold_start_breakdown';
  /** Which cold-start phase this breakdown covers. */
  phase: ColdStartPhase;
  /**
   * ms timestamp captured immediately before the phase began. Same
   * epoch as `Date.now()`.
   */
  startedAt: number;
  /**
   * ms timestamp captured in the `finally` block after the phase
   * exited (either via successful return or thrown). Same epoch as
   * `startedAt`.
   */
  finishedAt: number;
  /**
   * `finishedAt - startedAt`, floored at 0. A non-monotonic clock can
   * occasionally produce `finishedAt < startedAt` (NTP slew, container
   * pause); the floor keeps the wire contract `>= 0` so consumers can
   * safely sum durations without sentinel checks.
   */
  durationMs: number;
}

/**
 * Pure helper — derive the `cold_start_breakdown` payload from a
 * `(phase, startedAt, finishedAt)` triple. Floors `durationMs` at 0
 * so a non-monotonic clock can't ship a negative duration.
 *
 * Pure for unit testing — used by both the emitter and the
 * regression suite.
 */
export function buildColdStartBreakdown(
  phase: ColdStartPhase,
  startedAt: number,
  finishedAt: number,
): ColdStartBreakdownData {
  // Floor finishedAt at startedAt so durationMs is always >= 0. Cheaper
  // than `Math.max(0, finishedAt - startedAt)` AND preserves the
  // invariant `finishedAt >= startedAt` on the wire (an orchestrator
  // computing `finishedAt - startedAt` itself stays consistent with
  // our durationMs).
  const safeFinishedAt = Math.max(startedAt, finishedAt);
  return {
    event: 'cold_start_breakdown',
    phase,
    startedAt,
    finishedAt: safeFinishedAt,
    durationMs: safeFinishedAt - startedAt,
  };
}

/**
 * Outcome of a single tool call from the inner agent's perspective.
 *
 *   success — PostToolUse fired with no `is_error` / `error` surfacing.
 *   error   — PostToolUse surfaced a tool-side failure (Edit syntax
 *             mismatch, Bash non-zero exit, MCP tool threw, etc.).
 *   denied  — the SDK refused the tool call before it ran (permission
 *             gate, allowlist miss). Counted separately from `error`
 *             because the failure mode is on the WIZARD side (policy)
 *             rather than the TOOL side (operation).
 *
 * Adding a new outcome is a `data_version` bump on
 * `tool_call_summary`.
 */
export type ToolCallOutcome = 'success' | 'error' | 'denied';

/**
 * Wire shape of the `data` field on a `tool_call_summary` envelope.
 * Aggregated rollup of every tool call the inner agent made during
 * the run. See `EVENT_DATA_VERSIONS.tool_call_summary` for the full
 * contract.
 *
 * `byTool` keys are tool names exactly as the SDK reports them
 * (`Edit`, `Write`, `Bash`, `mcp__amplitude__...`, etc.) — no
 * normalization, so an orchestrator can render the rollup with the
 * same labels as the per-call `tool_call` stream.
 *
 * `byOutcome` always includes all three outcome keys (zero-padded)
 * so consumers can render a stable three-bar chart without checking
 * for missing keys.
 *
 * `topToolByCount` is omitted entirely when `totalCalls === 0`
 * (which is itself suppressed at the wire) OR when no tool dominates
 * (tied counts). Optional in the type signature for safe consumer
 * branching.
 */
export interface ToolCallSummaryData {
  event: 'tool_call_summary';
  totalCalls: number;
  /** Per-tool counts. Keys are SDK-reported tool names. */
  byTool: Record<string, number>;
  /** Outcome breakdown. Always includes all three keys (zero-padded). */
  byOutcome: Record<ToolCallOutcome, number>;
  /**
   * Cumulative wall-clock duration across all tool calls (ms).
   * Floored at 0 — a tool that returns instantly contributes 0.
   * Computed from PreToolUse / PostToolUse timestamp deltas;
   * denied calls (no PostToolUse) contribute 0.
   */
  durationMsTotal: number;
  /**
   * `Math.round(durationMsTotal / totalCalls)`. `0` when
   * `totalCalls === 0` — but the wire suppresses zero-total
   * summaries entirely so a consumer reading this field can
   * assume `totalCalls >= 1`.
   */
  durationMsAvg: number;
  /**
   * Tool with the highest count. Omitted when `totalCalls === 0` or
   * when two or more tools tie for the top spot — orchestrators that
   * want a deterministic tie-breaker should compute it themselves
   * from `byTool`.
   */
  topToolByCount?: string;
}

/**
 * Accumulator for tool-call telemetry across the run. Tracks per-tool
 * counts, per-outcome counts, and cumulative wall-clock duration so
 * `tool_call_summary` can be derived on demand at phase / terminal
 * boundaries without re-scanning the NDJSON stream.
 *
 * Pure data structure — no I/O, no side effects, no throws. Safe to
 * call from inside hook callbacks (which must never block the agent
 * loop). Two callers wire it:
 *
 *   1. `AgentUI.emitToolCall` records the start of each tool call
 *      (PreToolUse boundary).
 *   2. The PostToolUse hook in `inner-lifecycle.ts` calls
 *      `recordOutcome` with the resolved success / error verdict.
 *
 * The accumulator pairs Pre/Post by tool name in arrival order —
 * not by an SDK-side correlation id, because the hook input doesn't
 * carry one. This is correct under the (always-true today)
 * invariant that the inner Claude agent runs tools sequentially:
 * one PreToolUse, one PostToolUse, in order. If that invariant ever
 * changes (parallel tool dispatch), the pairing must move to an id-
 * keyed map.
 *
 * Pure for unit testing — used by both the emitter and the
 * regression suite.
 */
export class ToolCallStats {
  private _totalCalls = 0;
  private _byTool: Record<string, number> = {};
  private _byOutcome: Record<ToolCallOutcome, number> = {
    success: 0,
    error: 0,
    denied: 0,
  };
  private _durationMsTotal = 0;
  /** FIFO of pending PreToolUse start timestamps keyed by tool name. */
  private _pendingStarts: Array<{ tool: string; startedAt: number }> = [];

  /**
   * Record the START of a tool call (PreToolUse boundary). Increments
   * `totalCalls` and the per-tool count immediately so the rollup is
   * accurate even if the tool never produces a PostToolUse (e.g. the
   * SDK denies the call). Duration is added on `recordOutcome`.
   */
  recordCall(tool: string, startedAt: number = Date.now()): void {
    this._totalCalls += 1;
    this._byTool[tool] = (this._byTool[tool] ?? 0) + 1;
    this._pendingStarts.push({ tool, startedAt });
  }

  /**
   * Record the OUTCOME of the most recent PreToolUse for a given
   * tool. Pops the matching pending entry (FIFO by tool name),
   * accumulates the duration delta, and increments the outcome
   * bucket. `success` / `error` are the common cases; `denied`
   * fires when the SDK refuses a tool call pre-execution.
   *
   * Missing pending entry (orphaned PostToolUse) is a no-op on
   * duration — the outcome still counts. This happens in test
   * fixtures that simulate the post side without going through pre.
   */
  recordOutcome(
    tool: string,
    outcome: ToolCallOutcome,
    finishedAt: number = Date.now(),
  ): void {
    this._byOutcome[outcome] += 1;
    // FIFO match by tool name. Walk from the head so a long-running
    // call doesn't get its duration stolen by a later shorter call
    // for the same tool.
    const idx = this._pendingStarts.findIndex((e) => e.tool === tool);
    if (idx >= 0) {
      const [entry] = this._pendingStarts.splice(idx, 1);
      // Floor at 0 to guard against a non-monotonic clock — see the
      // same pattern in `buildColdStartBreakdown`.
      this._durationMsTotal += Math.max(0, finishedAt - entry.startedAt);
    }
  }

  /** Total tool calls observed across the run. */
  get totalCalls(): number {
    return this._totalCalls;
  }

  /**
   * Build the wire payload from the current state. Pure — does NOT
   * reset the accumulator (terminal-exit emission re-emits the full
   * cumulative rollup after finalize already emitted once).
   *
   * Returns `null` when `totalCalls === 0` so callers can skip the
   * emission at the wire boundary entirely (a zero-valued summary
   * is noise on the stream).
   */
  build(): ToolCallSummaryData | null {
    if (this._totalCalls === 0) return null;
    // Top-tool resolution: pick the single max-count tool. Tied
    // counts → omit the field (orchestrators can compute their own
    // tie-breaker from `byTool` if they care).
    let topTool: string | undefined;
    let topCount = -1;
    let tied = false;
    for (const [tool, count] of Object.entries(this._byTool)) {
      if (count > topCount) {
        topTool = tool;
        topCount = count;
        tied = false;
      } else if (count === topCount) {
        tied = true;
      }
    }
    const durationMsAvg = Math.round(this._durationMsTotal / this._totalCalls);
    return {
      event: 'tool_call_summary',
      totalCalls: this._totalCalls,
      // Spread the maps so the wire payload is a fresh object the
      // caller can serialize without worrying about post-emit
      // mutation. JSON.stringify would do the same, but a defensive
      // copy is cheap and keeps the contract explicit.
      byTool: { ...this._byTool },
      byOutcome: { ...this._byOutcome },
      durationMsTotal: this._durationMsTotal,
      durationMsAvg,
      ...(topTool !== undefined && !tied ? { topToolByCount: topTool } : {}),
    };
  }
}

export type InnerAgentLifecycleData =
  | InnerAgentStartedData
  | ToolCallData
  | FileChangePlannedData
  | FileChangeAppliedData
  | FileChangeFailedData
  | FileChangedData
  | EventPlanProposedData
  | EventPlanConfirmedData
  | VerificationStartedData
  | VerificationResultData
  | DiscoveryFactData
  | CurrentFileData
  | StallStatusData
  | RunResumedData
  | AttemptStartedData
  | ColdStartBreakdownData
  | ToolCallSummaryData
  | MCPStatusData
  | WizardCapabilitiesData
  | ModelUsedData;

/**
 * Which MCP server a `mcp_status` event refers to. Two distinct
 * lifecycles travel on the same event so an orchestrator can subscribe
 * to a single envelope and key off `server` to branch:
 *
 *   wizard_tools    — the in-process MCP server the inner Claude agent
 *                     consumes (`createWizardToolsServer`). One per run.
 *                     Boots during cold start; transitions are
 *                     `available` (success) or `failed` (boot threw).
 *
 *   editor_install  — the wizard-mcp install written into the user's
 *                     editor config (Claude Code / Cursor / Codex /
 *                     VS Code / Zed / Windsurf / etc.). Optional: many
 *                     runs have no detectable editor and surface
 *                     `not_applicable`; otherwise transitions are
 *                     `needs_user_choice` → `installed` /
 *                     `install_skipped` / `failed`.
 *
 * Adding a new server kind is a `data_version` bump on `mcp_status`.
 */
export type MCPStatusServer = 'wizard_tools' | 'editor_install';

/**
 * Lifecycle state the MCP server has just transitioned INTO. The full
 * enum is the v2 foundation DoD list — not every value fires for every
 * server kind today (see `MCPStatusServer` for the per-server cycle),
 * but the field is shared so future flows can use the same wire
 * contract without a schema bump.
 *
 *   unavailable        — server is known to exist but cannot be reached
 *                        right now (config present, network down, etc.)
 *   available          — server is reachable and ready to accept calls
 *                        (used by `wizard_tools` on successful boot)
 *   needs_auth         — server requires the user to complete an auth
 *                        flow before it can be used
 *   needs_install      — server is supported on this machine but not
 *                        yet installed (config absent)
 *   needs_user_choice  — install requires the user to pick between
 *                        multiple detected clients (multi-editor flow)
 *   install_skipped    — user (or CI policy) declined to install
 *   installed          — install succeeded; server is in the user's
 *                        editor config
 *   failed             — terminal failure (boot threw, write errored,
 *                        permission denied) — `detail` carries the
 *                        operator-friendly message
 *   not_applicable     — no supported editor detected on this machine;
 *                        the install flow is a no-op
 *
 * Adding a new state is a `data_version` bump on `mcp_status` —
 * orchestrators branch on the literal strings.
 */
export type MCPStatusState =
  | 'unavailable'
  | 'available'
  | 'needs_auth'
  | 'needs_install'
  | 'needs_user_choice'
  | 'install_skipped'
  | 'installed'
  | 'failed'
  | 'not_applicable';

/**
 * Wire shape of the `data` field on a `mcp_status` envelope. Emitted
 * at every MCP-related state transition for both the in-process
 * `wizard_tools` server and the `editor_install` flow. See
 * `EVENT_DATA_VERSIONS.mcp_status` for the full contract.
 *
 *   server         — which MCP lifecycle this transition belongs to
 *   state          — the state the server just entered (see
 *                    `MCPStatusState`)
 *   transition_ts  — epoch-ms timestamp captured at the transition
 *                    boundary. Same epoch as `Date.now()`; orchestrators
 *                    use this to render a timeline of transitions
 *                    across both servers without correlating against
 *                    the envelope's ISO `@timestamp`.
 *   detail         — optional free-form description of the transition.
 *                    Operator-friendly, not part of the machine
 *                    contract — orchestrators key off `(server, state)`
 *                    for branching and surface `detail` verbatim.
 *                    Examples: "wizard-tools server bootstrapped on
 *                    stdio", "Claude Code config detected at
 *                    ~/.claude/mcp.json, install skipped because user
 *                    chose 'No'".
 *
 * The `transition_ts` field uses snake_case (rather than the
 * camelCase convention used elsewhere) to match the field name called
 * out in the PR scope document — orchestrators searching for the
 * wire shape will find it under that literal key.
 */
export interface MCPStatusData {
  event: 'mcp_status';
  server: MCPStatusServer;
  state: MCPStatusState;
  transition_ts: number;
  detail?: string;
}

/**
 * Execution mode discriminator on the `wizard_capabilities`
 * envelope. Mirrors `ExecutionMode` from `lib/mode-config.ts`,
 * duplicated here so orchestrators parsing the NDJSON contract
 * don't need to import wizard internals to type-narrow on it.
 *
 * `'agent'`        — NDJSON-only output via `--agent`. The only
 *                    mode that currently emits this envelope.
 * `'ci'`           — non-interactive batch mode. Reserved on the
 *                    contract for a future CI emitter; today CI runs
 *                    use `LoggingUI` which doesn't emit NDJSON.
 * `'interactive'`  — TUI mode (`InkUI`). Reserved on the contract
 *                    for the same reason — InkUI is a no-op for
 *                    this event today.
 */
export type WizardCapabilitiesMode = 'agent' | 'ci' | 'interactive';

/**
 * Wire shape of the `data` field on a `wizard_capabilities`
 * envelope. See `EVENT_DATA_VERSIONS.wizard_capabilities` for the
 * full contract, the lifecycle ordering (after `run_started`, before
 * `run_phase: cold_start`), and the bump policy.
 *
 *   protocolVersion    — orchestrator-facing protocol version
 *                        (`WIZARD_PROTOCOL_VERSION` at emit time).
 *                        Orchestrators branch on this first.
 *   eventDataVersions  — verbatim mirror of `EVENT_DATA_VERSIONS`.
 *                        Stable insertion order (matches the
 *                        registry's declaration order). Orchestrators
 *                        can pre-allocate per-event handlers from
 *                        this map before the first contract event
 *                        fires.
 *   supportedEvents    — `Object.keys(EVENT_DATA_VERSIONS).sort()`.
 *                        Pre-sorted so orchestrators can use
 *                        binary-search / `Set`-style membership
 *                        checks without resorting on their side.
 *                        Identical semantically to the keys of
 *                        `eventDataVersions`, but cheaper to
 *                        consume when the orchestrator only cares
 *                        about presence ("does this wizard emit
 *                        `progress_estimate`?").
 *   mode               — `WizardCapabilitiesMode`. Discriminator
 *                        for execution context.
 */
export interface WizardCapabilitiesData {
  event: 'wizard_capabilities';
  protocolVersion: number;
  eventDataVersions: Readonly<Record<string, number>>;
  supportedEvents: readonly string[];
  mode: WizardCapabilitiesMode;
}

/**
 * Capability tier the resolved `data.model` belongs to. Substring-based
 * classification (see {@link classifyModelTier}) maps a raw alias to one
 * of four buckets so an orchestrator can branch on capability / cost
 * without parsing the dated alias string itself.
 *
 *   haiku  — fastest, cheapest tier. Used for one-shot LLM calls
 *            (gateway probe, slash-console Q&A, classifier paths)
 *            where reasoning depth doesn't matter.
 *   sonnet — balanced tier. The wizard's default inner-agent
 *            model (`claude-sonnet-4-6`) lives here.
 *   opus   — most capable tier. Selected via `--mode thorough` for
 *            complex multi-file instrumentation runs.
 *   other  — model alias didn't match a known prefix. Future tiers,
 *            custom aliases, or `WIZARD_CLAUDE_MODEL` overrides that
 *            point at a non-Claude model land here. Parent agents
 *            should treat `'other'` as "unknown capability — don't
 *            assume any particular tier".
 */
export type ModelCapabilityTier = 'haiku' | 'sonnet' | 'opus' | 'other';

/**
 * Which wizard subsystem is announcing the model it's running. The
 * wizard fires several distinct LLM workloads in a single run and
 * orchestrators want to attribute model selection to the right one
 * (e.g. "the inner agent is on Sonnet but the classifier is on
 * Haiku" is a meaningful operational state).
 *
 *   inner_agent — the main Claude Agent SDK tool loop in
 *                 `agent-interface.ts`. One announcement per run on
 *                 the first attempt boundary.
 *   classifier  — low-stakes one-shot LLM calls (gateway probe,
 *                 slash-console Q&A, future discovered-facts
 *                 inference). Today these route through Haiku via
 *                 `selectModel('oneshot', …)`.
 *   taxonomy    — taxonomy / instrumentation agent. Reserved on the
 *                 contract for future taxonomy paths that route to a
 *                 separately-selected model; today taxonomy work
 *                 rides on the inner agent.
 */
export type ModelContext = 'inner_agent' | 'classifier' | 'taxonomy';

/**
 * Wire shape of the `data` field on a `model_used` envelope. Emitted
 * once per unique `(model, context)` pair per run — orchestrators key
 * off `data.context` to attribute the model to a subsystem and on
 * `data.modelTier` for capability / cost tiering.
 *
 *   model        — resolved Claude model alias the subsystem is
 *                  running (e.g. `'claude-sonnet-4-6'`, `'anthropic/
 *                  claude-haiku-4-5-20251001'`). Includes the
 *                  `anthropic/` gateway prefix when present so a
 *                  parent agent can branch on the routing path.
 *   modelDisplay — short human-readable label (`'Sonnet 4.6'`,
 *                  `'Haiku 4.5'`). Operator-friendly — orchestrators
 *                  can surface this verbatim instead of un-aliasing
 *                  the raw model string.
 *   modelTier    — capability bucket (see {@link ModelCapabilityTier}).
 *   context      — wizard subsystem (see {@link ModelContext}).
 *
 * Bumping a field here is a `data_version` bump on `model_used`.
 */
export interface ModelUsedData {
  event: 'model_used';
  model: string;
  modelDisplay: string;
  modelTier: ModelCapabilityTier;
  context: ModelContext;
}

/**
 * Substring-based classifier mapping a Claude model alias to its
 * capability tier. Defensive: strips any `anthropic/` gateway prefix,
 * lowercases the input so a stray `Claude-Sonnet` doesn't slip
 * through, and falls back to `'other'` for anything that doesn't
 * match a known prefix.
 *
 * Match order matters — `'opus'` is checked before `'sonnet'` /
 * `'haiku'` because a hypothetical `'claude-opus-haiku-blend'` (we
 * don't ship one, but defensive) would otherwise miscategorize as
 * Haiku. Pure (no I/O, no env reads) so it's safe to call from any
 * emit path.
 *
 * @param model - Claude model alias (with or without `anthropic/`
 *                gateway prefix).
 * @returns The {@link ModelCapabilityTier} bucket the alias belongs to.
 */
export function classifyModelTier(model: string): ModelCapabilityTier {
  // Strip the gateway prefix so `anthropic/claude-sonnet-4-6` and
  // `claude-sonnet-4-6` classify identically. Lowercase so a stray
  // mixed-case override doesn't fall through to `'other'`.
  const normalized = model.toLowerCase().replace(/^anthropic\//, '');
  if (normalized.includes('opus')) return 'opus';
  if (normalized.includes('sonnet')) return 'sonnet';
  if (normalized.includes('haiku')) return 'haiku';
  return 'other';
}

/**
 * Best-effort human-readable label for a Claude model alias. Used
 * by `emitModelUsed` to populate `data.modelDisplay` so orchestrators
 * can surface a friendly name without un-aliasing the raw string
 * themselves.
 *
 * Heuristic-only: matches the `<family>-<major>-<minor>[-<datestamp>]`
 * shape the Claude aliases follow and falls back to the original
 * alias when the shape doesn't match. Pure (no env reads, no I/O).
 *
 *   'claude-sonnet-4-6'              → 'Sonnet 4.6'
 *   'claude-haiku-4-5-20251001'      → 'Haiku 4.5'
 *   'claude-opus-4-7'                → 'Opus 4.7'
 *   'anthropic/claude-sonnet-4-6'    → 'Sonnet 4.6'
 *   'gpt-4o'                         → 'gpt-4o'  (unknown shape)
 */
export function formatModelDisplay(model: string): string {
  const normalized = model.toLowerCase().replace(/^anthropic\//, '');
  const match = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/.exec(normalized);
  if (!match) return model;
  const family = match[1];
  const major = match[2];
  const minor = match[3];
  const capitalized = family.charAt(0).toUpperCase() + family.slice(1);
  return `${capitalized} ${major}.${minor}`;
}

/**
 * Coarse-grained orchestrator-facing phase boundaries for a wizard run.
 * Five fixed states; a single run transits in order:
 *
 *   cold_start    -> the wizard has started bootstrapping (skill
 *                    staging, project read, agent SDK handshake). The
 *                    user sees the spinner; no SDK tool has been
 *                    called yet.
 *   agent_running -> the inner Claude agent has fired its first tool
 *                    call or its first turn. Most of the run lives
 *                    here.
 *   finalizing    -> the inner agent has stopped; the wizard is
 *                    running post-agent steps (commit events,
 *                    MCP install, env upload, Slack, Outro).
 *   completed     -> terminal success. Pairs with `run_completed:
 *                    { outcome: 'success' }`.
 *   error         -> terminal failure. Pairs with `run_completed:
 *                    { outcome: 'error' | 'cancelled' }`.
 *
 * Orchestrators key off `data.phase` rather than the message string.
 */
export type RunPhase =
  | 'cold_start'
  | 'agent_running'
  | 'finalizing'
  | 'completed'
  | 'error';

export interface RunPhaseData {
  event: 'run_phase';
  phase: RunPhase;
}

/**
 * `auth_retry_exhausted` — terminal observability event from the SDK
 * retry-loop boundary. After AUTH_RETRY_LIMIT consecutive 401-flavoured
 * api_retry messages the wizard short-circuits the SDK's own ~3-minute
 * retry storm and aborts. Orchestrators watching the stream see this
 * event BEFORE the subsequent `auth_required` envelope, so they can
 * distinguish "single 401, transient" from "we tried twice, this is
 * stuck" without re-parsing message strings.
 *
 * `subkind` is the canonical authentication source — auth retries
 * always originate from the LLM-gateway today (the SDK only retries
 * upstream auth failures), but the field is explicit so future
 * Amplitude-side retry storms can be tagged without a schema bump.
 */
export interface AuthRetryExhaustedData {
  event: 'auth_retry_exhausted';
  attempts: number;
  subkind?: 'amplitude' | 'llm-gateway';
}

// ── Tool-input summarizer ───────────────────────────────────────────
//
// PreToolUse hooks receive the raw tool input which can include large
// prompts, full file contents, or shell commands. We surface only a short
// summary string in NDJSON so:
//   - large file contents don't blow up the outer agent's context
//   - commands stay scannable in a transcript
//   - prompts/messages aren't leaked downstream

/** Truncate a string for inclusion in NDJSON event payloads. */
export function summarizeForEvent(s: string, max = 120): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Best-effort summarizer for PreToolUse `input` payloads. Recognizes the
 * common Claude tools (Read/Edit/Write/Bash/Grep/Glob/Task/TodoWrite/MCP)
 * and produces a short human-readable string. Falls back to a JSON head
 * for unknown tool shapes.
 */
export function summarizeToolInput(
  toolName: string,
  input: unknown,
): string | undefined {
  if (input === null || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  switch (toolName) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return typeof obj.file_path === 'string'
        ? summarizeForEvent(obj.file_path)
        : typeof obj.path === 'string'
        ? summarizeForEvent(obj.path)
        : undefined;
    case 'Bash':
      return typeof obj.command === 'string'
        ? summarizeForEvent(obj.command)
        : undefined;
    case 'Grep':
    case 'Glob':
      return typeof obj.pattern === 'string'
        ? summarizeForEvent(obj.pattern)
        : undefined;
    case 'Task':
      return typeof obj.description === 'string'
        ? summarizeForEvent(obj.description)
        : undefined;
    case 'TodoWrite':
      return Array.isArray(obj.todos)
        ? `${obj.todos.length} todo(s)`
        : undefined;
    default: {
      // Unknown tool: emit a short JSON head, stripped of newlines.
      try {
        return summarizeForEvent(
          JSON.stringify(input).replace(/\s+/g, ' '),
          80,
        );
      } catch {
        return undefined;
      }
    }
  }
}

// ── Setup context / completion ──────────────────────────────────────
//
// The two events below bracket the wizard's actual work. `setup_context`
// fires BEFORE any decisions / writes happen so the outer agent can show
// the user exactly which Amplitude scope they're about to modify.
// `setup_complete` fires ONCE on a successful run with the canonical
// artifact list — it's the contract the outer agent reads to drive
// follow-up MCP calls into the right project.

/**
 * Provenance for a resolved scope field. Lets orchestrators decide
 * whether to re-confirm with the user (e.g. always confirm `auto`
 * resolutions even when there's a single match).
 */
export type SetupContextSource =
  | 'auto' // resolved by single-match / sole-org auto-pick
  | 'flag' // came from an explicit CLI flag (--app-id, --integration, ...)
  | 'saved' // restored from a prior session (~/.ampli config / token store)
  | 'recommended'; // wizard's recommended pick from a >1 list (not yet selected)

/**
 * Resolved Amplitude scope at the moment the event fires. Every field
 * is optional because not every phase has every value: `plan` emits
 * the org/region but may not have an appId yet; `apply_started`
 * emits everything once the env picker has run. Skill instructs the
 * agent to surface whatever fields are present and ask the user to
 * confirm the ones that aren't.
 */
export interface SetupContextAmplitudeScope {
  region?: 'us' | 'eu';
  orgId?: string;
  orgName?: string;
  projectId?: string;
  projectName?: string;
  /**
   * Numeric Amplitude app id (a.k.a. project id in the Amplitude UI).
   * Stringified so JS bigint-y values round-trip cleanly through
   * orchestrator stores. Always parseable back to a positive integer.
   */
  appId?: string;
  appName?: string;
  envName?: string;
}

/**
 * Wire shape of `setup_context.data`. Per-field provenance lets the
 * orchestrator render badges like "auto-detected" or "from flag".
 * `phase` discriminates which command emitted it — useful when the
 * orchestrator is multiplexing multiple wizard runs.
 */
export interface SetupContextData {
  event: 'setup_context';
  phase: 'plan' | 'apply_started' | 'whoami';
  amplitude: SetupContextAmplitudeScope;
  sources?: Partial<
    Record<keyof SetupContextAmplitudeScope, SetupContextSource>
  >;
  /**
   * When `true`, the orchestrator MUST surface this scope to the user
   * before proceeding. Set by `--confirm-app` and on any `auto`
   * resolution where multiple choices were possible.
   */
  requiresConfirmation?: boolean;
  /**
   * argv to re-invoke if the user wants to pick a different app
   * instead of the auto-resolved one. Always uses `--app-id` as the
   * canonical scope flag.
   */
  resumeFlags?: { changeApp: string[] };
}

/** Single planned analytics event written by the wizard. */
export interface SetupCompleteEvent {
  name: string;
  description?: string;
  /** Source file the track() call landed in (relative to installDir). */
  file?: string;
}

/** Wire shape of `setup_complete.data`. */
export interface SetupCompleteData {
  event: 'setup_complete';
  /** Resolved Amplitude scope — the source of truth for follow-up queries. */
  amplitude: SetupContextAmplitudeScope & {
    /** Public dashboard URL when the wizard created one. */
    dashboardUrl?: string;
    /** Dashboard id (last segment of dashboardUrl) — convenience for MCP. */
    dashboardId?: string;
  };
  /** Files the inner agent created or modified, relative to `installDir`. */
  files?: { written: string[]; modified: string[] };
  /** Env-var names the wizard added/changed (values intentionally omitted). */
  envVars?: { added: string[]; modified: string[] };
  /** Final approved event plan. */
  events?: SetupCompleteEvent[];
  /** Wall-clock duration of the run in ms. */
  durationMs?: number;
  /** Hint for follow-up tooling. Skill reads `mcpServer` to wire MCP context. */
  followups?: {
    mcpServer?: { command: string[]; description: string };
    docsUrl?: string;
  };
}

// ── Recoverable error hints ─────────────────────────────────────────
//
// Every NDJSON `error` event carries a `recoverable` discriminator and
// an optional `suggestedAction` so consuming agents (Claude Code,
// Cursor, custom orchestrators) know what to do next without parsing
// the message string. Without these, every error looks the same — the
// outer agent has to write its own ad-hoc remediation map per error
// pattern. With them, "wizard failed; re-run with `--yes`" becomes a
// machine-readable instruction.

/**
 * What an outer agent should do in response to this error.
 *
 *   - `retry`              — transient failure (network blip, gateway 5xx).
 *                            Re-spawn the wizard with the same flags.
 *   - `reinvoke_with_flag` — the call needs different args (auto-pick
 *                            refused, missing required flag). Use
 *                            `suggestedAction.command` as the new argv.
 *   - `human_required`     — needs a human (auth expired, quota hit,
 *                            permission denied). Surface to user.
 *   - `fatal`              — internal wizard bug or unrecoverable state.
 *                            Don't retry; route to bug report flow.
 */
export type RecoverableHint =
  | 'retry'
  | 'reinvoke_with_flag'
  | 'human_required'
  | 'fatal';

/**
 * Concrete next-step suggestion paired with a `recoverable` value. Both
 * fields are optional so the emitter can give partial guidance when
 * only one half is meaningful — `command` lists argv the orchestrator
 * can spawn directly (no shell-quoting), `docsUrl` points at a
 * remediation doc when the fix is contextual.
 */
export interface SuggestedAction {
  /** argv array the orchestrator should run next (no shell quoting). */
  command?: string[];
  /** Doc URL to surface in the user-facing error path. */
  docsUrl?: string;
}

/**
 * Common shape on every NDJSON `error.data` payload. Specific error
 * variants extend this with their own discriminator (`event` /
 * `code`). Adding a field here is a `data_version` bump on every
 * affected error event.
 */
export interface RecoverableErrorData {
  recoverable: RecoverableHint;
  suggestedAction?: SuggestedAction;
}

/**
 * Best-effort classifier — maps an Error's name + message to the most
 * specific `recoverable` hint we can derive. Used by `setRunError` so
 * every uncaught run-aborting error carries a hint without the caller
 * having to know which bucket it fell into.
 *
 * Patterns sourced from production Sentry traces and the audit doc.
 * Pure (no side effects, no network) so it's safe to call in any
 * emit path.
 */
export function classifyRunError(error: Error): {
  recoverable: RecoverableHint;
  suggestedAction?: SuggestedAction;
} {
  const msg = `${error.name}: ${error.message}`.toLowerCase();

  // Auth / token expired — only the human can re-login. Pre-empt the
  // generic-retry path so orchestrators don't burn budget retrying.
  if (
    msg.includes('authentication_error') ||
    msg.includes('authentication_failed') ||
    msg.includes('invalid or expired token') ||
    msg.includes('401') ||
    msg.includes('needs-auth')
  ) {
    return {
      recoverable: 'human_required',
      suggestedAction: {
        command: ['amplitude-wizard', 'login'],
        docsUrl: 'https://github.com/amplitude/wizard#login',
      },
    };
  }

  // Quota / forbidden — needs an admin or a billing change.
  if (
    msg.includes('quota_reached') ||
    msg.includes('quota exceeded') ||
    msg.includes('forbidden') ||
    msg.includes('403')
  ) {
    return { recoverable: 'human_required' };
  }

  // Write refused — the agent needed write permission and didn't have it.
  // Re-running with `--yes` is the canonical remediation.
  if (
    msg.includes('write_refused') ||
    msg.includes('permission denied') ||
    msg.includes('eacces')
  ) {
    return {
      recoverable: 'reinvoke_with_flag',
      suggestedAction: {
        command: ['amplitude-wizard', '--yes'],
      },
    };
  }

  // Gateway / upstream blips — transient, safe to retry.
  if (
    msg.includes('gateway_down') ||
    msg.includes('terminated') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('network')
  ) {
    return { recoverable: 'retry' };
  }

  // Rate limit — transient but the orchestrator should back off.
  if (msg.includes('rate_limit') || msg.includes('429')) {
    return { recoverable: 'retry' };
  }

  // Default: assume the wizard hit a bug. Don't loop on fatal errors —
  // route to the bug report flow.
  return {
    recoverable: 'fatal',
    suggestedAction: {
      command: ['amplitude-wizard', 'feedback'],
    },
  };
}

// ── Log truncation ──────────────────────────────────────────────────
//
// Inner-agent errors can include the entire failing SSE response body
// (model id, signature blobs, cache token counts, partial JSON
// deltas — kilobytes of internals). Past sessions surfaced 50KB+
// `log.message` strings that polluted orchestrator context, leaked
// internal model identifiers, and rendered as walls of unreadable text.
// We truncate in the emitter so a single misbehaving caller can't blow
// up downstream parsers regardless of where the noise originated.

/**
 * Maximum length of a `log.message` string in NDJSON output. Spillover
 * is dropped from the wire and pointed at the on-disk verbose log so
 * orchestrators see a readable status line and the operator still has
 * the full payload for debugging.
 */
export const MAX_LOG_MESSAGE_LENGTH = 2048;

/**
 * Truncate a log message for inclusion in NDJSON output. Idempotent
 * (already-short strings pass through unchanged) and stable (the
 * suffix is appended exactly once even on double-truncation).
 *
 *   - `<= MAX_LOG_MESSAGE_LENGTH` → returned verbatim
 *   - otherwise                  → `<head>… [truncated …; see verbose log]`
 *
 * Pure for unit testing.
 */
export function truncateLogMessage(
  message: string,
  max = MAX_LOG_MESSAGE_LENGTH,
): string {
  if (message.length <= max) return message;
  const suffix = '… [truncated; see verbose log]';
  // Reserve room for the suffix so the final string is always exactly
  // `max` bytes long (or shorter when `max` itself is too small for
  // the suffix — defensive, never happens in practice).
  const headroom = Math.max(0, max - suffix.length);
  return message.slice(0, headroom) + suffix;
}

// ── SSE-frame suppression ───────────────────────────────────────────
//
// When the Anthropic gateway terminates a streaming response with a 4xx
// (most commonly a `400 terminated` mid-stream — see
// `classifyApiErrorSubtype` in `agent-runner.ts`), the SDK throws an
// error whose `.message` includes the raw SSE response body that was
// in flight. That body is hundreds of `event:` / `data:` framing lines
// plus `partial_json` `tool_use` deltas — protocol noise that is
// completely useless to a human operator. Worse, some of those deltas
// include in-flight tool arguments that look like file-path fragments
// (`"nwarner/w...", "rktree-", "repos/Nex..."`) which then surface to
// the user as if they were actual log content.
//
// This helper detects those frames and replaces them with a single
// summary marker so the user-visible log shows ONE readable line per
// upstream failure instead of dozens of garbled bytes. The detection
// list is intentionally duplicated from `agent-interface.ts`'s
// `STREAM_EVENT_TYPES` set: keeping `agent-events.ts` self-contained
// (no imports from `agent-interface.ts`) avoids a circular dependency
// — `agent-interface.ts` already imports from this module.

const STREAM_EVENT_TYPE_NAMES: ReadonlyArray<string> = [
  'message_start',
  'message_delta',
  'message_stop',
  'content_block_start',
  'content_block_delta',
  'content_block_stop',
  'ping',
  'stream_event',
];

/**
 * True if `line` (already trimmed of leading whitespace) looks like an
 * Anthropic SSE protocol frame. Mirrors the prefix-based detector used
 * by `looksLikeStreamEventLine` in `agent-interface.ts` but kept inline
 * to avoid pulling agent-interface into the agent-events module
 * (circular import). Cheap: just three prefix lookups against a small
 * fixed-size array.
 */
function isStreamEventFrameLine(trimmed: string): boolean {
  if (trimmed.length < 9) return false;
  const first = trimmed[0];
  if (first === 'e') {
    for (const t of STREAM_EVENT_TYPE_NAMES) {
      if (trimmed.startsWith(`event: ${t}`)) return true;
    }
    return false;
  }
  if (first === 'd') {
    for (const t of STREAM_EVENT_TYPE_NAMES) {
      if (trimmed.startsWith(`data: {"type":"${t}"`)) return true;
    }
    return false;
  }
  if (first === '{') {
    for (const t of STREAM_EVENT_TYPE_NAMES) {
      if (trimmed.startsWith(`{"type":"${t}"`)) return true;
    }
    return false;
  }
  return false;
}

/**
 * Strip Anthropic SSE protocol noise from an error / log message, replacing
 * runs of frame lines with a single `[N SSE frames suppressed]` marker.
 * Preserves any non-frame content (so a real error riding alongside the
 * SSE body — `TypeError: ...`, the upstream HTTP status line — survives).
 *
 *   in:  `API Error: 400 event: message_start\n` +
 *        `data: {"type":"message_start",...}\n` +
 *        `event: content_block_delta\n` +
 *        `data: {"type":"content_block_delta",...}\n`
 *   out: `API Error: 400 [4 SSE frames suppressed]`
 *
 * Pure for unit testing — no I/O, no UI calls.
 *
 * @param message - The raw error / log message to sanitize.
 * @returns The message with SSE frame runs collapsed to a marker.
 */
export function suppressSseFrames(message: string): string {
  // Fast path: message has none of the obvious markers — return as-is so
  // the common (non-SSE) case stays zero-cost.
  if (
    !message.includes('event: ') &&
    !message.includes('data: {"type":"') &&
    !message.includes('{"type":"')
  ) {
    return message;
  }

  const lines = message.split('\n');
  const out: string[] = [];
  let suppressedRun = 0;
  // The first line of an SDK error often looks like
  // `API Error: 400 event: message_start ...` — i.e. the leading text
  // and the FIRST SSE frame share a single line. Detect that and split
  // the frame off so we don't drop the prefix.
  const firstFrameInline = /(.*?)(event:\s+(?:[a-z_]+))(.*)$/i;

  const flushSuppressed = (): void => {
    if (suppressedRun > 0) {
      out.push(
        `[${suppressedRun} SSE frame${
          suppressedRun === 1 ? '' : 's'
        } suppressed]`,
      );
      suppressedRun = 0;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Mid-stream split: if this is the first line and the SSE frame
    // begins partway through (after some prefix like `API Error: 400 `),
    // emit the prefix as kept text and count the inline frame.
    if (i === 0 && !isStreamEventFrameLine(trimmed)) {
      const m = firstFrameInline.exec(line);
      if (m) {
        const prefix = m[1].trimEnd();
        const frameType = m[2].slice('event:'.length).trim();
        if (STREAM_EVENT_TYPE_NAMES.includes(frameType)) {
          if (prefix) out.push(prefix);
          suppressedRun = 1;
          continue;
        }
      }
    }

    if (isStreamEventFrameLine(trimmed)) {
      suppressedRun++;
      continue;
    }
    // Blank lines between SSE frames are protocol filler — fold them
    // into the suppressed run so we don't emit a stray empty line in
    // the middle of the marker.
    if (suppressedRun > 0 && trimmed === '') {
      suppressedRun++;
      continue;
    }
    flushSuppressed();
    out.push(line);
  }
  flushSuppressed();
  return out.join('\n');
}

/**
 * One-shot "make this error message safe to log" pipeline:
 *
 *   1. Strip any embedded SSE protocol frames (replacing with a marker
 *      that tells the operator how many were suppressed).
 *   2. Cap the result at `MAX_LOG_MESSAGE_LENGTH` so even the marker-
 *      stripped form can't blow past the on-disk log budget.
 *
 * Use this at every callsite that logs an error message coming from
 * the Anthropic SDK or the LLM gateway — the SDK occasionally
 * serializes the entire failing response body into the error string,
 * and our raw `logToFile(...)` calls would otherwise dump tens of KB
 * of `event:` / `data:` lines into the user-visible log.
 *
 * Pure for unit testing.
 */
export function sanitizeErrorMessageForLog(
  message: string,
  max = MAX_LOG_MESSAGE_LENGTH,
): string {
  return truncateLogMessage(suppressSseFrames(message), max);
}

/**
 * Map a Claude write-tool name to the operation kind the wire format
 * exposes. `Write` always creates (or overwrites), `Edit` / `MultiEdit` /
 * `NotebookEdit` modify. Returns null for non-write tools so callers can
 * skip emission cleanly.
 */
export function classifyWriteOperation(
  toolName: string,
): FileChangeAppliedData['operation'] | null {
  switch (toolName) {
    case 'Write':
      return 'create';
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'modify';
    default:
      return null;
  }
}

/**
 * Best-effort classifier for write-tool failure messages. Pure, never
 * touches I/O — safe to call from any emit path. Patterns are
 * intentionally permissive: a `'permission denied'` substring covers
 * both EACCES from Node and the inner agent's own "write_refused"
 * messaging. Defaults to `'generic'` so an unrecognized failure still
 * lands on the wire with a usable discriminator.
 *
 * Match order matters: `syntax` is checked BEFORE `not_found` because
 * Edit / MultiEdit string-match failures look like "String to replace
 * not found in file" — the more-specific "string to replace" signal
 * wins over the generic "not found" substring.
 */
export function classifyFileChangeError(message: string): FileChangeErrorClass {
  const lower = message.toLowerCase();
  if (
    lower.includes('permission denied') ||
    lower.includes('eacces') ||
    lower.includes('eperm') ||
    lower.includes('write_refused') ||
    lower.includes('read-only file system') ||
    lower.includes('erofs')
  ) {
    return 'permission';
  }
  // Edit / MultiEdit string-match failures surface as
  // "String to replace not found" or "found N matches" from the SDK.
  // Check this BEFORE the generic 'not found' so the syntax signal
  // wins for those Edit-specific messages.
  if (
    lower.includes('string to replace') ||
    lower.includes('found multiple matches') ||
    lower.includes('found 0 matches') ||
    lower.includes('did not match') ||
    lower.includes('syntaxerror') ||
    lower.includes('unexpected token') ||
    lower.includes('invalid json')
  ) {
    return 'syntax';
  }
  // Timeout patterns — transient by definition. Check BEFORE not_found
  // because `ETIMEDOUT` is sometimes wrapped with secondary text that
  // could trip the `not found` heuristic.
  if (
    lower.includes('etimedout') ||
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('operation timed out') ||
    lower.includes('deadline exceeded')
  ) {
    return 'timeout';
  }
  if (
    lower.includes('no such file') ||
    lower.includes('enoent') ||
    lower.includes('not found') ||
    lower.includes('does not exist')
  ) {
    return 'not_found';
  }
  return 'generic';
}
