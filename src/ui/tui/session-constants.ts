/**
 * Inline copies of runtime constants from wizard-session.ts.
 *
 * tsx has an ESM/CJS dual-loading bug: when a module is first loaded as CJS
 * (e.g. via a top-level import chain) and then loaded again via dynamic
 * import() as ESM, named exports using the `as const` + same-name type
 * pattern fail to resolve. This file provides the TUI layer with its own
 * copies so it never needs runtime imports from wizard-session.ts.
 *
 * IMPORTANT: keep these in sync with src/lib/wizard-session.ts.
 */

export const RunPhase = {
  Idle: 'idle',
  Running: 'running',
  Completed: 'completed',
  Error: 'error',
} as const;
export type RunPhase = (typeof RunPhase)[keyof typeof RunPhase];

export const PostAgentStepStatus = {
  Pending: 'pending',
  InProgress: 'in_progress',
  Completed: 'completed',
  Skipped: 'skipped',
} as const;
export type PostAgentStepStatus =
  (typeof PostAgentStepStatus)[keyof typeof PostAgentStepStatus];

export const AdditionalFeature = {
  LLM: 'llm',
  SessionReplay: 'session_replay',
  Engagement: 'engagement',
} as const;
export type AdditionalFeature =
  (typeof AdditionalFeature)[keyof typeof AdditionalFeature];

export const ADDITIONAL_FEATURE_LABELS: Record<AdditionalFeature, string> = {
  [AdditionalFeature.LLM]: 'LLM analytics',
  [AdditionalFeature.SessionReplay]: 'Session Replay',
  [AdditionalFeature.Engagement]: 'Guides & Surveys',
};

export const INLINE_FEATURES: ReadonlySet<AdditionalFeature> = new Set([
  AdditionalFeature.SessionReplay,
  AdditionalFeature.Engagement,
]);

export const TRAILING_FEATURES: ReadonlySet<AdditionalFeature> = new Set([
  AdditionalFeature.LLM,
]);

/**
 * Discovered features that map to an opt-in AdditionalFeature.
 * Stripe is discovered but not opt-in — it's a passive doc link.
 * Derived from AdditionalFeature values, which by convention match the
 * corresponding DiscoveredFeature values.
 */
export const OPT_IN_DISCOVERED_FEATURES: ReadonlySet<string> = new Set(
  Object.values(AdditionalFeature),
);

export const McpOutcome = {
  NoClients: 'no_clients',
  Skipped: 'skipped',
  Installed: 'installed',
  Failed: 'failed',
} as const;
export type McpOutcome = (typeof McpOutcome)[keyof typeof McpOutcome];

export const SlackOutcome = {
  Skipped: 'skipped',
  Configured: 'configured',
} as const;
export type SlackOutcome = (typeof SlackOutcome)[keyof typeof SlackOutcome];

export const OutroKind = {
  Success: 'success',
  Error: 'error',
  Cancel: 'cancel',
} as const;
export type OutroKind = (typeof OutroKind)[keyof typeof OutroKind];

/**
 * Long-running stalls the wizard surfaces in the TUI's "current activity"
 * line. Each kind corresponds to a specific source of silent dead-time the
 * user would otherwise read as "stuck":
 *
 * - `compaction`        — SDK collapsing conversation history (30-90s).
 * - `rate-limit-retry`  — outer retry loop sleeping before re-issuing a 429
 *                         / transient gateway error.
 * - `cold-start`        — pre-first-message setup: skill staging, framework
 *                         detection, agent SDK initialization.
 * - `ingestion-poll`    — polling Amplitude for first events (post-#510
 *                         backoff, ~5-30s per cycle).
 * - `mcp-tool`          — long-running Amplitude MCP call from inside the
 *                         agent (e.g. `query_dataset` on a large project).
 * - `idle`              — no active stall; render falls back to its default
 *                         (status messages / journey stepper).
 *
 * Sentinel values intentionally use kebab-case so the same string flows
 * through the AgentUI NDJSON contract verbatim.
 */
export const ActivityKind = {
  Idle: 'idle',
  Compaction: 'compaction',
  RateLimitRetry: 'rate-limit-retry',
  ColdStart: 'cold-start',
  IngestionPoll: 'ingestion-poll',
  McpTool: 'mcp-tool',
} as const;
export type ActivityKind = (typeof ActivityKind)[keyof typeof ActivityKind];
