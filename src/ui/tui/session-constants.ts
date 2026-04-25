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

export const AdditionalFeature = {
  LLM: 'llm',
  SessionReplay: 'session_replay',
} as const;
export type AdditionalFeature =
  (typeof AdditionalFeature)[keyof typeof AdditionalFeature];

export const ADDITIONAL_FEATURE_LABELS: Record<AdditionalFeature, string> = {
  [AdditionalFeature.LLM]: 'LLM analytics',
  [AdditionalFeature.SessionReplay]: 'Session Replay',
};

export const INLINE_FEATURES: ReadonlySet<AdditionalFeature> = new Set([
  AdditionalFeature.SessionReplay,
]);

export const TRAILING_FEATURES: ReadonlySet<AdditionalFeature> = new Set([
  AdditionalFeature.LLM,
]);

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
