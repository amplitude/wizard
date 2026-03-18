/**
 * Middleware system types for wizard agent runs.
 *
 * Middleware receives lifecycle events (messages, phase transitions, finalize)
 * and can publish data to a shared store for downstream middleware to read.
 */

import type { SpinnerHandle } from '../../ui';

/** Token usage reported by the SDK on assistant messages */
export interface SDKUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  total_cost_usd?: number;
}

export interface SDKContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SDKModelUsageEntry {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface SDKCompactMetadata {
  pre_tokens?: number;
  trigger?: string;
}

/** SDK message received from the agent runner */
export interface SDKMessage {
  type: string;
  subtype?: string;
  message?: {
    id?: string;
    usage?: SDKUsage;
    content?: SDKContentBlock[];
    [key: string]: unknown;
  };
  compact_metadata?: SDKCompactMetadata;
  is_error?: boolean;
  result?: string;
  errors?: string[];
  model?: string;
  tools?: unknown[];
  mcp_servers?: unknown[];
  usage?: SDKUsage;
  total_cost_usd?: number;
  num_turns?: number;
  modelUsage?: Record<string, SDKModelUsageEntry>;
  [key: string]: unknown;
}

/** Read-only shared state available to all middleware */
export interface MiddlewareContext {
  /** Current detected phase name */
  readonly currentPhase: string;
  /** Whether the current phase started with fresh context (new query) */
  readonly currentPhaseFreshContext: boolean;
  /** Read a value from the shared store (published by upstream middleware) */
  get<T>(key: string): T | undefined;
}

/** Write handle for middleware to publish data to the shared store */
export interface MiddlewareStore {
  set(key: string, value: unknown): void;
}

/** Lifecycle hooks a middleware can implement */
export interface Middleware {
  /** Unique name for this middleware (used in config and store keys) */
  readonly name: string;
  /** Called once when the pipeline initializes */
  onInit?(ctx: MiddlewareContext): void;
  /** Called for every SDK message */
  onMessage?(
    message: SDKMessage,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void;
  /** Called when a phase transition is detected */
  onPhaseTransition?(
    fromPhase: string,
    toPhase: string,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void;
  /** Called at the end of the agent run. Return value from last middleware is used. */
  onFinalize?(
    resultMessage: SDKMessage,
    totalDurationMs: number,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): unknown;
}

/** Options bag passed to middleware factories during construction */
export interface MiddlewareFactoryOptions {
  spinner?: SpinnerHandle;
  outputPath?: string;
  phased?: boolean;
}
