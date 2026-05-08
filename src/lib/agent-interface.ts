/**
 * Shared agent interface for Amplitude wizards
 * Uses Claude Agent SDK directly with Amplitude LLM gateway
 */

import path from 'path';
import * as fs from 'fs';
import { getUI, type SpinnerHandle } from '../ui';
import { debug, logToFile, initLogFile, getLogFilePath } from '../utils/debug';
import type { WizardOptions } from '../utils/types';
import { analytics, captureWizardError } from '../utils/analytics';
import {
  AMPLITUDE_PROPERTY_HEADER_PREFIX,
  DEFAULT_AMPLITUDE_ZONE,
  WIZARD_VARIANT_FLAG_KEY,
  WIZARD_VARIANTS,
  WIZARD_USER_AGENT,
} from './constants';
import {
  GATEWAY_INVALID_REQUEST_MARKER,
  extractApiErrorHttpStatusFromPattern,
  extractHttpStatusLooseFromMessage,
  findTransientSdkOutputPattern,
  isPayloadShapeRejection,
  isThrownErrorCountedAsUpstreamGatewayFailure,
  isTransientThrownSdkErrorMessage,
  parseStructuredUpstreamError,
  computeRetryBackoffMs,
  getRetryBudget,
} from './agent/transient-llm-retry.js';
import {
  AuthOnboardingPath,
  type AdditionalFeature,
  ADDITIONAL_FEATURE_PROMPTS,
  TRAILING_FEATURES,
  type RetryState,
} from './wizard-session';
import { registerCleanup, getWizardAbortSignal } from '../utils/wizard-abort';
import { createCustomHeaders } from '../utils/custom-headers';
import {
  getHostFromRegion,
  getLlmGatewayUrlFromHost,
  getMcpUrlFromZone,
} from '../utils/urls';
import { getStoredToken, getStoredUser } from '../utils/ampli-settings';
import {
  getDashboardFile,
  getEventsFile,
  pickFreshestExisting,
} from '../utils/storage-paths';
import {
  startDualPathWatcher,
  type DualPathWatcherHandle,
} from './dual-path-watcher';
import {
  AgentState,
  buildRecoveryNote,
  buildRetryHint,
  consumeSnapshot,
} from './agent-state';
import { createInnerLifecycleHooks } from './inner-lifecycle';
import { classifyWriteOperation, truncateLogMessage } from './agent-events';
import {
  createWizardToolsServer,
  isWizardPromptActive,
  onWizardPromptRelease,
  persistDashboard,
  resolveWizardAllowedToolNames,
  type StatusReport,
  type StatusReporter,
} from './wizard-tools';
import { parseEventPlanContent } from './event-plan-parser.js';
import {
  noteFeedbackReinjection,
  shouldReinjectFeedbackPrompt,
} from './agent/event-plan-feedback-state.js';
import {
  createPreToolUseHook,
  evaluateCanUseToolFileLogging,
  redactToolLogPayload,
  wizardCanUseTool,
} from './agent/tool-policy.js';
import { getWizardCommandments } from './commandments';
import {
  classifyToolEvent,
  type JourneyStepId,
  type JourneyStatus,
} from './journey-state';
import { sanitizeNestedClaudeEnv } from './sanitize-claude-env';
import { applyScopedSettings } from './claude-settings-scope';
import { scanWriteContentForSecrets } from './safety-scanner';
import type { PackageManagerDetector } from './package-manager-detection';

import { z } from 'zod';
import type { SDKMessage } from './middleware/types';
import { safeParseSDKMessage } from './middleware/schemas';
import { createStormAnchor } from './middleware/retry';
import {
  type HookCallback,
  type HookCallbackMatcher,
  type HookEvent,
  buildHooksConfig,
} from './agent-hooks';
import { getAgentDriver } from './agent-driver';
import { buildGatewaySanitizeNodeOptions } from './gateway-fetch-sanitize-node-options.js';
import {
  enforceAiSdkProbeStrict,
  maybeRunAiSdkGatewayProbe,
} from './agent/ai-sdk-gateway-probe.js';
import { sdkStandardFallbackModel, selectModel } from './agent/model-config.js';
import { buildSkillTierSystemPromptAppend } from './agent/skill-tier-prompt.js';

export { selectModel, sdkStandardFallbackModel };
export { parseEventPlanContent };
export {
  MAX_BASH_SLEEP_SECONDS,
  MAX_CONSECUTIVE_BASH_DENIES,
  createPreToolUseHook,
  wizardCanUseTool,
  isSkillInstallCommand,
  matchesAllowedPrefix,
  isSafeBackgroundedInstall,
  redactToolLogPayload,
} from './agent/tool-policy.js';
export type { PreToolUseHookOptions } from './agent/tool-policy.js';

/**
 * Mirror of @anthropic-ai/claude-agent-sdk ThinkingConfig. We mirror locally
 * because the SDK is dynamically imported elsewhere (ESM/CJS interop).
 *
 * - `'enabled'` + budgetTokens — fixed per-turn thinking budget. Required for
 *   Sonnet 4.6 and other non-adaptive models.
 * - `'adaptive'` — model decides depth (Opus 4.6+ only).
 * - `'disabled'` — turn off extended thinking.
 *
 * `display: 'summarized'` keeps NDJSON / agent-mode output readable; without
 * it raw thinking blocks bloat the transcript.
 */
type SDKThinkingConfig =
  | {
      type: 'enabled';
      budgetTokens: number;
      display?: 'summarized' | 'omitted';
    }
  | { type: 'adaptive'; display?: 'summarized' | 'omitted' }
  | { type: 'disabled' };

type SDKQueryOptions = {
  model?: string;
  fallbackModel?: string;
  cwd?: string;
  permissionMode?: string;
  mcpServers?: McpServersConfig;
  settingSources?: string[];
  allowedTools?: string[];
  /**
   * Tool names removed from the model's prompt entirely (schema not loaded).
   * Used by the Amplitude MCP tool-surface cap to drop ~60 unused tools'
   * JSONSchema (~15-18K tokens) from every turn's prefix. See
   * `AMPLITUDE_MCP_TOOL_ALLOWLIST` and `buildAmplitudeMcpDisallowedTools`.
   */
  disallowedTools?: string[];
  systemPrompt?: unknown;
  env?: Record<string, string | undefined>;
  canUseTool?: (toolName: string, input: unknown) => Promise<unknown>;
  tools?: unknown;
  stderr?: (data: string) => void;
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  abortSignal?: AbortSignal;
  maxTurns?: number;
  thinking?: SDKThinkingConfig;
  /**
   * Anthropic API beta headers. Used to opt into the 1M context window via
   * `'context-1m-2025-08-07'`. The SDK's own `Options.betas` is typed as
   * `SdkBeta[]`; we accept plain strings here to avoid a hard import of an
   * SDK-internal type.
   */
  betas?: string[];
  /**
   * When true, the SDK emits `SDKPartialAssistantMessage` envelopes carrying
   * `content_block_delta` events as the model streams its response. The
   * wizard intercepts these in the for-await loop to surface text deltas in
   * the status pill so the user sees the model's voice during long tool
   * calls. See `enqueueStreamDelta` below.
   */
  includePartialMessages?: boolean;
};

type SDKQueryFn = (params: {
  prompt: string | AsyncIterable<unknown>;
  options?: SDKQueryOptions;
}) => AsyncIterable<unknown>;

// Backed by the AgentDriver port (see `./agent-driver`). Keeps the historical
// `{ query }` shape so the rest of this file is untouched. Tests override the
// driver via `setAgentDriver` and the next call here picks it up — no SDK
// import is ever performed under a test override.
async function getSDKModule(): Promise<{ query: SDKQueryFn }> {
  const driver = await getAgentDriver();
  return { query: driver as unknown as SDKQueryFn };
}

/**
 * Get the path to the bundled Claude Code CLI from the SDK package.
 * This ensures we use the SDK's bundled version rather than the user's installed Claude Code.
 */
function getClaudeCodeExecutablePath(): string {
  // require.resolve finds the package's main entry, then we get cli.js from same dir
  const sdkPackagePath = require.resolve('@anthropic-ai/claude-agent-sdk');
  return path.join(path.dirname(sdkPackagePath), 'cli.js');
}

type McpServersConfig = Record<string, unknown>;

/**
 * Mutate the Amplitude MCP server entry in an `McpServersConfig` so its
 * `Authorization` header reflects a freshly-rotated bearer. The SDK reads
 * `mcpServers` once per `query()` call and serializes it into the spawned
 * subprocess's CLI args; without re-stamping the header here, a token
 * rotation between retries leaves the subprocess pinned to the OLD bearer
 * and every Amplitude MCP request 401s until reconnection.
 *
 * Idempotent and defensive: silently no-ops when the entry doesn't exist
 * (e.g. `skipAmplitudeMcp` runs) or the shape isn't what we expect (custom
 * test mocks, future SDK config changes). Exported only for unit testing.
 *
 * Returns true when a header was actually rotated — useful for tests and
 * for asserting telemetry-worthy events.
 */
export function updateAmplitudeMcpBearer(
  mcpServers: McpServersConfig,
  newToken: string,
): boolean {
  const entry = mcpServers['amplitude-wizard'];
  if (!entry || typeof entry !== 'object') return false;
  const headers = (entry as { headers?: Record<string, unknown> }).headers;
  if (!headers || typeof headers !== 'object') return false;
  headers.Authorization = `Bearer ${newToken}`;
  return true;
}

export const AgentSignals = {
  /**
   * Signal emitted when the agent provides a remark about its run.
   * Kept as a text marker because it bookends a multi-line reflection that
   * the model writes into its final message; structured tool-call routing
   * doesn't fit the free-form nature of the reflection payload.
   */
  WIZARD_REMARK: '[WIZARD-REMARK]',
  /** Signal prefix for benchmark logging */
  BENCHMARK: '[BENCHMARK]',
} as const;

export type AgentSignal = (typeof AgentSignals)[keyof typeof AgentSignals];

/**
 * Error types that can be returned from agent execution.
 * These correspond to the error signals that the agent emits.
 */
export enum AgentErrorType {
  /** Agent could not access the Amplitude MCP server */
  MCP_MISSING = 'WIZARD_MCP_MISSING',
  /** Agent could not access the setup resource */
  RESOURCE_MISSING = 'WIZARD_RESOURCE_MISSING',
  /** API rate limit exceeded */
  RATE_LIMIT = 'WIZARD_RATE_LIMIT',
  /** Generic API error */
  API_ERROR = 'WIZARD_API_ERROR',
  /** Authentication failed — bearer token invalid or expired */
  AUTH_ERROR = 'WIZARD_AUTH_ERROR',
  /**
   * Every retry attempt failed with the same upstream-gateway signature
   * (400 terminated / DEADLINE_EXCEEDED). Indicates the Amplitude LLM
   * gateway or its Vertex backend is unhealthy — not a wizard bug. The
   * runner surfaces a specific actionable message including the
   * ANTHROPIC_API_KEY bypass workaround.
   */
  GATEWAY_DOWN = 'WIZARD_GATEWAY_DOWN',
  /**
   * Thunder's `wizard-proxy` returned the verbatim wrapper string
   * `"Invalid request sent to model provider"` — a 400 from Vertex AI
   * (Anthropic publisher endpoint) caused by a payload field Vertex
   * does not accept. The most common causes are an `anthropic-beta`
   * value Vertex doesn't honor (e.g. `context-1m-2025-08-07`) or
   * `tools[].input_schema` keys Vertex's stricter JSON Schema
   * validator rejects (`$schema`, `additionalProperties`,
   * `exclusiveMinimum`, `exclusiveMaximum`).
   *
   * Retrying with the same payload is guaranteed to fail again, so the
   * runner short-circuits the retry loop and surfaces a remediation
   * message that points users at upgrading to a wizard build with the
   * fix (and at the `ANTHROPIC_API_KEY` direct-API workaround in the
   * meantime).
   */
  GATEWAY_INVALID_REQUEST = 'WIZARD_GATEWAY_INVALID_REQUEST',
}

const DEFAULT_MAX_TURNS = 200;
/**
 * Upper sanity bound on AMPLITUDE_WIZARD_MAX_TURNS. A real run almost never
 * needs more than a few hundred turns; anything north of this is far more
 * likely to be a fat-fingered env var or shell expansion bug than a
 * legitimate cap. We refuse rather than letting the agent loop unboundedly.
 */
const MAX_TURNS_SANITY_BOUND = 10000;

/** Parse AMPLITUDE_WIZARD_MAX_TURNS as a positive integer within the sanity
 * bound. Falls back to the default on any invalid value (empty, non-numeric,
 * zero, negative, or larger than {@link MAX_TURNS_SANITY_BOUND}) so bad env
 * state can't DoS the agent. */
export function resolveMaxTurns(
  envValue: string | undefined = process.env.AMPLITUDE_WIZARD_MAX_TURNS,
): number {
  if (!envValue) return DEFAULT_MAX_TURNS;
  const parsed = Number.parseInt(envValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_TURNS;
  if (parsed > MAX_TURNS_SANITY_BOUND) return DEFAULT_MAX_TURNS;
  return parsed;
}

// Active StatusReporter slot. runAgent sets this at the start of each attempt
// and clears it afterwards so the in-process wizard-tools `report_status` tool
// can route structured events back into the per-run state bag.
let _activeStatusReporter: StatusReporter | undefined;

export type AgentConfig = {
  workingDirectory: string;
  amplitudeMcpUrl: string;
  amplitudeApiKey: string;
  amplitudeBearerToken: string;
  amplitudeApiHost: string;
  additionalMcpServers?: Record<string, { url: string }>;
  detectPackageManager: PackageManagerDetector;
  /** Feature flag key -> variant (evaluated at start of run). */
  wizardFlags?: Record<string, string>;
  wizardMetadata?: Record<string, string>;
  /** When true, omit the amplitude-wizard MCP server (e.g. for generic/quickstart path). */
  skipAmplitudeMcp?: boolean;
  /** Remote skills URL. When set, skills are downloaded instead of using bundled copies. */
  skillsBaseUrl?: string;
  /**
   * Internal agent model tier — see `docs/internal/agent-mode-flag.md`.
   * Threaded from `WizardSession.mode` via `agent-runner.ts`.
   * Undefined defaults to `'standard'` (the wizard's default model).
   */
  mode?: import('../utils/types').WizardMode;
  /**
   * UUID v4 that groups all `/v1/messages` calls in this wizard run into one
   * Agent Analytics session. Sourced from `WizardSession.agentSessionId`,
   * forwarded to the Amplitude LLM gateway as the `x-amp-wizard-session-id`
   * header (via `ANTHROPIC_CUSTOM_HEADERS`). Without this, the proxy falls back
   * to a per-token-hash session ID, which collapses every wizard run a user
   * ever does into a single session.
   */
  agentSessionId?: string;
  /**
   * Whether the active framework targets the browser. Mirrors
   * `FrameworkConfig.metadata.targetsBrowser`. Used to gate browser-only
   * commandment blocks (autocapture defaults, browser SDK init template)
   * so mobile/server/generic runs don't carry that content in their
   * system prompt every turn. Undefined = treat as non-browser.
   */
  targetsBrowser?: boolean;
  /**
   * Free-form context the outer orchestrator wants prepended to every
   * turn. Sourced from `WizardSession.orchestratorContext` (which the
   * CLI populates from `--context-file <path>` /
   * `AMPLITUDE_WIZARD_CONTEXT`). Threaded through to `AgentRunConfig`
   * so the systemPrompt builder can append it after the commandments.
   * Undefined / empty when no context was provided.
   */
  orchestratorContext?: string;
};

/**
 * Returns true when an SDK message is the "I'm about to wait on the
 * upstream API" envelope rather than actual progress.
 *
 * The Claude Agent SDK emits `system { subtype: 'status', status:
 * 'requesting' }` immediately *before* it sends a request to the model
 * — it means "request issued, now waiting for the first byte." It is
 * NOT model output, NOT tool output, and NOT an SDK retry. Treating it
 * as progress (resetting the stall timer when it arrives) masks
 * gateway hangs: when the upstream goes silent, the timer was just
 * reset to its full window from a non-event, so users wait the full
 * STALL_TIMEOUT_MS past when the upstream actually hung.
 *
 * Other `system` subtypes (`init`, `api_retry`, `compact_boundary`,
 * etc.) ARE real progress events — keep treating them as resets.
 *
 * Exported so unit tests can pin the classification without spinning
 * up the full agent runtime.
 */
export function isStallNonProgressMessage(rawMessage: unknown): boolean {
  if (!rawMessage || typeof rawMessage !== 'object') return false;
  const msg = rawMessage as Record<string, unknown>;

  // Class 1 — SDK status envelopes. The SDK type union is
  //   SDKStatus = 'compacting' | 'requesting' | null
  // 'compacting' is the only one that means "real work is happening";
  // everything else (current 'requesting' / null, plus any future
  // shape we don't recognize yet) is conservatively non-progress.
  if (msg.type === 'system' && msg.subtype === 'status') {
    return msg.status !== 'compacting';
  }

  // Class 2 — stream_event book-keeping frames. Under
  // `includePartialMessages: true`, the SDK emits six stream_event
  // subtypes; only `content_block_delta` carries real model output
  // (text deltas, input_json deltas, thinking deltas). The other
  // five (message_start / message_delta / message_stop /
  // content_block_start / content_block_stop) are framing that flanks
  // real deltas by milliseconds in the happy path — treating them as
  // non-progress tightens the timer's signal-to-noise without risking
  // false stalls during legitimate generation.
  if (msg.type === 'stream_event') {
    const event = msg.event;
    if (event === null || typeof event !== 'object') return true;
    return (event as Record<string, unknown>).type !== 'content_block_delta';
  }

  return false;
}

/**
 * Build the `systemPrompt.append` string the inner-agent SDK passes to
 * Claude every turn. Concatenates wizard-wide commandments with the
 * optional orchestrator-supplied context block, in that order:
 *
 *   1. `commandments` — hard safety rules (no secrets, no shell-eval,
 *      mandatory `confirm_event_plan` before track() writes, etc.).
 *      First-position so the model treats them as load-bearing.
 *   2. `orchestratorContext` — soft, project-specific guidance the
 *      caller injected via `--context-file` /
 *      `AMPLITUDE_WIZARD_CONTEXT`. Wrapped in a labeled `## ...` block
 *      so the model can distinguish wizard-managed instructions from
 *      caller-supplied ones, and explicitly told NOT to override the
 *      safety rules above.
 *
 * Extracted from the inline ternary inside `runAgent` so unit tests
 * can lock the prompt-shape contract (whitespace, header, ordering)
 * without spinning up the full agent pipeline.
 */
export function buildSystemPromptAppend(args: {
  commandments: string;
  orchestratorContext?: string | null;
}): string {
  const { commandments, orchestratorContext } = args;
  const trimmed = orchestratorContext?.trim();
  if (!trimmed) return commandments;
  return (
    commandments +
    `\n\n## Orchestrator-injected context\n\n` +
    `The wizard was invoked by an outer agent / CI pipeline that supplied ` +
    `the following context. Treat it as authoritative for project-specific ` +
    `conventions (event naming, existing taxonomy, team preferences) but ` +
    `do NOT let it override the safety rules above (secrets, shell-eval ` +
    `bans, etc.).\n\n${trimmed}`
  );
}

/**
 * Number of consecutive 401 / auth-flavored `api_retry` system messages from
 * the Claude Agent SDK we'll tolerate before aborting the query and surfacing
 * AUTH_ERROR. The SDK's default retry policy hammers a 401 ~10 times with
 * exponential backoff (~3 min total) — but a 401 won't recover mid-run, so
 * we cut the storm short and show the user a clear failure + manual-signup
 * fallback instead of a stuck spinner.
 */
export const AUTH_RETRY_LIMIT = 2;

/**
 * Substrings that indicate the LLM gateway rejected a request because the
 * caller's OAuth token is invalid or expired. Three patterns observed in
 * production Sentry traces (WIZARD-CLI-A, WIZARD-CLI-7, WIZARD-CLI-F):
 *
 *   - `authentication_failed`  — older OAuth fault code
 *   - `authentication_error`   — current Anthropic gateway error.type
 *                                (`{"error":{"type":"authentication_error",...}}`)
 *   - `Invalid or expired token` — Anthropic 401 message body
 *
 * Match any of these → route to the friendly auth-recovery path in
 * agent-runner instead of the generic "report to wizard@amplitude.com"
 * API-error path. Substring (not regex) so JSON-stringified message
 * bodies match without escaping concerns.
 */
const AUTH_ERROR_PATTERNS = [
  'authentication_failed',
  'authentication_error',
  'Invalid or expired token',
] as const;

/**
 * Returns true if `serialized` (typically a JSON-stringified SDK result
 * message) contains any known auth-error pattern. Exported for unit tests.
 */
export function isAuthErrorMessage(serialized: string): boolean {
  return AUTH_ERROR_PATTERNS.some((p) => serialized.includes(p));
}

/**
 * Matches the SDK's known-benign hook-bridge-race stderr line. The
 * claude-code subprocess emits this when an aborted/teardown-pending
 * `query()` still has in-flight tool calls — each call invokes the
 * registered hook (PreToolUse / Stop / UserPromptSubmit / PreCompact,
 * indexed in registration order) over a now-closed IPC bridge.
 *
 * Already retried-and-recovered upstream (see `drainPriorResponse`
 * + the `'Stream closed'` arm of the transient-error retry list in
 * `runAgent`). The stderr handler filters lines matching this pattern
 * and logs a one-line suppression count at attempt boundary; everything
 * else (genuine subprocess crashes, MCP server stderr, etc.) still
 * flows through.
 *
 * Anchored with `^...$` so a chunk containing both a race line AND a
 * genuine error keeps the genuine error — the partition helper splits
 * chunks line-by-line before testing.
 *
 * Exported for unit tests. See issue #297.
 */
export const HOOK_BRIDGE_RACE_RE =
  /^Error in hook callback hook_\d+: Error: Stream closed$/;

/**
 * Splits a raw stderr chunk into the count of suppressed
 * hook-bridge-race lines and the remaining text that should still be
 * logged.
 *
 * Why partition instead of `regex.test(data) → return`: the SDK's
 * stderr callback receives raw byte chunks from the subprocess pipe.
 * Multiple stderr writes can be batched into a single chunk, so a
 * chunk-level match would drop genuine errors riding alongside the
 * race-line noise. We split on `\n`, suppress only matching lines,
 * and reconstruct the rest preserving the original chunk's trailing
 * newline behavior.
 *
 * Exported for unit tests.
 */
export function partitionHookBridgeRace(data: string): {
  suppressed: number;
  passthrough: string;
} {
  if (data.length === 0) return { suppressed: 0, passthrough: '' };
  const hadTrailingNewline = data.endsWith('\n');
  const lines = data.split('\n');
  if (hadTrailingNewline) lines.pop(); // drop the empty trailing element
  let suppressed = 0;
  const kept: string[] = [];
  for (const line of lines) {
    if (HOOK_BRIDGE_RACE_RE.test(line)) {
      suppressed++;
      continue;
    }
    kept.push(line);
  }
  if (kept.length === 0) return { suppressed, passthrough: '' };
  return {
    suppressed,
    passthrough: kept.join('\n') + (hadTrailingNewline ? '\n' : ''),
  };
}

/**
 * Anthropic stream-event protocol shapes that leak through the CLI when
 * verbose / stream-json output is enabled. The wizard never needs these —
 * the SDK message stream provides the structured events we act on, while
 * these raw protocol frames just bury real activity under thousands of
 * `partial_json` deltas per turn (the in-app Logs tab quickly hits 10k+
 * lines of noise). Used by both `runAgentLocally` (subprocess stdout) and
 * the SDK path (subprocess stderr passthrough).
 */
const STREAM_EVENT_TYPES: ReadonlySet<string> = new Set([
  'message_start',
  'message_delta',
  'message_stop',
  'content_block_start',
  'content_block_delta',
  'content_block_stop',
  'ping',
  'stream_event',
]);
const STREAM_EVENT_JSON_PREFIXES: readonly string[] = Array.from(
  STREAM_EVENT_TYPES,
).map((t) => `{"type":"${t}"`);
const STREAM_EVENT_SSE_EVENT_PREFIXES: readonly string[] = Array.from(
  STREAM_EVENT_TYPES,
).map((t) => `event: ${t}`);
const STREAM_EVENT_SSE_DATA_PREFIXES: readonly string[] = Array.from(
  STREAM_EVENT_TYPES,
).map((t) => `data: {"type":"${t}"`);

/**
 * True if `line` is Anthropic stream-event protocol noise. Matches both
 * bare JSON (`{"type":"content_block_delta",...}`) and raw SSE framing
 * (`event: content_block_delta` / `data: {"type":"content_block_delta",...}`).
 * `JSON.parse` only succeeds on complete lines, so the prefix check is the
 * primary defense against partial-line chunks. Exported for unit tests.
 */
export function looksLikeStreamEventLine(line: string): boolean {
  const trimmed = line.trimStart();
  if (trimmed.length < 9) return false;
  const first = trimmed[0];
  if (first === '{') {
    for (const prefix of STREAM_EVENT_JSON_PREFIXES) {
      if (trimmed.startsWith(prefix)) return true;
    }
    try {
      const obj = JSON.parse(trimmed) as { type?: unknown };
      return typeof obj.type === 'string' && STREAM_EVENT_TYPES.has(obj.type);
    } catch {
      return false;
    }
  }
  if (first === 'e') {
    for (const prefix of STREAM_EVENT_SSE_EVENT_PREFIXES) {
      if (trimmed.startsWith(prefix)) return true;
    }
  }
  if (first === 'd') {
    for (const prefix of STREAM_EVENT_SSE_DATA_PREFIXES) {
      if (trimmed.startsWith(prefix)) return true;
    }
  }
  return false;
}

/**
 * Strip stream-event protocol lines from a raw chunk while preserving
 * everything else (and the chunk's trailing-newline behavior). Mirrors
 * `partitionHookBridgeRace`: chunk-level filtering would drop genuine
 * errors that happened to ride alongside protocol noise in the same
 * batched stderr write, so we split on `\n`, drop only matching lines,
 * and reconstruct. Exported for unit tests.
 */
export function stripStreamEventNoise(data: string): {
  suppressed: number;
  passthrough: string;
} {
  if (data.length === 0) return { suppressed: 0, passthrough: '' };
  const hadTrailingNewline = data.endsWith('\n');
  const lines = data.split('\n');
  if (hadTrailingNewline) lines.pop();
  let suppressed = 0;
  const kept: string[] = [];
  for (const line of lines) {
    if (looksLikeStreamEventLine(line)) {
      suppressed++;
      continue;
    }
    kept.push(line);
  }
  if (kept.length === 0) return { suppressed, passthrough: '' };
  return {
    suppressed,
    passthrough: kept.join('\n') + (hadTrailingNewline ? '\n' : ''),
  };
}

/**
 * Prompt injected by the Stop hook when the most recent
 * `confirm_event_plan` decision was `feedback` and the agent has not
 * called the tool again. Tells the agent to revise IN-PROCESS — without
 * asking the user questions — and re-call the tool. Exported so tests
 * can assert the exact wording without duplicating it.
 */
export const EVENT_PLAN_FEEDBACK_REINJECTION_PROMPT =
  'Your last `confirm_event_plan` returned user feedback that you have not acted on. Revise the event plan based on the feedback and call `confirm_event_plan` again. Do NOT ask the user clarifying questions — make a reasonable interpretation. The user can give more feedback in the next round.';

/**
 * Create a stop hook callback that handles unresolved event-plan feedback,
 * drains the additional feature queue, then collects a remark, then allows
 * stop.
 *
 * Phase order (closure state):
 *   Phase 0 — feedback re-prompt (≤1×): if `confirm_event_plan` last
 *             returned user feedback that the agent never acted on,
 *             block with a reminder to revise and re-call the tool.
 *             Capped at one re-injection per session so a stuck agent
 *             can't infinite-loop the run.
 *   Phase 1 — drain queue: block with each feature prompt in order
 *   Phase 2 — collect remark (once): block with WIZARD-REMARK prompt
 *   Phase 3 — allow stop: return {}
 *
 * If `isAuthError()` returns true, all phases are skipped and stop is
 * allowed immediately — the agent cannot respond when auth has failed.
 *
 * `progress` hooks let the TUI render queued features as task items:
 * `onFeatureStart` fires when a feature is dequeued; `onFeatureComplete`
 * fires when the next stop signal arrives (i.e. the agent finished it).
 */
export function createStopHook(
  getFeatureQueue: () => readonly AdditionalFeature[],
  isAuthError: () => boolean = () => false,
  progress?: {
    onFeatureStart?: (feature: AdditionalFeature) => void;
    onFeatureComplete?: (feature: AdditionalFeature) => void;
  },
): HookCallback {
  let featureIndex = 0;
  let remarkRequested = false;
  let activeFeature: AdditionalFeature | null = null;

  return (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const stop_hook_active = input.stop_hook_active as boolean;
    const featureQueue = getFeatureQueue().filter((f) =>
      TRAILING_FEATURES.has(f),
    );
    logToFile('Stop hook triggered', {
      stop_hook_active,
      featureIndex,
      remarkRequested,
      queueLength: featureQueue.length,
    });

    // If an auth error occurred, allow stop immediately — the agent cannot
    // make further API calls to process feature prompts or reflection requests.
    if (isAuthError()) {
      logToFile('Stop hook: allowing stop (auth error detected)');
      return Promise.resolve({});
    }

    // Phase 0: unresolved confirm_event_plan feedback
    //
    // The most recent `confirm_event_plan` call returned user feedback,
    // but the agent has not called the tool again with a revised plan.
    // Without this branch the run advances to the WIZARD-REMARK phase
    // and concludes with no events.json persisted, losing both the
    // proposed plan AND the user's feedback. Inject a focused prompt
    // telling the agent to revise IN-PROCESS rather than asking the
    // user questions the wizard has no surface to answer.
    //
    // Capped at one re-injection per unresolved-feedback record (the
    // singleton in `event-plan-feedback-state.ts` enforces the cap).
    // After the cap, fall through to the normal remark / allow-stop
    // sequence so the run can actually conclude — the outro safety net
    // in agent-runner.ts will persist the draft so the user can resume.
    if (shouldReinjectFeedbackPrompt()) {
      noteFeedbackReinjection();
      logToFile(
        'Stop hook: injecting confirm_event_plan feedback re-prompt (unresolved feedback)',
      );
      return Promise.resolve({
        decision: 'block',
        reason: EVENT_PLAN_FEEDBACK_REINJECTION_PROMPT,
      });
    }

    // The previous feature (if any) just finished — mark it complete before
    // dequeuing the next one or moving on to the remark phase.
    if (activeFeature) {
      progress?.onFeatureComplete?.(activeFeature);
      activeFeature = null;
    }

    // Phase 1: drain feature queue
    if (featureIndex < featureQueue.length) {
      const feature = featureQueue[featureIndex++];
      const prompt = ADDITIONAL_FEATURE_PROMPTS[feature];
      activeFeature = feature;
      progress?.onFeatureStart?.(feature);
      logToFile(`Stop hook: injecting feature prompt for ${feature}`);
      return Promise.resolve({ decision: 'block', reason: prompt });
    }

    // Phase 2: collect remark (once)
    if (!remarkRequested) {
      remarkRequested = true;
      logToFile('Stop hook: requesting reflection');
      return Promise.resolve({
        decision: 'block',
        reason: `Before concluding, provide a brief remark about what information or guidance would have been useful to have in the integration prompt or documentation for this run. Specifically cite anything that would have prevented tool failures, erroneous edits, or other wasted turns. Format your response exactly as: ${AgentSignals.WIZARD_REMARK} Your remark here`,
      });
    }

    // Phase 3: allow stop
    logToFile('Stop hook: allowing stop');
    return Promise.resolve({});
  };
}

/**
 * Builds a PreCompact hook callback that fires just before the SDK compacts
 * the conversation history. The callback is purely observational — the SDK
 * does not let us alter the compacted summary — but firing here gives us:
 *
 *   1. Crash safety: persists the latest wizard checkpoint so a compaction
 *      crash doesn't leave the user without a resumable state.
 *   2. Diagnostics: file-log + analytics every compaction, with the trigger
 *      ('manual' | 'auto'), so we can correlate "agent forgot something"
 *      reports with actual compactions.
 *
 * The handler is wrapped in try/catch — a hook that throws would otherwise
 * abort the compaction and tank the run.
 */
export function createPreCompactHook(
  handler: (input: { trigger: 'manual' | 'auto' }) => void,
): HookCallback {
  return (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const trigger =
      input.trigger === 'manual' || input.trigger === 'auto'
        ? input.trigger
        : 'auto';
    logToFile('PreCompact hook triggered', { trigger });
    try {
      handler({ trigger });
    } catch (err) {
      // Never let a hook error break the compaction — log and move on.
      logToFile('PreCompact handler threw:', err);
    }
    return Promise.resolve({});
  };
}

/**
 * Factory: UserPromptSubmit hook — hydrates recovery context after a
 * compaction.
 *
 * If a PreCompact snapshot exists at `state.snapshotPath()`, the hook
 * consumes it (reads + deletes) and returns `additionalContext` that
 * prepends a short recovery note listing modified files and the last
 * status. The snapshot is deleted so hydration fires at most once per
 * compaction cycle.
 *
 * When no snapshot exists (first turn, or no compaction has happened) the
 * hook is a no-op and returns `{}` so the SDK uses the prompt unchanged.
 */
export function createUserPromptSubmitHook(state: AgentState): HookCallback {
  return (
    _input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const snap = consumeSnapshot(state.snapshotPath());
    if (!snap) return Promise.resolve({});

    const note = buildRecoveryNote(snap);
    logToFile(
      `UserPromptSubmit: hydrated recovery note (${snap.modifiedFiles.length} files, compactionCount=${snap.compactionCount})`,
    );
    return Promise.resolve({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: note,
      },
    });
  };
}

/**
 * Replace a large Read tool output with a head + tail snippet so the
 * model's history doesn't carry 30+ K tokens of file content forward
 * for the rest of the run. Returns null when the tool isn't Read or
 * the response is small enough to leave alone.
 *
 * Why deterministic instead of summarizing via Haiku: the agent already
 * has the path on disk and can re-Read with `offset` / `limit` if it
 * needs more. Paying a Haiku call to summarize content the model can
 * fetch on demand is strictly worse than truncating with a hint.
 */
const READ_TOOL_NAMES = new Set(['Read']);
const READ_TRUNCATE_THRESHOLD = 8 * 1024;
const READ_HEAD_BYTES = 3 * 1024;
const READ_TAIL_BYTES = 1 * 1024;
function maybeTruncateLargeRead(input: Record<string, unknown>): {
  updatedToolOutput: { type: 'text'; text: string }[];
  /** Bytes the model is no longer carrying for the rest of the run. */
  savedBytes: number;
} | null {
  const toolName =
    typeof input.tool_name === 'string'
      ? input.tool_name
      : typeof input.toolName === 'string'
      ? input.toolName
      : '';
  if (!READ_TOOL_NAMES.has(toolName)) return null;

  // tool_response can be a string (legacy SDKs), an object with a
  // `content` string, or an array of content blocks. Unwrap defensively
  // — anything we can't recognize is left alone so the agent gets the
  // original SDK output. tool_input is referenced for the file path so
  // we can hint the model toward re-reading with offset/limit.
  const response =
    'tool_response' in input
      ? input.tool_response
      : (input as { toolResponse?: unknown }).toolResponse;

  let text: string | null = null;
  if (typeof response === 'string') {
    text = response;
  } else if (response && typeof response === 'object') {
    const c = (response as { content?: unknown }).content;
    if (typeof c === 'string') {
      text = c;
    } else if (Array.isArray(c)) {
      const joined = c
        .map((block) => {
          if (block && typeof block === 'object') {
            const t = (block as { text?: unknown }).text;
            return typeof t === 'string' ? t : '';
          }
          return '';
        })
        .join('\n');
      if (joined.length > 0) text = joined;
    }
  }
  if (text === null || text.length <= READ_TRUNCATE_THRESHOLD) return null;

  const toolInput =
    'tool_input' in input
      ? input.tool_input
      : (input as { toolInput?: unknown }).toolInput;
  const filePath =
    toolInput && typeof toolInput === 'object'
      ? typeof (toolInput as { file_path?: unknown }).file_path === 'string'
        ? (toolInput as { file_path: string }).file_path
        : typeof (toolInput as { path?: unknown }).path === 'string'
        ? (toolInput as { path: string }).path
        : null
      : null;

  const head = text.slice(0, READ_HEAD_BYTES);
  const tail = text.slice(text.length - READ_TAIL_BYTES);
  const middleBytes = text.length - head.length - tail.length;
  const lineCount = text.split('\n').length;
  const pathHint = filePath ? ` ${filePath}` : '';
  const bridge =
    `\n\n[… ${middleBytes.toLocaleString()} bytes omitted from middle. ` +
    `Original file:${pathHint} (${lineCount.toLocaleString()} lines, ` +
    `${text.length.toLocaleString()} bytes). ` +
    `Re-read with Read({ offset, limit }) for any specific range. …]\n\n`;
  const updatedText = head + bridge + tail;
  return {
    updatedToolOutput: [{ type: 'text', text: updatedText }],
    savedBytes: text.length - updatedText.length,
  };
}

/**
 * Factory: PostToolUse hook — records the file path of every successful
 * write-tool call (Write / Edit / MultiEdit / NotebookEdit) into the
 * provided AgentState. The recovery snapshot persisted by `createPreCompactHook`
 * relies on this list so the post-compaction UserPromptSubmit hydration
 * can tell the model which files it has already modified in the run.
 *
 * Wrapped in try/catch — a throwing hook would otherwise tank the run.
 * No-op for non-write tools.
 */
export function createPostToolUseHook(state: AgentState): HookCallback {
  return (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    let secretWarning: string | null = null;
    try {
      const toolName =
        typeof input.tool_name === 'string'
          ? input.tool_name
          : typeof input.toolName === 'string'
          ? input.toolName
          : '';
      if (!classifyWriteOperation(toolName)) return Promise.resolve({});

      const toolInput =
        typeof input.tool_input !== 'undefined'
          ? input.tool_input
          : typeof input.toolInput !== 'undefined'
          ? input.toolInput
          : null;
      const obj =
        toolInput && typeof toolInput === 'object'
          ? (toolInput as Record<string, unknown>)
          : {};
      const path =
        typeof obj.file_path === 'string'
          ? obj.file_path
          : typeof obj.path === 'string'
          ? obj.path
          : null;
      if (path) {
        state.recordModifiedFile(path);
        logToFile(`PostToolUse: recorded modified file ${path} (${toolName})`);
      }

      // Scan the written content for hardcoded secrets (Amplitude API keys,
      // JWT bearers). The write has already happened — we can't undo it
      // here — but we can return `additionalContext` to the model so the
      // next turn reverts and switches to an env-var pattern. This is
      // strictly additive to the existing path-recording above.
      //
      // Content shape varies by tool:
      //   Write       → `content` is the full new file body
      //   Edit        → `new_string` is the replacement substring
      //   MultiEdit   → `edits[].new_string`
      //   NotebookEdit → `new_source` is the cell body
      // Falling back across these covers every wizard-relevant write.
      const candidates: string[] = [];
      if (typeof obj.content === 'string') candidates.push(obj.content);
      if (typeof obj.new_string === 'string') candidates.push(obj.new_string);
      if (typeof obj.new_source === 'string') candidates.push(obj.new_source);
      if (Array.isArray(obj.edits)) {
        for (const edit of obj.edits) {
          if (
            edit &&
            typeof edit === 'object' &&
            typeof (edit as { new_string?: unknown }).new_string === 'string'
          ) {
            candidates.push((edit as { new_string: string }).new_string);
          }
        }
      }
      for (const text of candidates) {
        const scan = scanWriteContentForSecrets(text);
        if (scan.matched && scan.rule) {
          logToFile(
            `PostToolUse: hardcoded-secret rule matched (rule: ${
              scan.rule.label
            }, file: ${path ?? '<unknown>'}, tool: ${toolName})`,
          );
          captureWizardError(
            'Safety Scanner',
            `Hardcoded secret detected: ${scan.rule.label}`,
            'createPostToolUseHook',
            {
              'rule id': scan.rule.id,
              'tool name': toolName,
              'file path': path ?? null,
            },
          );
          // Build a single, focused remediation message keyed to the file
          // path (so the model knows exactly which file to revert).
          const ref = path ? ` at ${path}` : '';
          secretWarning = `Safety scanner: a hardcoded secret was detected in the file you just wrote${ref}. ${scan.rule.message}`;
          break;
        }
      }
    } catch (err) {
      // Path recording / scanning errors are non-fatal — they must never
      // break the agent loop. Logged for ops review.
      logToFile('PostToolUse handler threw:', err);
    }
    if (secretWarning) {
      // `additionalContext` is forwarded to the model on its next turn,
      // letting it self-correct. Returning a structured payload (not a
      // bare string) per the SDK's hook protocol.
      return Promise.resolve({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: secretWarning,
        },
      });
    }
    return Promise.resolve({});
  };
}

/**
 * Configuration object returned by initializeAgent / getAgent.
 */
export type AgentRunConfig = {
  workingDirectory: string;
  mcpServers: McpServersConfig;
  /**
   * Tool names to drop from the model's prompt entirely. Threaded through
   * to the SDK's `disallowedTools` option so the JSONSchema for unused
   * Amplitude MCP tools never lands in the system prefix. Built from
   * `AMPLITUDE_MCP_TOOL_ALLOWLIST` at agent-init time; pass-through here so
   * downstream code (and tests) can inspect the resolved list without
   * re-reading env vars.
   */
  disallowedTools?: string[];
  model: string;
  wizardFlags?: Record<string, string>;
  wizardMetadata?: Record<string, string>;
  /** When true, bypass the Amplitude gateway and run via the local `claude` CLI. */
  useLocalClaude?: boolean;
  /** When true, ANTHROPIC_API_KEY is passed through to the SDK instead of the gateway. */
  useDirectApiKey?: boolean;
  /**
   * Per-wizard-run UUID forwarded to the gateway as `x-amp-wizard-session-id`.
   * Groups all `/v1/messages` calls in this run into one Agent Analytics session.
   */
  agentSessionId?: string;
  /**
   * Whether the active framework targets the browser. Threaded from
   * `AgentConfig.targetsBrowser` so `runAgent` can ask `commandments.ts`
   * for browser-specific guidance only when relevant.
   */
  targetsBrowser?: boolean;
  /**
   * Free-form context the orchestrator wants prepended to every turn.
   * Sourced from `--context-file <path>` (or `AMPLITUDE_WIZARD_CONTEXT`
   * env var) — lets a parent agent inject team conventions ("we use
   * snake_case for events", "always prefer Stripe events over generic
   * checkout events", existing taxonomy snippets) WITHOUT modifying any
   * skill content. Appended to `commandments.ts` output so it lands
   * in the cached system-prompt block.
   *
   * Truncated upstream at the CLI boundary; this string is the
   * already-validated payload. Empty / undefined when no context was
   * provided.
   */
  orchestratorContext?: string;
};

const GATEWAY_LIVENESS_TIMEOUT_MS = 8_000;

/**
 * Ping the gateway URL with a short timeout.
 * Any HTTP response (even 4xx/5xx) means the gateway is reachable.
 * A timeout or connection error means it's down.
 */
async function checkGatewayLiveness(gatewayUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), GATEWAY_LIVENESS_TIMEOUT_MS);
  try {
    await fetch(gatewayUrl, { method: 'HEAD', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Select wizard metadata from WIZARD_VARIANTS using the variant feature flag.
 * If the flag is missing or the value is not in config, returns the "base" variant (VARIANT: "base").
 */
export function buildWizardMetadata(
  flags: Record<string, string> = {},
): Record<string, string> {
  const variantKey = flags[WIZARD_VARIANT_FLAG_KEY];
  const variant =
    (variantKey && WIZARD_VARIANTS[variantKey]) ?? WIZARD_VARIANTS['base'];
  return { ...variant };
}

/**
 * Header forwarded to the Amplitude LLM gateway to group all `/v1/messages`
 * calls from a single wizard run into one Agent Analytics session.
 *
 * The proxy (thunder/wizard-proxy) reads this header and uses it as the
 * `agentSessionId`. Without it, the proxy falls back to a deterministic
 * session ID derived from the auth token hash — which collapses every
 * wizard run a user ever does into the same session.
 */
export const WIZARD_SESSION_ID_HEADER = 'x-amp-wizard-session-id';

/**
 * Build env for the SDK subprocess: process.env plus ANTHROPIC_CUSTOM_HEADERS
 * from wizard metadata, feature flags, and the per-run session ID.
 *
 * Exported for unit testing.
 */
export function buildAgentEnv(
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
  agentSessionId?: string,
): string {
  const headers = createCustomHeaders();
  for (const [key, value] of Object.entries(wizardMetadata)) {
    headers.add(
      key.startsWith(AMPLITUDE_PROPERTY_HEADER_PREFIX)
        ? key
        : `${AMPLITUDE_PROPERTY_HEADER_PREFIX}${key}`,
      value,
    );
  }
  for (const [flagKey, variant] of Object.entries(wizardFlags)) {
    if (!flagKey.toLowerCase().startsWith('wizard')) continue;
    headers.addFlag(flagKey, variant);
  }
  if (agentSessionId) {
    headers.add(WIZARD_SESSION_ID_HEADER, agentSessionId);
  }
  const encoded = headers.encode();
  logToFile('ANTHROPIC_CUSTOM_HEADERS', encoded);
  return encoded;
}

/**
 * Initialize agent configuration for the LLM gateway
 */
export async function initializeAgent(
  config: AgentConfig,
  options: WizardOptions,
): Promise<AgentRunConfig> {
  // Initialize log file for this run
  initLogFile();
  logToFile('Agent initialization starting');
  logToFile('Install directory:', options.installDir);

  // Strip inherited Claude Code / Agent SDK env vars before the inner SDK
  // subprocess boots. Without this, an outer Claude Code session's
  // CLAUDECODE=1, CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_OAUTH_TOKEN, etc. leak
  // into the child and cause the LLM gateway to reject requests (400).
  const sanitized = sanitizeNestedClaudeEnv();
  if (sanitized.cleared.length > 0) {
    logToFile(
      'Sanitized inherited Claude env vars (nested-invocation safe):',
      sanitized.cleared,
    );
  }

  getUI().log.step('Initializing Claude agent...');

  try {
    const useDirectApiKey = !!process.env.ANTHROPIC_API_KEY;
    const useLocalClaude = !config.amplitudeBearerToken && !useDirectApiKey;

    if (useDirectApiKey) {
      // An inherited ANTHROPIC_AUTH_TOKEN from an outer agent session would
      // override ANTHROPIC_API_KEY in some SDK paths. Clear it so the user's
      // explicit API key wins unambiguously.
      delete process.env.ANTHROPIC_AUTH_TOKEN;
      logToFile('ANTHROPIC_API_KEY found — bypassing Amplitude gateway');
    } else if (useLocalClaude) {
      // The local claude CLI has its own auth; inherited ANTHROPIC_AUTH_TOKEN
      // from an outer session would route requests with the wrong credentials.
      delete process.env.ANTHROPIC_AUTH_TOKEN;
      logToFile('No Amplitude API key — using local claude CLI');
    } else {
      // Configure LLM gateway environment variables (inherited by SDK subprocess)
      const gatewayUrl = getLlmGatewayUrlFromHost(config.amplitudeApiHost);

      // Fail fast if the gateway isn't responding rather than hanging indefinitely
      const alive = await checkGatewayLiveness(gatewayUrl);
      if (!alive) {
        throw new Error(
          `Could not reach the Amplitude LLM gateway (${gatewayUrl}). ` +
            `Check your network connection, or set ANTHROPIC_API_KEY to use the Anthropic API directly.`,
        );
      }

      // Capture the pre-existing beta header state before we override it below,
      // so the diagnostic log reflects what the user's environment had configured.
      const betaHeadersEnabledInEnv =
        !process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS;

      process.env.ANTHROPIC_BASE_URL = gatewayUrl;
      process.env.ANTHROPIC_AUTH_TOKEN = config.amplitudeBearerToken;
      // Use CLAUDE_CODE_OAUTH_TOKEN to override any stored /login credentials
      process.env.CLAUDE_CODE_OAUTH_TOKEN = config.amplitudeBearerToken;
      // Disable experimental betas (like input_examples) that the LLM gateway doesn't support
      process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = 'true';
      logToFile('Configured LLM gateway:', gatewayUrl);
      logToFile('Gateway config:', {
        url: gatewayUrl,
        betaHeadersEnabledInEnv,
      });

      // Project-layer `.claude/settings.json` (env block) wins over the
      // env we pass to the SDK — that's how the SDK's settings precedence
      // works. For users with a custom `ANTHROPIC_BASE_URL` (LiteLLM,
      // corporate proxy, Claude Pro/Max OAuth, etc.) checked into their
      // repo, that silently re-routes the wizard's traffic away from the
      // Amplitude gateway and the run breaks.
      //
      // Fix: write our gateway env into the LOCAL settings layer
      // (`.claude/settings.local.json`, machine-local + gitignored). Local
      // beats project in the SDK precedence chain (see `_F6` in the
      // bundled cli.js: `["localSettings", "projectSettings", "userSettings"]`),
      // so the wizard's values win without ever modifying the user's
      // checked-in config. We also register a cleanup that restores the
      // file's pre-wizard state on every exit (success / cancel / crash).
      const scoped = applyScopedSettings(config.workingDirectory);
      if (scoped) {
        registerCleanup(() => scoped.restore());
      }
    }

    // Configure MCP servers
    const mcpServers: McpServersConfig = {};

    if (!config.skipAmplitudeMcp) {
      mcpServers['amplitude-wizard'] = {
        type: 'http',
        url: config.amplitudeMcpUrl,
        headers: {
          Authorization: `Bearer ${config.amplitudeBearerToken}`,
          'User-Agent': WIZARD_USER_AGENT,
        },
      };
    }

    // Curated allowlist of Amplitude MCP tools the wizard actually uses
    // during a normal run (instrumentation + chart/dashboard authoring +
    // ingestion checks). The Amplitude MCP server exposes ~70 tools; loading
    // every tool's JSONSchema into the prompt costs ~300 tokens × 70 = ~21K
    // tokens of dead schema in every turn's prefix, and pushes runs into
    // mid-dashboard context-compaction stalls (audit dated 2026-05-07,
    // run `0f618bd49e0a`: pre_tokens 168,943 at compaction trigger; only
    // 4 distinct Amplitude MCP tools were actually invoked across the run).
    //
    // Adding a new tool? Set `AMPLITUDE_WIZARD_MCP_TOOL_FILTER=full` for one
    // run to opt out of the cap, then check
    // `~/.amplitude/wizard/runs/<sha>/log.ndjson` for the
    // `mcp__amplitude-wizard__*` tool_use blocks and append the bare tool
    // name here. When in doubt, keep — false negatives are runtime errors.
    const AMPLITUDE_MCP_TOOL_ALLOWLIST: ReadonlySet<string> = new Set([
      // Chart authoring + validation pipeline
      'query_dataset',
      'get_chart_definition_params',
      'save_chart_edits',
      'verify_chart_definition',
      'create_chart',
      'update_chart',
      'query_chart',
      // Dashboard authoring
      'create_dashboard',
      'update_dashboard',
      'edit_dashboard',
      'replace_dashboard_properties',
      // Project + event discovery (start-of-session + ingestion polling)
      'get_context',
      'get_project_context',
      'get_events',
      'get_event_properties',
      'get_properties',
      // Event-plan annotation (planned-events.ts -> update_event)
      'update_event',
    ]);

    // Full set of tools the Amplitude MCP server is known to expose, taken
    // from the SDK's `system.init` envelope on a recent run. We use this as
    // the deny universe so the SDK strips schemas before they reach the
    // prompt — `disallowedTools` is the SDK option that drops schemas, not
    // `canUseTool` (which only gates runtime invocation after schemas have
    // already been embedded). Keep this list in sync with the production
    // Amplitude MCP surface; new tools the wizard does NOT use should be
    // added here, new tools it DOES use should go in the allowlist above.
    const AMPLITUDE_MCP_KNOWN_TOOLS: readonly string[] = [
      'add_comment',
      'create_chart',
      'create_cohort',
      'create_dashboard',
      'create_metric',
      'create_notebook',
      'describe_tool',
      'edit_dashboard',
      'edit_notebook',
      'get_agent_analytics_conversation',
      'get_agent_analytics_schema',
      'get_agent_results',
      'get_ai_visibility_aliases',
      'get_ai_visibility_competitors',
      'get_ai_visibility_models',
      'get_ai_visibility_pages',
      'get_ai_visibility_prompt_responses',
      'get_ai_visibility_prompts',
      'get_ai_visibility_reports',
      'get_ai_visibility_scores',
      'get_ai_visibility_scores_over_time',
      'get_ai_visibility_sentiment',
      'get_ai_visibility_sources',
      'get_ai_visibility_topics',
      'get_category_tools',
      'get_chart_definition_params',
      'get_charts',
      'get_cohorts',
      'get_comments',
      'get_context',
      'get_custom_or_labeled_events',
      'get_dashboard',
      'get_deployments',
      'get_event_properties',
      'get_events',
      'get_experiments',
      'get_feedback_comments',
      'get_feedback_insights',
      'get_feedback_mentions',
      'get_feedback_sources',
      'get_feedback_trends',
      'get_flags',
      'get_from_url',
      'get_group_types',
      'get_project_context',
      'get_properties',
      'get_session_replay_duration',
      'get_session_replay_events',
      'get_session_replay_stream',
      'get_session_replay_timeline',
      'get_session_replays',
      'get_transformations',
      'get_users',
      'get_workspace_settings',
      'list_ai_visibility_org_brands',
      'list_session_replays',
      'list_tool_categories',
      'query_agent_analytics_metrics',
      'query_agent_analytics_sessions',
      'query_agent_analytics_spans',
      'query_chart',
      'query_charts',
      'query_dataset',
      'query_experiment',
      'render_session_replay',
      'replace_dashboard_properties',
      'save_chart_edits',
      'search',
      'search_agent_analytics_conversations',
      'track_ui_render_response',
      'update_chart',
      'update_custom_or_labeled_events',
      'update_dashboard',
      'update_event',
      'update_properties',
      'verify_chart_definition',
    ];

    // Build the disallow list. When `AMPLITUDE_WIZARD_MCP_TOOL_FILTER=full`
    // we skip filtering entirely (escape hatch for debugging or for runs
    // that need a tool not in the curated allowlist). Default = capped.
    const filterMode = process.env.AMPLITUDE_WIZARD_MCP_TOOL_FILTER;
    const disallowedAmplitudeTools: string[] =
      config.skipAmplitudeMcp || filterMode === 'full'
        ? []
        : AMPLITUDE_MCP_KNOWN_TOOLS.filter(
            (bare) => !AMPLITUDE_MCP_TOOL_ALLOWLIST.has(bare),
          ).map((bare) => `mcp__amplitude-wizard__${bare}`);

    if (disallowedAmplitudeTools.length > 0) {
      logToFile(
        `Amplitude MCP tool surface capped: allow ${AMPLITUDE_MCP_TOOL_ALLOWLIST.size}, disallow ${disallowedAmplitudeTools.length} (set AMPLITUDE_WIZARD_MCP_TOOL_FILTER=full to opt out)`,
      );
    } else if (filterMode === 'full') {
      logToFile(
        'Amplitude MCP tool surface uncapped (AMPLITUDE_WIZARD_MCP_TOOL_FILTER=full)',
      );
    }

    for (const [name, { url }] of Object.entries(
      config.additionalMcpServers ?? {},
    )) {
      mcpServers[name] = { type: 'http', url };
    }

    // Add in-process wizard tools (env files, package manager detection).
    // The status reporter is wired up per-run by runAgent via setStatusReporter.
    const wizardToolsServer = await createWizardToolsServer({
      workingDirectory: config.workingDirectory,
      detectPackageManager: config.detectPackageManager,
      skillsBaseUrl: config.skillsBaseUrl,
      statusReporter: () => _activeStatusReporter,
    });
    mcpServers['wizard-tools'] = wizardToolsServer;

    const agentRunConfig: AgentRunConfig = {
      workingDirectory: config.workingDirectory,
      mcpServers,
      disallowedTools:
        disallowedAmplitudeTools.length > 0
          ? disallowedAmplitudeTools
          : undefined,
      // Mode → model alias. Default 'standard' = current behavior;
      // see `docs/internal/agent-mode-flag.md` for the full mapping.
      // Gateway expects the `anthropic/<alias>` prefix; direct API expects
      // the bare alias — `selectModel` handles both.
      model: selectModel(config.mode ?? 'standard', useDirectApiKey),
      wizardFlags: config.wizardFlags,
      wizardMetadata: config.wizardMetadata,
      useLocalClaude,
      useDirectApiKey,
      agentSessionId: config.agentSessionId,
      targetsBrowser: config.targetsBrowser,
      orchestratorContext: config.orchestratorContext,
    };

    logToFile('Agent config:', {
      workingDirectory: agentRunConfig.workingDirectory,
      amplitudeMcpUrl: config.amplitudeMcpUrl,
      useLocalClaude,
      useDirectApiKey,
      bearerTokenPresent: !!config.amplitudeBearerToken,
    });

    if (options.debug) {
      debug('Agent config:', {
        workingDirectory: agentRunConfig.workingDirectory,
        amplitudeMcpUrl: config.amplitudeMcpUrl,
        useLocalClaude,
        useDirectApiKey,
        bearerTokenPresent: !!config.amplitudeBearerToken,
      });
    }

    const aiSdkProbe = await maybeRunAiSdkGatewayProbe({
      useLocalClaude,
      useDirectApiKey,
    });
    if (aiSdkProbe.status === 'skipped') {
      logToFile('AI SDK gateway probe skipped:', aiSdkProbe.reason);
    } else if (aiSdkProbe.status === 'ok') {
      logToFile('AI SDK gateway probe OK');
    }
    enforceAiSdkProbeStrict(aiSdkProbe);

    getUI().log.step(`Verbose logs: ${getLogFilePath()}`);
    getUI().log.success("Agent initialized. Let's get cooking!");
    return agentRunConfig;
  } catch (error) {
    logToFile('Agent initialization error:', error);
    debug('Agent initialization error:', error);
    throw error;
  }
}

let _agentPromise: Promise<AgentRunConfig> | null = null;

function buildDefaultAgentConfig(): AgentConfig {
  // Resolve the user's active zone from ~/.ampli.json so EU users don't
  // silently get routed to US hosts when no explicit config is threaded
  // through. Fall back to the default zone if no stored user is found.
  const storedUser = getStoredUser();
  const zone =
    storedUser && storedUser.id !== 'pending'
      ? storedUser.zone
      : DEFAULT_AMPLITUDE_ZONE;
  const storedToken = getStoredToken(storedUser?.id, zone)?.accessToken ?? '';
  const host = getHostFromRegion(zone);
  // Region-aware MCP URL: an EU stored user must talk to the EU MCP host,
  // not US. The MCP_URL env override (test/dev) is honored inside the
  // helper.
  const mcpUrl = getMcpUrlFromZone(zone);
  return {
    workingDirectory: process.cwd(),
    amplitudeMcpUrl: mcpUrl,
    amplitudeApiKey: storedToken,
    amplitudeBearerToken: storedToken,
    amplitudeApiHost: host,
    skipAmplitudeMcp: !storedToken,
    detectPackageManager: () =>
      Promise.resolve({ detected: [], primary: null, recommendation: '' }),
  };
}

const DEFAULT_WIZARD_OPTIONS: WizardOptions = {
  debug: false,
  forceInstall: false,
  installDir: process.cwd(),
  default: false,
  authOnboardingPath: AuthOnboardingPath.SignIn,
  localMcp: false,
  ci: false,
  menu: false,
  benchmark: false,
};

/**
 * Return the already-initialized agent config, or call initializeAgent to create it.
 * Concurrent calls during initialization share the same Promise.
 * On error the cached Promise is cleared so the next call retries.
 *
 * Omitting config/options reads the bearer token from ~/.ampli.json and uses production
 * defaults (MCP disabled if no token found, cwd as working directory).
 */
export async function getAgent(
  config: AgentConfig = buildDefaultAgentConfig(),
  options: WizardOptions = DEFAULT_WIZARD_OPTIONS,
): Promise<AgentRunConfig> {
  if (!_agentPromise) {
    _agentPromise = initializeAgent(config, options).catch((err) => {
      _agentPromise = null;
      throw err;
    });
  }
  return _agentPromise;
}

/**
 * Run the agent by spawning the user's local `claude` CLI with --continue.
 * Used when no Amplitude API key is present (local development).
 * Streams stdout line-by-line and forwards text to the spinner.
 */
export async function runAgentLocally(
  prompt: string,
  workingDirectory: string,
  spinner: SpinnerHandle,
  successMessage: string,
  errorMessage: string,
): Promise<{ error?: AgentErrorType; message?: string }> {
  // Use the cross-platform shim wrapper — `claude` ships as `claude.cmd`
  // when installed via npm on Windows, and `child_process.spawn` would
  // ENOENT on the bare name (it doesn't consult PATHEXT). See
  // `src/utils/cross-platform-spawn.ts`.
  const { spawn } = await import('../utils/cross-platform-spawn.js');

  logToFile('Running agent via local claude CLI');

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--continue', prompt], {
      cwd: workingDirectory,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');

    // Rate-limit how often raw stdout chunks become user-visible status
    // updates. Each pushStatus mutates the store and triggers a full TUI
    // re-render; under stream-json output that fires hundreds of times a
    // second and stalls the UI. We keep the most recent line (so the
    // status reflects "now") but only forward it to the UI on a fixed
    // cadence. Logging stays per-line for full fidelity in the log file.
    const PUSH_INTERVAL_MS = 150;
    let pendingLine: string | null = null;
    let pushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPending = () => {
      pushTimer = null;
      if (pendingLine === null) return;
      const line = pendingLine;
      pendingLine = null;
      spinner.message(line);
      getUI().pushStatus(line);
    };

    /**
     * Line buffer for stdout. The OS pipes stdout in arbitrary-sized
     * chunks — a single `data` event may carry multiple lines, half a
     * line, or several lines plus a partial trailing one. Splitting each
     * raw chunk on `\n` and treating every result as a complete line was
     * the root cause of `{"type":"content_block_delta",…` leaking past
     * the filter: the trailing fragment couldn't `JSON.parse`, so the
     * strict signature check missed it. Buffer until we see a newline,
     * emit only complete lines, and stash the remainder for the next
     * chunk. (The prefix match above is a second line of defense if a
     * line is genuinely longer than the pipe buffer.)
     */
    let stdoutBuffer = '';
    const consumeLine = (line: string) => {
      // Drop stream-event protocol lines before logging — under stream-json
      // output a single agent turn produces hundreds of `content_block_delta`
      // frames, and writing them all to the log file makes the Logs tab
      // unreadable (thousands of partial_json deltas burying real status).
      // The SDK message stream already gives us structured events.
      if (looksLikeStreamEventLine(line)) return;
      logToFile('claude stdout:', line);
      pendingLine = line.slice(0, 80);
      if (pushTimer === null) {
        pushTimer = setTimeout(flushPending, PUSH_INTERVAL_MS);
      }
    };

    proc.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      let nl: number;
      while ((nl = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, nl);
        stdoutBuffer = stdoutBuffer.slice(nl + 1);
        if (line.trim()) consumeLine(line);
      }
    });

    proc.stderr.on('data', (chunk: string) => {
      logToFile('claude stderr:', chunk);
    });

    proc.on('close', (code) => {
      // Flush any line still buffered without a trailing newline so the
      // final partial line isn't dropped on close.
      if (stdoutBuffer.trim()) {
        consumeLine(stdoutBuffer);
        stdoutBuffer = '';
      }
      // Flush any pending status update so the very last line the user
      // sees reflects what actually happened just before exit.
      if (pushTimer !== null) {
        clearTimeout(pushTimer);
        flushPending();
      }
      if (code === 0) {
        spinner.stop(successMessage);
        resolve({});
      } else {
        spinner.stop(errorMessage);
        reject(new Error(`claude exited with code ${code ?? 'unknown'}`));
      }
    });

    proc.on('error', (err) => {
      if (pushTimer !== null) {
        clearTimeout(pushTimer);
        pushTimer = null;
        pendingLine = null;
      }
      spinner.stop(errorMessage);
      reject(err);
    });
  });
}

/**
 * Storm anchor for the outer retry loop. Shared across `publishRetryBanner`
 * calls so consecutive retries reuse the same `startedAt` — required for
 * the UI grace period in {@link RetryStatusChip} to ever clear during a
 * storm of rapid post-stream / catch-path retries (each call resamples
 * `Date.now()` otherwise, and `now - startedAt` never crosses the
 * threshold). Reset by `clearRetryBanner` when the loop exits cleanly.
 */
const bannerStormAnchor = createStormAnchor();

// Tracks whether publishRetryBanner has set a rate-limit-retry activity that we
// own. clearRetryBanner only clears the activity line if we set it, so it
// can't silently wipe an unrelated activity (e.g. mcp-tool, compaction).
let retryBannerOwnsActivity = false;

/**
 * Publish a retry banner to the UI. Used from the post-stream and catch-path
 * retry sites — the middleware-based path handles live `api_retry` messages.
 * Swallows UI errors so a failed update never aborts the retry loop.
 */
function publishRetryBanner(input: {
  attempt: number;
  maxRetries: number;
  errorStatus: number | null;
  reason: string;
  /**
   * Optional sleep-until timestamp (ms). When provided, the activity-line
   * shows "Waiting Ns before retry…" so the user sees the sleep tick down.
   * When omitted the banner still shows but no countdown surfaces.
   */
  nextRetryAtMs?: number;
}): void {
  const stormStartedAt = bannerStormAnchor.stamp();
  const state: RetryState = {
    attempt: input.attempt,
    maxRetries: input.maxRetries,
    nextRetryAtMs: input.nextRetryAtMs ?? Date.now(),
    errorStatus: input.errorStatus,
    reason: input.reason,
    startedAt: stormStartedAt,
  };
  try {
    getUI().setRetryState(state);
  } catch {
    // UI may not be initialised during some test paths.
  }
  // Mirror onto the activity-line so users see live "Rate limited — waiting
  // Ns before retry (attempt N/N)" instead of a silent UI during the sleep
  // before the next attempt. The retry banner already covers the post-stream
  // / catch-path branches; we additionally surface the same intent on the
  // activity line because the banner is amber chrome and easy to miss.
  try {
    const waitSec = input.nextRetryAtMs
      ? Math.max(0, Math.round((input.nextRetryAtMs - Date.now()) / 1000))
      : null;
    const statusLabel =
      input.errorStatus === 429
        ? 'Rate limited by Anthropic'
        : input.errorStatus
        ? `Anthropic returned ${input.errorStatus}`
        : input.reason || 'Connection issue';
    const message =
      waitSec !== null && waitSec > 0
        ? `${statusLabel}. Waiting ${waitSec}s before retry (attempt ${input.attempt}/${input.maxRetries}).`
        : `${statusLabel}. Retrying (attempt ${input.attempt}/${input.maxRetries}).`;
    getUI().setCurrentActivity({
      kind: 'rate-limit-retry',
      message,
      startedAt: Date.now(),
      estimatedDurationSec: waitSec ?? undefined,
    });
    retryBannerOwnsActivity = true;
  } catch {
    // UI may not be initialised during some test paths.
  }
}

function clearRetryBanner(): void {
  bannerStormAnchor.reset();
  try {
    getUI().setRetryState(null);
  } catch {
    // UI may not be initialised during some test paths.
  }
  // Pair with publishRetryBanner — clearing the banner without clearing the
  // activity line would leave a stale "Waiting Ns before retry…" sub-line
  // until the next progress message landed. Only clear if we set it; otherwise
  // we'd silently wipe an unrelated activity (mcp-tool, compaction, etc.).
  if (retryBannerOwnsActivity) {
    retryBannerOwnsActivity = false;
    try {
      getUI().setCurrentActivity(null);
    } catch {
      // UI may not be initialised during some test paths.
    }
  }
}

/**
 * Execute an agent with the provided prompt and options
 * Handles the full lifecycle: spinner, execution, error handling
 *
 * @returns An object containing any error detected in the agent's output
 */
export async function runAgent(
  agentConfig: AgentRunConfig,
  prompt: string,
  options: WizardOptions,
  spinner: SpinnerHandle,
  config?: {
    estimatedDurationMinutes?: number;
    spinnerMessage?: string;
    successMessage?: string;
    errorMessage?: string;
    additionalFeatureQueue?: () => readonly AdditionalFeature[];
    onFeatureStart?: (feature: AdditionalFeature) => void;
    onFeatureComplete?: (feature: AdditionalFeature) => void;
    /**
     * Fires just before the SDK compacts the conversation. Use to persist
     * crash-recovery state and emit analytics. Wrapped in try/catch by the
     * hook factory — a throwing handler will not abort the compaction.
     */
    onPreCompact?: (input: { trigger: 'manual' | 'auto' }) => void;
    /**
     * Fires once per run when the PreToolUse circuit breaker trips —
     * MAX_CONSECUTIVE_BASH_DENIES consecutive Bash denies have accumulated.
     * Treat as a terminal signal: trigger graceful run halt
     * (e.g. `wizardAbort`) so the agent doesn't keep burning turns on a
     * command that will never be allowed.
     */
    onCircuitBreakerTripped?: (info: {
      consecutiveDenies: number;
      lastCommand: string;
      lastDenyReason: string;
    }) => void;
  },
  middleware?: {
    onMessage(message: SDKMessage): void;
    finalize(resultMessage: SDKMessage, totalDurationMs: number): unknown;
  },
): Promise<{
  error?: AgentErrorType;
  message?: string;
  plannedEvents?: Array<{ name: string; description: string }>;
}> {
  const {
    spinnerMessage = 'Customizing your Amplitude setup...',
    successMessage = 'Amplitude integration complete',
    errorMessage = 'Integration failed',
  } = config ?? {};

  spinner.start(spinnerMessage);

  if (agentConfig.useLocalClaude) {
    const result = await runAgentLocally(
      prompt,
      agentConfig.workingDirectory,
      spinner,
      successMessage,
      errorMessage,
    );
    // Read .amplitude-events.json if the local agent wrote one
    let plannedEvents: Array<{ name: string; description: string }> | undefined;
    try {
      const eventPlanPath = path.join(
        agentConfig.workingDirectory,
        '.amplitude-events.json',
      );
      const content = fs.readFileSync(eventPlanPath, 'utf-8');
      const events = parseEventPlanContent(content);
      if (events) {
        const named = events.filter((e) => e.name.trim().length > 0);
        plannedEvents = named;
        getUI().setEventPlan(named);
      }
    } catch {
      // File doesn't exist — no planned events
    }
    return { ...result, plannedEvents };
  }

  const { query } = await getSDKModule();

  const cliPath = getClaudeCodeExecutablePath();
  logToFile('Starting agent run');
  logToFile('Claude Code executable:', cliPath);
  logToFile('Prompt:', prompt);

  const startTime = Date.now();
  const collectedText: string[] = [];
  const recentStatuses: string[] = []; // rolling last-3 STATUS messages for heartbeat
  // Track if we received a successful result (before any cleanup errors)
  let receivedSuccessResult = false;
  let lastResultMessage: SDKMessage | null = null;
  // Cross-attempt counters used by the post-loop error classifier (and the
  // outer catch). When upstreamGatewayFailures === attemptCount and we
  // never observed a success, we surface GATEWAY_DOWN. Hoisted to the
  // outer function scope so both error-emit paths can see them.
  let attemptCount = 0;
  let upstreamGatewayFailures = 0;
  // Auth tracking — hoisted to function scope so the outer catch can branch
  // on authErrorDetected. Reset per-attempt inside the retry loop.
  // - authErrorDetected: a 401 / auth-error result or repeated auth retries
  //   were observed; route to AUTH_ERROR outro instead of generic API_ERROR.
  // - authRetryCount: consecutive `api_retry` system messages with
  //   error_status 401 (or auth-error patterns). When this hits
  //   AUTH_RETRY_LIMIT we abort the SDK query early so the user isn't
  //   stuck waiting through ~3 minutes of futile retries.
  let authErrorDetected = false;
  let authRetryCount = 0;
  // Set by either short-circuit (post-stream or catch branch) when the
  // upstream gateway / Vertex returns the verbatim
  // `"Invalid request sent to model provider"` wrapper. The post-loop
  // classifier reads this so the catch branch's thrown-error case is
  // classified consistently with the post-stream collected-output case.
  let gatewayInvalidRequestDetected = false;

  // Captures the terminal outcome of this run for the consolidated
  // `agent run summary` analytics event emitted in the outer finally.
  // First-write-wins so a cleanup error doesn't overwrite the real
  // outcome (mirrors the SDK's "ignore post-success errors" behavior).
  type TerminalState =
    | { kind: 'success' }
    | { kind: 'error'; error: AgentErrorType; message?: string };
  let terminalState: TerminalState | undefined;
  const recordTerminal = (s: TerminalState): void => {
    if (!terminalState) terminalState = s;
  };
  // Wrap the error-return shape so every error exit records the terminal
  // state in one place. Previously each `return { error: ... }` was bare;
  // the run-summary event in `finally` would then have to guess which
  // branch terminated.
  const exitWithError = (
    error: AgentErrorType,
    message?: string,
  ): { error: AgentErrorType; message?: string } => {
    recordTerminal({ kind: 'error', error, message });
    return message !== undefined ? { error, message } : { error };
  };

  // Workaround for SDK bug: stdin closes before canUseTool responses can be sent.
  // The fix is to use an async generator for the prompt that stays open until
  // the result is received, keeping the stdin stream alive for permission responses.
  // signalDone is reassigned each retry attempt — the outer catch always has the latest.
  // See: https://github.com/anthropics/claude-code/issues/4775
  // See: https://github.com/anthropics/claude-agent-sdk-typescript/issues/41
  let signalDone: () => void = Function.prototype as () => void;

  // Captured from the .amplitude-events.json watcher so the caller can commit
  // the instrumented plan to the tracking plan even after the agent deletes
  // the file during the conclude phase.
  let lastParsedEventPlan: Array<{ name: string; description: string }> = [];

  // Helper to handle successful completion (used in normal path and race condition recovery)
  const completeWithSuccess = (
    suppressedError?: Error,
  ): {
    error?: AgentErrorType;
    message?: string;
    plannedEvents?: Array<{ name: string; description: string }>;
  } => {
    const durationMs = Date.now() - startTime;
    const durationSeconds = Math.round(durationMs / 1000);

    if (suppressedError) {
      logToFile(
        `Ignoring post-completion error, agent completed successfully in ${durationSeconds}s`,
      );
      logToFile('Suppressed error:', suppressedError.message);
    } else {
      logToFile(`Agent run completed in ${durationSeconds}s`);
    }

    // Extract and capture the agent's reflection on the run
    const outputText = collectedText.join('\n');
    const remarkRegex = new RegExp(
      `${AgentSignals.WIZARD_REMARK.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      )}\\s*(.+?)(?:\\n|$)`,
      's',
    );
    const remarkMatch = outputText.match(remarkRegex);
    if (remarkMatch && remarkMatch[1]) {
      const remark = remarkMatch[1].trim();
      if (remark) {
        analytics.wizardCapture('wizard remark', { remark });
      }
    }

    analytics.wizardCapture('agent completed', {
      'duration ms': durationMs,
      'duration seconds': durationSeconds,
    });
    recordTerminal({ kind: 'success' });
    try {
      if (lastResultMessage) {
        middleware?.finalize(lastResultMessage, durationMs);
      }
    } catch (e) {
      logToFile(`${AgentSignals.BENCHMARK} Middleware finalize error:`, e);
    }
    spinner.stop(successMessage);
    return { plannedEvents: lastParsedEventPlan };
  };

  // Heartbeat interval — fires unconditionally every 10s so AgentUI's
  // `progress: heartbeat` NDJSON event lands on a fixed cadence even
  // when the agent is mid-tool-call and nobody has called pushStatus
  // recently. Orchestrators treat absence of heartbeat as "the wizard
  // process hung"; gating on `recentStatuses.length > 0` (the prior
  // behaviour) made long quiet tool calls look indistinguishable from
  // a hang. LoggingUI / InkUI continue to short-circuit on an empty
  // status tail so terminal output stays clean.
  const heartbeatInterval = setInterval(() => {
    getUI().heartbeat({
      statuses: [...recentStatuses],
      elapsedMs: Date.now() - startTime,
      attempt: attemptCount > 0 ? attemptCount : undefined,
    });
  }, 10_000);

  // Dual-path watchers for the canonical `.amplitude/{events,dashboard}.json`
  // and their legacy `.amplitude-events.json` / `.amplitude-dashboard.json`
  // mirrors (still written by bundled context-hub integration skills).
  // The handle's `dispose()` closes EVERY watcher it created, so cleanup
  // can't miss a handle when both paths exist simultaneously.
  let eventPlanHandle: DualPathWatcherHandle | undefined;
  let dashboardHandle: DualPathWatcherHandle | undefined;

  try {
    // Tools needed for the wizard:
    // - File operations: Read, Write, Edit
    // - Search: Glob, Grep
    // - Commands: Bash (with restrictions via canUseTool)
    // - MCP discovery: ListMcpResourcesTool (to find available skills)
    // - Skills: Skill (to load installed Amplitude skills)
    // MCP tools (Amplitude) come from mcpServers, not allowedTools
    const allowedTools = [
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'Bash',
      'ListMcpResourcesTool',
      'Skill',
      ...resolveWizardAllowedToolNames(),
    ];

    // Watch for the event plan and feed it into the store.
    //
    // Canonical location: `.amplitude/events.json` (preserved across runs).
    // Legacy fallback: `.amplitude-events.json` — older integration skills
    // (owned by context-hub) still instruct the agent to write the legacy
    // path during the conclude phase. Watching both keeps backwards compat
    // until context-hub ships an updated skill set.
    const eventPlanPath = getEventsFile(agentConfig.workingDirectory);
    const legacyEventPlanPath = path.join(
      agentConfig.workingDirectory,
      '.amplitude-events.json',
    );
    const readEventPlan = () => {
      // Read whichever file was modified most recently. mtime-based
      // selection handles the dashboard flow race (no code writes
      // canonical during a run, so a stale canonical from a prior run
      // would shadow the agent's fresh write to legacy) AND the
      // events.json case where `persistEventPlan` writes both paths
      // atomically.
      const winner = pickFreshestExisting([eventPlanPath, legacyEventPlanPath]);
      if (!winner) return;
      try {
        const events = parseEventPlanContent(fs.readFileSync(winner, 'utf-8'));
        if (events) {
          const named = events.filter((e) => e.name.trim().length > 0);
          // Memoize the latest successful parse so downstream code can
          // surface it even if a later read fails (e.g. mid-write).
          lastParsedEventPlan = named;
          getUI().setEventPlan(named);
        }
      } catch {
        // Race: file vanished between stat and read. Next watcher
        // event will retry.
      }
    };
    eventPlanHandle = startDualPathWatcher({
      canonicalPath: eventPlanPath,
      legacyPath: legacyEventPlanPath,
      onChange: readEventPlan,
    });

    // Watch for the dashboard URL handoff from the agent's conclude step.
    //
    // Canonical location: `.amplitude/dashboard.json`. Legacy fallback:
    // `.amplitude-dashboard.json` — bundled integration skills currently
    // tell the agent to write the legacy path; the wizard reads from both
    // until context-hub ships an updated skill set. workingDirectory is
    // the CLI install dir (process.cwd() or --install-dir), not untrusted
    // network input.
    const dashboardFilePath = getDashboardFile(agentConfig.workingDirectory); // nosemgrep
    const legacyDashboardFilePath = path.join(
      agentConfig.workingDirectory,
      '.amplitude-dashboard.json',
    ); // nosemgrep
    const dashboardFileSchema = z.object({
      dashboardUrl: z.string().url(),
    });
    const readDashboardFile = () => {
      // Same mtime-based selection as `readEventPlan`. Critical here
      // because nothing writes the canonical dashboard path during a
      // run — only the agent writes legacy, so a migrated stale
      // canonical from a prior run would otherwise shadow the agent's
      // fresh URL.
      const winner = pickFreshestExisting([
        dashboardFilePath,
        legacyDashboardFilePath,
      ]);
      if (!winner) return;
      try {
        const content = fs.readFileSync(winner, 'utf-8');
        const parsed: unknown = JSON.parse(content);
        const result = dashboardFileSchema.safeParse(parsed);
        if (result.success) {
          getUI().setDashboardUrl(result.data.dashboardUrl);
          // Mirror to canonical `.amplitude/dashboard.json` so the
          // dashboard URL has a stable location. The agent (via bundled
          // skills) may only write the legacy path; dashboard JSON remains
          // gitignored by path so it is not picked up by `git add .`.
          if (winner === legacyDashboardFilePath) {
            persistDashboard(
              agentConfig.workingDirectory,
              parsed as Record<string, unknown>,
            );
          }
        }
      } catch {
        // File vanished or invalid JSON; next watcher event retries.
      }
    };
    dashboardHandle = startDualPathWatcher({
      canonicalPath: dashboardFilePath,
      legacyPath: legacyDashboardFilePath,
      onChange: readDashboardFile,
    });

    // Retry loop: if the agent stalls (no message for the configured timeout), abort
    // and re-run with a fresh AbortController and prompt stream. Up to MAX_RETRIES.
    //
    // Raised from 3 → 5 (6 total attempts). Production logs from gateway
    // incidents show transient 400-terminated bursts that clear in 30–60s
    // — 4 attempts in 14s of backoff was too aggressive and exited the
    // wizard during recoverable blips. With jittered exponential backoff
    // (cap 30s) the total recovery budget is now ~90s, which rides through
    // typical Vertex/gateway restarts without giving up.
    const MAX_RETRIES = 5;
    // Cold-start timeout: subprocess spawn + MCP server connections + first LLM response
    const INITIAL_STALL_TIMEOUT_MS = 60_000;
    // Mid-run timeout: between consecutive messages during active work.
    //
    // Was 120s, originally raised from 30s "to accommodate extended
    // thinking (Opus can think for 10+ min before emitting the first
    // token)." That justification is now stale: extended thinking is
    // explicitly DISABLED in the SDK options below (see comment near
    // `query({...})`), so a 120s gap with no message means the upstream
    // is hung, not "the model is thinking hard." Combined with the
    // companion fix in `isStallNonProgressMessage` (don't reset the
    // timer on the SDK's pre-wait `requesting` envelope), 60s is now
    // both a tighter cap AND a more accurate one — a healthy
    // sonnet-4-6 run starts streaming within 5–10s of `requesting`.
    const STALL_TIMEOUT_MS = 60_000;

    // (Auth tracking declared at outer function scope — see above the try
    // block — so the outer catch can also branch on authErrorDetected.)

    // Tracks whether a post-stream retry banner is currently shown to the user.
    // Mirrors the pattern in src/lib/middleware/retry.ts: set true when we
    // publish the banner, clear as soon as the next attempt produces its first
    // message. Without this the banner lingers for the entire duration of the
    // recovery attempt (often many minutes) even though the agent is working.
    let postStreamRetryActive = false;

    // Tracks which retry path triggered the most recent `continue` back to
    // the loop head. The retry banner / NDJSON `transient_retry` event must
    // accurately report `reason` so orchestrators can distinguish a stall
    // (no SDK message) from a transient API error (post-stream classifier)
    // from a thrown SDK error (catch branch). Updated by each `continue`
    // site below; consumed by the next attempt's `emitTransientRetry` call.
    let lastRetryReason: 'stall' | 'transient_api' | 'sdk_thrown' = 'stall';

    // Most recent SDK-reported retry delay from `api_retry` system messages.
    // The SDK includes `retry_delay_ms` (its own honour of the upstream's
    // `Retry-After` / 429 hint). When the OUTER loop computes its next
    // backoff, we clamp the result to be at least this value so the wizard
    // never undercuts the gateway's instruction. Reset per-attempt below.
    // See also: src/lib/middleware/retry.ts which surfaces these as UI banners.
    let lastApiRetryDelayMs: number | null = null;

    // Per-attempt recovery bag: modified files + last status. PreCompact
    // persists a snapshot to disk so context dropped by compaction stays
    // recoverable by a post-compaction hydration hook.
    const agentState = new AgentState();

    // Structured status state populated by the `report_status` MCP tool.
    // Replaces the legacy [STATUS] / [ERROR-*] text-marker regex scanner.
    let reportedError: StatusReport | null = null;
    _activeStatusReporter = {
      onStatus(report) {
        spinner.message(report.detail);
        recentStatuses.push(report.detail);
        if (recentStatuses.length > 3) recentStatuses.shift();
        agentState.recordStatus(report.code, report.detail);
      },
      onError(report) {
        // First error wins — stall/retry loop reads this after the attempt.
        if (!reportedError) reportedError = report;
        logToFile(
          `Structured error reported: ${report.code} — ${report.detail}`,
        );
      },
    };

    /**
     * Best-effort cleanup of the prior attempt's Query iterator before
     * starting the next attempt. The SDK's `query()` is typed as
     * `AsyncIterable<unknown>` here but its concrete `Query` implementation
     * extends `AsyncGenerator`, so calling `.return()` at runtime signals
     * the underlying subprocess to tear down stdio cleanly. Without this,
     * a tool call still in flight from the prior attempt can fire our
     * PreToolUse hook on a closed bridge, surfacing as `Error in hook
     * callback hook_0: Error: Stream closed`. See issue #297. Errors
     * thrown by `.return()` itself are expected during teardown and are
     * swallowed.
     */
    const drainPriorResponse = async (
      prior: AsyncIterable<unknown> | undefined,
    ): Promise<void> => {
      if (!prior) return;
      const generator = prior as {
        return?: (value?: unknown) => Promise<unknown>;
      };
      if (typeof generator.return !== 'function') return;
      try {
        await generator.return(undefined);
      } catch (err) {
        logToFile(
          'drainPriorResponse: .return() threw (expected during teardown):',
          err instanceof Error ? err.message : String(err),
        );
      }
    };

    /**
     * Emit a one-line summary if the stderr filter swallowed any
     * hook-bridge-race lines during the just-finished attempt. Keeps
     * the noise volume observable (regressions show up as a growing
     * suppressed count) without flooding the per-line log.
     */
    const logSuppressedHookBridgeNoise = (count: number, attempt: number) => {
      if (count === 0) return;
      logToFile(
        `Suppressed ${count} hook-bridge-race stderr line${
          count === 1 ? '' : 's'
        } from prior subprocess (attempt ${attempt + 1}; see issue #297)`,
      );
    };

    // Streaming text-delta → status pill plumbing.
    //
    // With `includePartialMessages: true`, the SDK emits high-frequency
    // `stream_event` envelopes carrying `content_block_delta` text deltas
    // as the model writes its response. Surfacing them keeps the status
    // pill alive during 30s+ tool calls — without this the user sees a
    // static spinner and assumes the agent is hung.
    //
    // We keep an 80-char rolling tail of recent assistant text and flush
    // at most once per `STREAM_PILL_INTERVAL_MS` so the UI doesn't thrash.
    // Cleared between attempts via `resetStreamPill()` so a stalled
    // attempt's last words don't bleed into a fresh retry.
    const STREAM_PILL_INTERVAL_MS = 150;
    const STREAM_PILL_MAX_CHARS = 80;
    let streamPillBuffer = '';
    let streamPillTimer: ReturnType<typeof setTimeout> | null = null;
    const flushStreamPill = (): void => {
      streamPillTimer = null;
      const line = streamPillBuffer.replace(/\s+/g, ' ').trim();
      if (!line) return;
      // Defense in depth: if the rolling tail looks like Anthropic stream-event
      // protocol JSON (e.g. `{"type":"content_block_delta","index":0,...`), drop
      // it instead of surfacing the raw frame in the status pill. The SDK path
      // already filters these at the message layer, but a `text_delta` whose
      // payload is itself JSON (the model occasionally narrates with a JSON
      // example, or a tool result snippet flows through as text) would
      // otherwise reach the user as `{"type":"content_block_delta",...` —
      // which is exactly the production leak the user reported.
      if (looksLikeStreamEventLine(line)) return;
      spinner.message(line);
      getUI().pushStatus(line);
      // Mirror the throttled status pill into the per-project log so the TUI
      // Logs tab stays useful during long tool calls. Stream deltas never hit
      // handleSDKMessage, so without this the file can look idle while Progress
      // shows the model's voice (users assume logging is broken).
      logToFile('stream status:', truncateLogMessage(line, 512));
    };
    const enqueueStreamDelta = (delta: string): void => {
      if (!delta) return;
      // Keep a rolling tail just larger than the pill width so successive
      // deltas overwrite older text and the user always sees the model's
      // most recent voice.
      streamPillBuffer = (streamPillBuffer + delta).slice(
        -(STREAM_PILL_MAX_CHARS * 2),
      );
      if (streamPillTimer === null) {
        streamPillTimer = setTimeout(flushStreamPill, STREAM_PILL_INTERVAL_MS);
      }
    };
    const resetStreamPill = (): void => {
      if (streamPillTimer !== null) {
        clearTimeout(streamPillTimer);
        streamPillTimer = null;
      }
      streamPillBuffer = '';
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      attemptCount = attempt + 1;
      agentState.setAttemptId(`attempt-${attempt}`);
      if (attempt > 0) {
        // Per-process retry budget: `runAgent` may be invoked multiple times
        // in one wizard session (integration → verify → fix). Without a
        // shared budget each call would independently burn 5 retries against
        // the same rate-limited window; with it, a persistent gateway 429
        // surfaces as RATE_LIMIT after the budget is spent rather than
        // looping further. See `getRetryBudget` in transient-llm-retry.ts.
        if (!getRetryBudget().tryConsume()) {
          logToFile(
            `Agent retry budget exhausted (process limit ${
              getRetryBudget().limit
            }) — short-circuiting after attempt ${attempt}`,
          );
          analytics.wizardCapture('agent retry budget exhausted', {
            attempt,
            'budget limit': getRetryBudget().limit,
          });
          // Bail out of the loop. The post-loop classifier will surface a
          // RATE_LIMIT / GATEWAY_DOWN remediation based on the prior
          // attempts' partial output. Don't break inside the for-await of
          // `sdkResponse` — we're outside the SDK call here, so a plain
          // break is the right shape.
          break;
        }
        // Additive "full-jitter" backoff with cap 30s, clamped to the most
        // recent SDK-reported `retry_delay_ms` (honours Vertex / Anthropic
        // `Retry-After`). Math lives in `computeRetryBackoffMs` so it stays
        // unit-testable; see `transient-llm-retry.test.ts` for parameterised
        // coverage of the formula + retry-after semantics.
        const backoffMs = computeRetryBackoffMs(attempt, lastApiRetryDelayMs);
        logToFile(
          `Agent stall retry: attempt ${attempt + 1} of ${
            MAX_RETRIES + 1
          }, backing off ${backoffMs}ms (retry_delay_ms hint=${
            lastApiRetryDelayMs ?? 'none'
          }, budget remaining=${getRetryBudget().remaining()})`,
        );
        analytics.wizardCapture('agent stall retry', {
          attempt,
          'backoff ms': backoffMs,
          'retry after ms': lastApiRetryDelayMs ?? null,
          'budget remaining': getRetryBudget().remaining(),
        });
        // Surface the retry to orchestrators (NDJSON / agent mode). InkUI /
        // LoggingUI implementations no-op via the optional method shape.
        try {
          getUI().emitTransientRetry?.({
            attempt: attempt + 1,
            totalAttempts: MAX_RETRIES + 1,
            nextRetryInMs: backoffMs,
            reason: lastRetryReason,
            retryAfterMs: lastApiRetryDelayMs,
          });
        } catch {
          // Never let UI emit failures abort the retry loop.
        }
        getUI().pushStatus(
          `Retrying connection (attempt ${attempt + 1} of ${
            MAX_RETRIES + 1
          })...`,
        );
        // Surface the backoff sleep on the activity line so the user sees
        // the wait tick down. Without this, the wizard sits silent through
        // 2-30s of jittered backoff before the next attempt issues. Cleared
        // either by the setCurrentActivity(null) on the first real message
        // or by the retry-banner clear at the top of the next attempt.
        //
        // We MUST set `retryBannerOwnsActivity = true` here so that
        // `clearRetryBanner()` — which fires from the runAgent finally
        // block when retries are exhausted — actually clears this stale
        // "Waiting Ns before retry…" line on its way out. Without the
        // flag the ownership guard skips the clear and the stale activity
        // sticks around after the run errors out.
        try {
          const waitSec = Math.max(1, Math.round(backoffMs / 1000));
          getUI().setCurrentActivity({
            kind: 'rate-limit-retry',
            message: `Retrying connection. Waiting ${waitSec}s before retry (attempt ${
              attempt + 1
            }/${MAX_RETRIES + 1}).`,
            startedAt: Date.now(),
            estimatedDurationSec: waitSec,
          });
          retryBannerOwnsActivity = true;
        } catch {
          // UI may not be initialised in some test paths.
        }
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        // Clear per-attempt output so stale error markers don't affect the fresh run
        collectedText.length = 0;
        recentStatuses.length = 0;
        authErrorDetected = false;
        authRetryCount = 0;
        reportedError = null;
        // Reset the SDK retry-delay hint at the start of every attempt so a
        // stale value from a previous storm doesn't pin the next backoff to
        // an old Retry-After window.
        lastApiRetryDelayMs = null;
        // Reset the agent recovery bag too — without this, modifiedFiles /
        // lastStatus / compactionCount accumulated by a stalled attempt
        // would leak into the next attempt's snapshot. (Bugbot catch.)
        agentState.reset();
        // Drop any partial-message text from the stalled attempt so the
        // user doesn't see "...rewriting the package.json" carry over
        // into a fresh retry's pill.
        resetStreamPill();

        // Refresh the OAuth access token if it's within the pre-expiry
        // buffer. Long agent runs (Opus + extended thinking, multi-step
        // taxonomy) can outlive the original token's lifetime; without
        // an inter-attempt refresh, the next SDK subprocess gets 401 and
        // the wizard exits as AUTH_ERROR even though a refresh would
        // have rotated us to a valid token. Pre-run refresh
        // (`refreshTokenIfStale('pre-run')` in agent-runner.ts) handles
        // attempt 0; this covers attempts 1+. The SDK subprocess reads
        // ANTHROPIC_AUTH_TOKEN / CLAUDE_CODE_OAUTH_TOKEN from
        // `process.env` on spawn, so mutating those there is sufficient
        // to make the fresh token take effect on the next `query()`
        // call below.
        //
        // CRITICAL: also rotate the bearer in
        // `agentConfig.mcpServers['amplitude-wizard'].headers` — the SDK
        // serializes the mcpServers config (built once in
        // `initializeAgent`) and hands it to the spawned subprocess,
        // which uses those exact headers on every request to the
        // Amplitude MCP endpoint. Without rotating it here, the
        // subprocess keeps sending the OLD `Authorization: Bearer
        // <stale>` header even though the env vars are fresh, and every
        // Amplitude MCP call 401s until the agent reconnects. Bugbot
        // catch on PR #608.
        try {
          const { refreshTokenIfStale } = await import('./agent-runner.js');
          const currentToken = process.env.ANTHROPIC_AUTH_TOKEN ?? '';
          if (currentToken) {
            const refreshed = await refreshTokenIfStale(
              currentToken,
              'inter-attempt',
            );
            if (refreshed && refreshed !== currentToken) {
              process.env.ANTHROPIC_AUTH_TOKEN = refreshed;
              process.env.CLAUDE_CODE_OAUTH_TOKEN = refreshed;
              updateAmplitudeMcpBearer(agentConfig.mcpServers, refreshed);
              logToFile(
                `Inter-attempt OAuth token rotated before attempt ${
                  attempt + 1
                }`,
              );
              analytics.wizardCapture('agent inter-attempt token refresh', {
                attempt,
              });
            }
          }
        } catch (err) {
          // Refresh failure is non-fatal — fall through and let the SDK
          // see whatever token is currently set. If the token is
          // genuinely expired the next attempt will surface AUTH_ERROR
          // exactly as before. Logging-only ensures we know if this
          // path silently breaks.
          logToFile(
            `Inter-attempt token refresh failed (continuing with existing token): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      // Fresh prompt stream per attempt — stdin stays open until result received
      const resultReceived = new Promise<void>((resolve) => {
        signalDone = resolve;
      });

      // Retry-recovery hint: when attempt > 0, prepend a small `<retry-recovery>`
      // block listing the discoveries the prior attempt already made (package
      // manager, env-key probes, which skill was loaded). The fresh attempt
      // starts a new SDK conversation, so without this hint it redoes the
      // same probes — typically 10–20s of avoidable wall time on cold
      // discovery tool calls. Empty string on attempt 0 (no prior facts to
      // share) and when the prior attempt died before any discovery
      // captured anything (`buildRetryHint` returns ''); concatenation is
      // a no-op in those cases.
      const retryHint = attempt > 0 ? buildRetryHint(agentState) : '';
      const attemptPrompt = retryHint ? `${prompt}\n\n${retryHint}` : prompt;
      if (retryHint) {
        logToFile(
          `Retry hint: prepending ${
            agentState.getDiscoveries().size
          } prior-attempt discovery facts to attempt ${attempt + 1} prompt`,
        );
      }

      const createPromptStream = async function* () {
        // The first user message contains the framework-specific
        // integration prompt (~1.5 KB) plus any orchestrator context.
        // It's identical across every turn in the run — cache it so
        // turn 2+ pays 0.1× input cost for that prefix instead of full
        // rate. The system prompt is auto-cached by the SDK; the first
        // user message is treated as fresh tokens unless we mark it
        // explicitly with `cache_control: ephemeral`. Without this we
        // saw `cache_creation_input_tokens` rebuilt on every turn for
        // a block that never changes.
        yield {
          type: 'user',
          session_id: '',
          message: {
            role: 'user',
            content: [
              {
                type: 'text',
                // `attemptPrompt` equals `prompt` on attempt 0 (cache stays
                // hot across runs); on attempt N+1 it's `prompt + retry hint`,
                // which is a fresh cache key — that's fine because the only
                // time we trigger the retry path is when something already
                // went wrong, and skipping ~3 probe tool calls beats a hot
                // cache hit on the first turn.
                text: attemptPrompt,
                cache_control: { type: 'ephemeral' },
              },
            ],
          },
          parent_tool_use_id: null,
        };
        await resultReceived;
      };

      // Per-attempt counter for known-benign hook-bridge-race stderr lines
      // (see HOOK_BRIDGE_RACE_RE). Logged once at attempt boundary so the
      // noise volume stays visible without cluttering the per-line stream.
      let hookBridgeRaceSuppressed = 0;

      // AbortController lets us cancel a stalled query so we can retry.
      // Chained to the wizard-wide abort signal so that a top-level cancel
      // (Ctrl+C / SIGINT → graceful-exit → abortWizard()) tears down the
      // in-flight SDK query and its subprocess instead of leaving them to
      // be SIGKILL'd by the 2s grace window.
      const controller = new AbortController();
      const wizardSignal = getWizardAbortSignal();
      const onWizardAbort = (): void => {
        if (!controller.signal.aborted) {
          controller.abort(wizardSignal.reason ?? 'wizard cancelled');
        }
      };
      if (wizardSignal.aborted) {
        // Wizard was already aborted before this attempt started — abort
        // immediately so the SDK call short-circuits.
        onWizardAbort();
      } else {
        wizardSignal.addEventListener('abort', onWizardAbort, { once: true });
      }
      let staleTimer: ReturnType<typeof setTimeout> | undefined;
      let receivedFirstMessage = false;
      let lastMessageType = 'none';
      let lastMessageTime = Date.now();

      const resetStaleTimer = () => {
        if (staleTimer) clearTimeout(staleTimer);
        const timeoutMs = receivedFirstMessage
          ? STALL_TIMEOUT_MS
          : INITIAL_STALL_TIMEOUT_MS;
        staleTimer = setTimeout(() => {
          // A wizard-tools blocking prompt (`confirm`, `choose`,
          // `confirm_event_plan`) is currently awaiting a user decision —
          // the agent intentionally has no SDK messages in flight while the
          // human reads the prompt. Suppress the abort and re-arm the
          // timer; the prompt-release listener below will reset us cleanly
          // once the user answers and SDK messages can resume.
          if (isWizardPromptActive()) {
            logToFile(
              `Agent stall heartbeat suppressed — user prompt is active (attempt ${
                attempt + 1
              }, last message: ${lastMessageType})`,
            );
            resetStaleTimer();
            return;
          }
          const elapsed = Math.round((Date.now() - lastMessageTime) / 1000);
          logToFile(
            `Agent stalled — no message for ${elapsed}s (attempt ${
              attempt + 1
            }, last message: ${lastMessageType}, phase: ${
              receivedFirstMessage ? 'active' : 'cold-start'
            })`,
          );
          analytics.wizardCapture('agent stall detected', {
            attempt: attempt + 1,
            'stall timeout ms': timeoutMs,
            'last message type': lastMessageType,
            phase: receivedFirstMessage ? 'active' : 'cold-start',
          });
          controller.abort('stall');
        }, timeoutMs);
      };

      // When a blocking user prompt resolves, reset the stall timer so the
      // post-prompt window is timed from the user's decision — not from
      // before the prompt opened. Without this, the timer that was paused
      // (re-armed) while the prompt was active would still be running on
      // its old deadline when SDK messages start flowing again, and a
      // brief upstream lag could trip the stall right after the user
      // answered. Subscribed before the SDK call so the listener is always
      // active for this attempt.
      const unsubscribePromptRelease = onWizardPromptRelease(() => {
        // Treat the prompt response as a fresh "message" for stall-timer
        // purposes — the user just demonstrated the run is alive.
        lastMessageTime = Date.now();
        resetStaleTimer();
      });

      const resolvedMaxTurns = resolveMaxTurns();
      logToFile(
        `Agent maxTurns resolved: ${resolvedMaxTurns} (env=${
          process.env.AMPLITUDE_WIZARD_MAX_TURNS ?? '<unset>'
        })`,
      );

      // Hoisted so the catch block can drain the prior iterator before
      // the next attempt starts. Without this, an in-flight tool call from
      // the prior subprocess could fire our PreToolUse hook on a closed
      // stdio bridge, surfacing as `Error in hook callback hook_0: Error:
      // Stream closed`. See issue #297.
      let response: AsyncIterable<unknown> | undefined;
      try {
        const sdkResponse = query({
          prompt: createPromptStream(),
          options: {
            model: agentConfig.model,
            // Fallback model if primary is unavailable (e.g. Vertex outage).
            // The constant lives in `agent/model-config.ts` so the unit
            // test can pin the `primary !== fallback` invariant the SDK
            // enforces. See `FALLBACK_MODEL_DIRECT` there for capability +
            // collision notes.
            fallbackModel: sdkStandardFallbackModel(
              agentConfig.useDirectApiKey ?? false,
            ),
            // Stream text deltas as `stream_event` envelopes so we can
            // surface them in the status pill during long tool calls. The
            // for-await loop below extracts text_delta payloads and pushes
            // them through the throttled spinner update at most every
            // STREAM_PILL_INTERVAL_MS so the UI doesn't thrash.
            includePartialMessages: true,
            // Extended thinking — explicitly disabled.
            //
            // Leaving `thinking` unset lets the `claude_code` preset / SDK
            // default re-enable it on Sonnet 4.6, which correlates with
            // mid-stream "API Error: 400" cascades when the upstream
            // gateway is under load. Production launch-day repro showed
            // `thinking_delta` blocks streaming right before the 400.
            // See the long-form rationale in the comment block below.
            thinking: { type: 'disabled' },
            // 1M-context beta — DEFAULT OFF on the gateway path.
            //
            // Vertex AI's Anthropic publisher endpoint does not enable
            // arbitrary `anthropic-beta` previews that the direct Anthropic
            // API supports. `context-1m-2025-08-07` is one of those Vertex
            // does not honor: Vertex returns 400 INVALID_ARGUMENT, the
            // wizard proxy (Thunder) wraps that as the generic
            // `"Invalid request sent to model provider"` (see Thunder's
            // `wizard-proxy/router.ts:917-974`), and users running
            // `--agent` inside Claude Code / Cursor / Cline cannot recover.
            // Earlier copy here claimed "safe to leave on — falls back to
            // 200K" — that is true on direct-Anthropic, false on Vertex.
            //
            // Set `AMPLITUDE_WIZARD_GATEWAY_BETAS=1` to opt back in for
            // local diagnostic runs against the direct-API path.
            ...(process.env.AMPLITUDE_WIZARD_GATEWAY_BETAS === '1' ||
            agentConfig.useDirectApiKey
              ? { betas: ['context-1m-2025-08-07'] }
              : {}),
            cwd: agentConfig.workingDirectory,
            permissionMode: 'acceptEdits',
            mcpServers: agentConfig.mcpServers,
            // Drop unused Amplitude MCP tools from the prompt entirely.
            // Built in `initializeAgent` from `AMPLITUDE_MCP_TOOL_ALLOWLIST`;
            // saves ~15-18K tokens of dead JSONSchema per turn. Opt out via
            // `AMPLITUDE_WIZARD_MCP_TOOL_FILTER=full`.
            ...(agentConfig.disallowedTools &&
            agentConfig.disallowedTools.length > 0
              ? { disallowedTools: agentConfig.disallowedTools }
              : {}),
            // Safety nets: cap runaway tool loops and token spend.
            // AMPLITUDE_WIZARD_MAX_TURNS env var overrides the default
            // (useful for evals + quick iteration). Invalid values fall back.
            maxTurns: resolvedMaxTurns,
            // Extended thinking — DISABLED.
            //
            // Earlier we ran with `{ type: 'enabled', budgetTokens: 3000 }`
            // on every turn, on the theory that the instrumentation-planning
            // phase benefits from explicit reasoning. In practice each
            // wizard step is a small, well-bounded action (read a file,
            // write a file, call an MCP tool) and the commandments + skill
            // references already pin down the sequence. Thinking blocks
            // mostly added latency and bloat to the streaming envelope —
            // they also correlated with "API Error: 400 terminated"
            // cascades when the gateway was unhealthy.
            //
            // Disabled by default for snappier feel and lower variance.
            // Re-enable per-step (not globally) if a future phase truly
            // needs deliberation. See `commandments.ts` for the
            // instructions that obviate per-turn reasoning.
            // Load skills + agents + commands from the project's `.claude/`
            // directory, AND the local-layer settings we wrote in
            // `applyScopedSettings`. The SDK merges with `local` winning
            // over `project`, so our wizard-managed env (gateway URL +
            // bearer) overrides anything the user's checked-in
            // `.claude/settings.json` declares. See `claude-settings-scope.ts`
            // for the rationale and the precedence reference.
            settingSources: ['project', 'local'],
            // Explicitly enable required tools including Skill
            allowedTools,
            systemPrompt: {
              type: 'preset',
              preset: 'claude_code',
              // Append wizard-wide commandments (from YAML) rather than replacing
              // the preset so we keep default Claude Code behaviors.
              // Pass `targetsBrowser` so we don't ship browser-specific
              // SDK init defaults / autocapture redundancy guidance to
              // mobile / server / generic runs that can't use them. Saves
              // several KB of system-prompt bloat on those paths.
              //
              // Orchestrator-injected context (from `--context-file <path>`
              // / `AMPLITUDE_WIZARD_CONTEXT` env var) goes AFTER the
              // commandments so the orchestrator can reinforce / override
              // soft guidance ("ignore the autocapture rule for this run,
              // we want explicit events for our own observability"). Hard
              // safety rules at the top of `commandments.ts` (no secrets,
              // no shell-eval of env vars, etc.) still take precedence
              // because the model treats earlier-positioned instructions as
              // load-bearing — the order matters here.
              append:
                buildSystemPromptAppend({
                  commandments: getWizardCommandments({
                    targetsBrowser: agentConfig.targetsBrowser,
                  }),
                  orchestratorContext: agentConfig.orchestratorContext,
                }) + buildSkillTierSystemPromptAppend(),
              // Move per-session dynamic context (cwd, date, user, etc.) out of
              // the cached system prompt and into the first user message. This
              // lets the static preset + our commandments be cached across runs
              // and machines, dramatically improving cache_read hit rate on the
              // ~3KB commandments block every turn. The Agent SDK caches the
              // system prompt implicitly; we just need to stop invalidating it.
              // See cache_read_input_tokens in benchmarks/cache-tracker.ts.
              excludeDynamicSections: true,
            },
            env: {
              ...process.env,
              // When using the Amplitude gateway, block ANTHROPIC_API_KEY so it doesn't
              // override the gateway's OAuth token. When using a direct API key, pass it through.
              ...(agentConfig.useDirectApiKey
                ? {}
                : { ANTHROPIC_API_KEY: undefined }),
              // Vertex-backed gateway rejects some JSON Schema metadata and
              // `anthropic-beta` headers the SDK emits. The Claude Code child
              // process loads `register-gateway-fetch-sanitize-bootstrap.js` via
              // NODE_OPTIONS so `fetch` for `/v1/messages` is sanitized before
              // it hits the wire. Opt out: AMPLITUDE_WIZARD_GATEWAY_SANITIZE_FETCH=0.
              ...(agentConfig.useDirectApiKey ||
              agentConfig.useLocalClaude ||
              process.env.AMPLITUDE_WIZARD_GATEWAY_SANITIZE_FETCH === '0'
                ? {}
                : (() => {
                    const next = buildGatewaySanitizeNodeOptions(
                      process.env.NODE_OPTIONS,
                    );
                    if (next) {
                      logToFile(
                        'Gateway fetch sanitizer: NODE_OPTIONS includes --require register-gateway-fetch-sanitize-bootstrap.js',
                      );
                      return { NODE_OPTIONS: next };
                    }
                    logToFile(
                      'Gateway fetch sanitizer: register script missing — NODE_OPTIONS unchanged',
                    );
                    return {};
                  })()),
              ANTHROPIC_CUSTOM_HEADERS: buildAgentEnv(
                agentConfig.wizardMetadata ?? {},
                agentConfig.wizardFlags ?? {},
                agentConfig.agentSessionId,
              ),
              // Defer MCP tool schemas until the model actually needs them
              // instead of stuffing every tool's JSONSchema into the system
              // prompt up front. Our Amplitude MCP exposes 50+ tools;
              // loading all schemas eagerly bloats every turn. The 'auto:0'
              // value lets the SDK decide when to fetch schemas — observed
              // savings on the order of ~100K tokens per turn on full runs.
              ENABLE_TOOL_SEARCH: 'auto:0',
            },
            canUseTool: (toolName: string, input: unknown) => {
              const logThis = evaluateCanUseToolFileLogging(options);
              if (logThis) {
                logToFile('canUseTool called:', {
                  toolName,
                  input: redactToolLogPayload(input),
                });
              }
              const result = wizardCanUseTool(
                toolName,
                input as Record<string, unknown>,
              );
              if (logThis) {
                logToFile('canUseTool result:', redactToolLogPayload(result));
              }
              return Promise.resolve(result);
            },
            tools: { type: 'preset', preset: 'claude_code' },
            // Capture stderr from CLI subprocess for debugging.
            //
            // Two filters run in sequence before anything reaches the log:
            //   1. Known-benign hook-bridge-race lines (HOOK_BRIDGE_RACE_RE)
            //      are partitioned out and counted; summary logged at
            //      attempt boundary.
            //   2. Anthropic stream-event protocol noise (event: ... /
            //      data: {"type":"content_block_delta",...}) is dropped —
            //      under verbose / stream-json output the CLI emits these
            //      to stderr at hundreds of frames per turn, which makes
            //      the in-app Logs tab unreadable.
            // Chunk-level matching would drop genuine errors riding
            // alongside noise in the same batched chunk — both helpers
            // split line-by-line before filtering so that can't happen.
            stderr: (data: string) => {
              const race = partitionHookBridgeRace(data);
              hookBridgeRaceSuppressed += race.suppressed;
              const stream = stripStreamEventNoise(race.passthrough);
              if (stream.passthrough.length > 0) {
                logToFile('CLI stderr:', stream.passthrough);
                if (options.debug) {
                  debug('CLI stderr:', stream.passthrough);
                }
              }
            },
            hooks: (() => {
              // Inner-lifecycle hooks emit NDJSON to AgentUI for outer-agent
              // orchestrators. SessionStart / PreToolUse / PostToolUse here
              // are observers — they never deny or alter SDK behavior. We
              // chain them with our authoritative gates below so the
              // allowlist still runs for every tool call.
              const inner = createInnerLifecycleHooks({ phase: 'wizard' });
              const innerHooks = inner.hooks();
              const gatedPreToolUse = createPreToolUseHook({
                onCircuitBreakerTripped: config?.onCircuitBreakerTripped,
              });
              const recordPostToolUse = createPostToolUseHook(agentState);

              // Per-step status the journey classifier has emitted so far
              // this run. Passed back into `classifyToolEvent` so triggers
              // that depend on prior steps (e.g. `wire` enters in_progress
              // only after `plan` is `completed`) can gate correctly.
              const derivedJourney: Partial<
                Record<JourneyStepId, JourneyStatus>
              > = {};
              const advanceJourney = (
                phase: 'pre' | 'post',
                input: Record<string, unknown>,
              ): void => {
                try {
                  const toolName =
                    typeof input.tool_name === 'string'
                      ? input.tool_name
                      : typeof input.toolName === 'string'
                      ? input.toolName
                      : '';
                  if (!toolName) return;
                  const toolInput =
                    typeof input.tool_input !== 'undefined'
                      ? input.tool_input
                      : typeof input.toolInput !== 'undefined'
                      ? input.toolInput
                      : null;
                  const toolResult =
                    typeof input.tool_response !== 'undefined'
                      ? input.tool_response
                      : typeof input.tool_result !== 'undefined'
                      ? input.tool_result
                      : null;
                  const transition = classifyToolEvent({
                    phase,
                    toolName,
                    toolInput,
                    toolResult,
                    prevDerived: derivedJourney,
                  });
                  if (!transition) return;
                  // Mirror the monotonic guard in WizardStore — a completed
                  // step never regresses to in_progress, so don't push that
                  // demotion into the UI.
                  const prev = derivedJourney[transition.stepId];
                  if (prev === 'completed' && transition.status !== 'completed')
                    return;
                  derivedJourney[transition.stepId] = transition.status;
                  getUI().applyJourneyTransition(
                    transition.stepId,
                    transition.status,
                  );
                } catch (err) {
                  // Classifier errors are non-fatal — the user-visible
                  // checklist falls back to the canonical 4 pending rows
                  // until the next valid signal lands.
                  logToFile('journey classifier threw:', err);
                }
              };

              // Read the bare tool name from a hook input payload —
              // matches both `tool_name` (Claude Agent SDK) and
              // `toolName` (older SDK shape) to stay compatible across
              // versions; same defensive parse the journey classifier
              // uses above.
              const readToolName = (
                input: Record<string, unknown>,
              ): string | null => {
                if (typeof input.tool_name === 'string') return input.tool_name;
                if (typeof input.toolName === 'string') return input.toolName;
                return null;
              };

              // Surface long-running Amplitude MCP tool calls on the
              // activity line so the user sees "Querying Amplitude for
              // <event>…" instead of a static spinner during a 10-30s
              // `query_dataset` round-trip. We only highlight
              // `mcp__amplitude__*` (the read-only Amplitude MCP) — the
              // wizard-tools MCP (env vars, package manager) is sub-second
              // and would just churn the line.
              const onAmplitudeMcpPre = (
                input: Record<string, unknown>,
              ): void => {
                const toolName = readToolName(input);
                if (!toolName) return;
                if (!toolName.startsWith('mcp__amplitude__')) return;
                const bare = toolName.slice('mcp__amplitude__'.length);
                try {
                  getUI().setCurrentActivity({
                    kind: 'mcp-tool',
                    message: `Querying Amplitude (${bare})...`,
                    startedAt: Date.now(),
                    estimatedDurationSec: 30,
                  });
                } catch {
                  // UI may not be initialised in some test paths.
                }
              };
              const onAmplitudeMcpPost = (
                input: Record<string, unknown>,
              ): void => {
                const toolName = readToolName(input);
                if (!toolName) return;
                if (!toolName.startsWith('mcp__amplitude__')) return;
                try {
                  getUI().setCurrentActivity(null);
                } catch {
                  // UI may not be initialised in some test paths.
                }
              };

              // Compose: inner observer + authoritative gate run concurrently.
              // The observer is decision-neutral (emits NDJSON for outer-agent
              // telemetry only) so its return value is discarded; the gate's
              // value is what the SDK acts on. Both must complete before we
              // return so the NDJSON tool_call event lands on stdout before
              // the SDK starts the tool — preserving emit ordering for the
              // outer orchestrator. Observer errors are swallowed to file so a
              // broken NDJSON sink can never alter a deny decision.
              const preToolUse: HookCallback = async (
                input,
                toolUseID,
                hookOpts,
              ) => {
                advanceJourney('pre', input);
                onAmplitudeMcpPre(input);
                const observer = innerHooks
                  .PreToolUse(input, toolUseID, hookOpts)
                  .catch((err: unknown) => {
                    logToFile('inner PreToolUse observer threw:', err);
                  });
                const gate = Promise.resolve(
                  gatedPreToolUse(input, toolUseID, hookOpts),
                );
                const [, gateResult] = await Promise.all([observer, gate]);
                return gateResult;
              };

              const postToolUse: HookCallback = async (
                input,
                toolUseID,
                hookOpts,
              ) => {
                advanceJourney('post', input);
                onAmplitudeMcpPost(input);
                const observer = innerHooks
                  .PostToolUse(input, toolUseID, hookOpts)
                  .catch((err: unknown) => {
                    logToFile('inner PostToolUse observer threw:', err);
                  });
                const gate = Promise.resolve(
                  recordPostToolUse(input, toolUseID, hookOpts),
                );
                const [, gateResult] = await Promise.all([observer, gate]);

                // Truncate the model's view of large Read responses so a
                // single big file doesn't sit in conversation history at
                // its full size for every subsequent turn. Defensive: if
                // anything throws, fall through to the gate's original
                // result so a malformed shape never breaks the agent.
                let truncation: ReturnType<typeof maybeTruncateLargeRead> =
                  null;
                try {
                  truncation = maybeTruncateLargeRead(input);
                } catch (err) {
                  logToFile('Read truncation pass threw:', err);
                }
                if (!truncation) return gateResult;

                logToFile(
                  `PostToolUse: truncated Read result, saved ${truncation.savedBytes.toLocaleString()} bytes from history`,
                );
                const existing = gateResult ?? {};
                const existingHook =
                  existing.hookSpecificOutput &&
                  typeof existing.hookSpecificOutput === 'object'
                    ? (existing.hookSpecificOutput as Record<string, unknown>)
                    : {};
                return {
                  ...existing,
                  hookSpecificOutput: {
                    ...existingHook,
                    hookEventName: 'PostToolUse',
                    updatedToolOutput: truncation.updatedToolOutput,
                  },
                };
              };

              // PreCompact: record + persist AgentState for in-run recovery,
              // then forward to the user-supplied handler (which saves the
              // cross-run WizardSession checkpoint + emits analytics).
              // Both fire even when `config?.onPreCompact` is absent so the
              // recovery snapshot is always written.
              const preCompactHandler = (input: {
                trigger: 'manual' | 'auto';
              }): void => {
                try {
                  agentState.recordCompaction();
                  agentState.persist();
                } catch (err) {
                  logToFile('PreCompact: agentState persist failed', err);
                }
                // Surface compaction start to orchestrators (NDJSON / agent
                // mode). The compaction itself takes 60–120s on large
                // contexts and was previously invisible — paired with the
                // `compaction_completed` event from `compact_boundary` below
                // it lets stall-visibility consumers render an accurate
                // "compacting context" indicator instead of a silent gap.
                try {
                  getUI().emitCompactionStarted?.({ trigger: input.trigger });
                } catch {
                  // Never let UI emit failures abort compaction.
                }
                config?.onPreCompact?.(input);
              };

              return buildHooksConfig({
                SessionStart: innerHooks.SessionStart,
                // PreToolUse fires for every tool regardless of permissionMode,
                // so it's our authoritative gate for Bash safety. canUseTool
                // alone is not invoked for Bash under
                // `tools: { preset: 'claude_code' } + permissionMode: 'acceptEdits'`.
                PreToolUse: preToolUse,
                PostToolUse: postToolUse,
                Stop: createStopHook(
                  config?.additionalFeatureQueue ?? (() => []),
                  () => authErrorDetected,
                  {
                    onFeatureStart: config?.onFeatureStart,
                    onFeatureComplete: config?.onFeatureComplete,
                  },
                ),
                PreCompact: createPreCompactHook(preCompactHandler),
                UserPromptSubmit: createUserPromptSubmitHook(agentState),
              });
            })(),
            // Allow aborting a stalled query so we can retry cleanly
            abortSignal: controller.signal,
          },
        });
        response = sdkResponse;

        // Start stale timer — reset on each received message
        resetStaleTimer();

        // Process the async generator — validate each message at the boundary
        for await (const rawMessage of sdkResponse) {
          // Reset the stale timer on every message EXCEPT the SDK's
          // "I'm about to wait on the API" envelope. The Claude Agent
          // SDK emits `system { subtype: 'status', status: 'requesting' }`
          // immediately *before* it starts waiting on the upstream — it
          // means "request sent, waiting for response", NOT "we made
          // progress." Resetting the timer here masks gateway hangs:
          // the model never streams a token, no further messages
          // arrive, and the user sat through a fresh 120s clock that
          // started from a non-event. Treat this envelope as non-
          // progress so the stall fires close to when the upstream
          // actually went silent.
          //
          // Other `system` subtypes (`init`, `api_retry`, `compact_boundary`)
          // ARE real progress events and continue to reset the timer.
          // We also gate `lastMessageTime`, `lastMessageType`, and
          // `receivedFirstMessage` here so that stall diagnostics
          // report elapsed time since the last real progress event,
          // not since a non-progress `requesting` envelope.
          if (!isStallNonProgressMessage(rawMessage)) {
            receivedFirstMessage = true;
            lastMessageTime = Date.now();
            const rawType =
              (rawMessage as Record<string, unknown>)?.type?.toString() ??
              'unknown';
            lastMessageType = rawType;
            resetStaleTimer();
            // Real progress arrived — clear any cold-start / compaction /
            // rate-limit-retry activity. Same line clears all three because
            // the only way a real message lands is for cold-start to have
            // finished, the compaction round-trip to have completed, or the
            // retry sleep to have elapsed. Cheap noop when already idle.
            //
            // EXCEPTION: `system { subtype: 'status', status: 'compacting' }`.
            // `isStallNonProgressMessage` correctly classifies this as real
            // work (compaction IS work), but the `compacting` envelope fires
            // *during* the compaction window — the same window where
            // `onPreCompact` just published the "Compacting context…"
            // activity. Clearing here would wipe that activity within
            // milliseconds of it being set, leaving the user staring at
            // 30-90s of silence with no indicator. Skip the clear so the
            // compaction activity persists; the next NON-status message
            // (the post-compaction user-prompt-submit / first model
            // message) clears it on its own pass through this branch.
            const isCompactingStatus =
              typeof rawMessage === 'object' &&
              rawMessage !== null &&
              (rawMessage as Record<string, unknown>).type === 'system' &&
              (rawMessage as Record<string, unknown>).subtype === 'status' &&
              (rawMessage as Record<string, unknown>).status === 'compacting';
            if (!isCompactingStatus) {
              try {
                getUI().setCurrentActivity(null);
              } catch {
                // UI may not be initialised in some test paths.
              }
            }
          }

          // A post-stream retry banner is active from a previous attempt's
          // failure. The fact that a message arrived at all means the new
          // attempt reached the upstream and is making progress, so drop
          // the banner now instead of waiting for the whole stream to
          // complete (which can take many minutes).
          if (postStreamRetryActive) {
            postStreamRetryActive = false;
            clearRetryBanner();
          }
          const parsed = safeParseSDKMessage(rawMessage);
          if (!parsed.ok) {
            logToFile(
              'Skipping malformed SDK message:',
              parsed.error.issues.map(
                (i) => `${i.path.join('.')}: ${i.message}`,
              ),
            );
            continue;
          }
          const message = parsed.message;

          // Partial-assistant text deltas flow through this branch. Surface
          // them in the status pill so the user sees the model's voice
          // during long tool calls — without this they stare at a static
          // spinner. handleSDKMessage doesn't need these (no collectedText
          // push, no system/result handling), so short-circuit and continue.
          if (message.type === 'stream_event') {
            const event = (message as { event?: unknown }).event;
            if (
              event !== null &&
              typeof event === 'object' &&
              (event as { type?: unknown }).type === 'content_block_delta'
            ) {
              const delta = (event as { delta?: unknown }).delta;
              if (
                delta !== null &&
                typeof delta === 'object' &&
                (delta as { type?: unknown }).type === 'text_delta' &&
                typeof (delta as { text?: unknown }).text === 'string'
              ) {
                enqueueStreamDelta((delta as { text: string }).text);
              }
            }
            continue;
          }

          // Any meaningful non-partial message means the model has stopped
          // streaming a paragraph and is producing a tool call or result —
          // drop the rolling pill buffer so the next paragraph starts fresh
          // instead of carrying tail words from the previous one.
          resetStreamPill();

          // Pass receivedSuccessResult so handleSDKMessage can suppress user-facing error
          // output for post-success cleanup errors while still logging them to file
          handleSDKMessage(
            message,
            options,
            spinner,
            collectedText,
            receivedSuccessResult,
            recentStatuses,
          );

          // Sniff this message for discovery-shaped tool results (package
          // manager, env-key probe, which skill loaded). Captured into
          // agentState so a subsequent retry can prepend a `<retry-recovery>`
          // hint that lets the model skip the same probes. No-op for
          // non-discovery messages; failures are swallowed so a malformed
          // tool_result never tanks the run.
          try {
            captureDiscoveryFromMessage(message, agentState);
          } catch (err) {
            logToFile(
              'captureDiscoveryFromMessage threw (non-fatal):',
              err instanceof Error ? err.message : String(err),
            );
          }

          try {
            middleware?.onMessage(message);
          } catch (e) {
            logToFile(
              `${AgentSignals.BENCHMARK} Middleware onMessage error:`,
              e,
            );
          }

          // Detect authentication failures so the stop hook can skip
          // reflection AND so agent-runner routes to the friendly
          // "your session expired, run again to log in" path instead
          // of the unhelpful "API Error 401, report to wizard@amplitude.com"
          // path. Patterns observed in production Sentry traces:
          //   - `authentication_failed`  — older OAuth fault code
          //   - `authentication_error`   — current Anthropic gateway pattern
          //                                ({"error":{"type":"authentication_error",...}})
          //   - `Invalid or expired token` — Anthropic 401 message body
          // Without these the agent run aborts as a generic API_ERROR and
          // the user sees the wrong remediation. See WIZARD-CLI-A / -7 / -F.
          if (
            message.type === 'result' &&
            message.is_error &&
            isAuthErrorMessage(JSON.stringify(message))
          ) {
            authErrorDetected = true;
            logToFile('Auth error detected in result message');
          }

          // Capture the SDK-reported `retry_delay_ms` from every `api_retry`
          // system message. The SDK already sleeps internally for this
          // duration (it's the Vertex / Anthropic `Retry-After` honour),
          // but if THIS attempt eventually fails and the OUTER loop has to
          // retry, we use the most-recent value as a floor for the outer
          // backoff via `computeRetryBackoffMs`. Without this clamp we'd
          // happily sleep 2s after the upstream said "wait 8s." Capturing
          // here (not just for 401s) covers 429 / 503 / generic 5xx storms.
          if (message.type === 'system' && message.subtype === 'api_retry') {
            const delay = (message as unknown as { retry_delay_ms?: unknown })
              .retry_delay_ms;
            if (
              typeof delay === 'number' &&
              Number.isFinite(delay) &&
              delay > 0
            ) {
              lastApiRetryDelayMs = delay;
            }
          }

          // Surface compaction completion to orchestrators. The SDK emits
          // `compact_boundary` immediately after `PreCompact` finishes the
          // summary; we already record the start via `emitCompactionStarted`
          // in the PreCompact hook, so this pair brackets the silent gap
          // for stall-visibility consumers. Best-effort field reads — the
          // SDK guarantees `pre_tokens` but `post_tokens` / `duration_ms`
          // are optional on partial compactions (preserved-segment shape).
          if (
            message.type === 'system' &&
            message.subtype === 'compact_boundary'
          ) {
            const meta =
              (
                message as unknown as {
                  compact_metadata?: {
                    trigger?: 'manual' | 'auto';
                    pre_tokens?: number;
                    post_tokens?: number;
                    duration_ms?: number;
                  };
                }
              ).compact_metadata ?? {};
            try {
              getUI().emitCompactionCompleted?.({
                trigger: meta.trigger ?? 'auto',
                preTokens:
                  typeof meta.pre_tokens === 'number' ? meta.pre_tokens : 0,
                postTokens:
                  typeof meta.post_tokens === 'number'
                    ? meta.post_tokens
                    : undefined,
                durationMs:
                  typeof meta.duration_ms === 'number'
                    ? meta.duration_ms
                    : undefined,
              });
            } catch {
              // Never let UI emit failures abort the stream.
            }
          }

          // Short-circuit the SDK's 401 retry storm. The SDK retries 401s up
          // to 10 times with exponential backoff (~3 minutes total) — but a
          // 401 is a credential problem that won't recover within the run.
          // After AUTH_RETRY_LIMIT consecutive auth-flavored api_retry
          // messages, abort the SDK query and route to the AUTH_ERROR outro
          // so the user sees a clear failure + manual-signup fallback
          // instead of a stuck spinner.
          if (
            message.type === 'system' &&
            message.subtype === 'api_retry' &&
            ((message as unknown as { error_status?: number }).error_status ===
              401 ||
              isAuthErrorMessage(JSON.stringify(message)))
          ) {
            authRetryCount++;
            logToFile(
              `Auth retry observed (${authRetryCount}/${AUTH_RETRY_LIMIT})`,
            );
            if (authRetryCount >= AUTH_RETRY_LIMIT) {
              authErrorDetected = true;
              logToFile(
                'Auth retries exceeded threshold — aborting agent query',
              );
              analytics.wizardCapture('agent auth retry aborted', {
                'retry count': authRetryCount,
                attempt: attempt + 1,
              });
              if (!controller.signal.aborted) {
                controller.abort('auth_failed');
              }
            }
          }

          if (message.type === 'system' && message.subtype === 'init') {
            for (const server of (
              message as unknown as {
                mcp_servers?: { name: string; status: string }[];
              }
            ).mcp_servers ?? []) {
              if (
                server.name === 'amplitude-wizard' &&
                server.status === 'needs-auth'
              ) {
                authErrorDetected = true;
                logToFile(
                  'Auth error detected: amplitude-wizard MCP needs-auth',
                );
              }
            }
          }

          // Signal completion when result received
          if (message.type === 'result') {
            // Track successful results before any potential cleanup errors
            // The SDK may emit a second error result during cleanup due to a race condition
            if (message.subtype === 'success' && !message.is_error) {
              receivedSuccessResult = true;
              lastResultMessage = message;
            }
            signalDone();
          }
        }

        // Check if the agent hit a transient API error (e.g. Vertex 400)
        // that warrants a retry rather than immediately giving up.
        clearTimeout(staleTimer);
        unsubscribePromptRelease();
        wizardSignal.removeEventListener('abort', onWizardAbort);
        const partialOutput = collectedText.join('\n');

        // Vertex / wizard-proxy payload-shape rejection — retrying is
        // futile because the next request body will be identically
        // rejected. Prefer the proxy's structured envelope (which carries
        // Vertex's actual error message), fall back to the legacy marker
        // for old proxy builds and the rare empty-body fallback.
        const structuredErr = !receivedSuccessResult
          ? parseStructuredUpstreamError(partialOutput)
          : null;
        const isPayloadRejection =
          (structuredErr !== null && isPayloadShapeRejection(structuredErr)) ||
          (!receivedSuccessResult &&
            partialOutput.includes(GATEWAY_INVALID_REQUEST_MARKER));
        if (isPayloadRejection) {
          logToFile(
            'Agent error: GATEWAY_INVALID_REQUEST (payload rejected by upstream — not retrying)',
            structuredErr ? { upstreamMessage: structuredErr.message } : {},
          );
          analytics.wizardCapture('agent gateway invalid request', {
            attempt,
            // Capture the actual rejection reason when available — was
            // truncated to "Invalid request sent to model provider" before
            // the proxy started passing structured errors through.
            'upstream message': structuredErr?.message?.slice(0, 2048) ?? null,
            'upstream status': structuredErr?.status ?? null,
          });
          gatewayInvalidRequestDetected = true;
          break;
        }

        const matchedTransientError =
          findTransientSdkOutputPattern(partialOutput);
        // Track upstream-gateway-shaped failures on EVERY attempt that
        // ended that way (even the last one, where we won't retry). This
        // is what lets the post-loop classifier compare
        // `upstreamGatewayFailures === attemptCount` to detect
        // GATEWAY_DOWN.
        //
        // Mirrors `isThrownErrorCountedAsUpstreamGatewayFailure` for the
        // thrown-error branch — keep the two label sets in sync. 408 is
        // counted here so a pure request-timeout storm arriving via
        // stream output (rather than as a thrown SDK error) still
        // triggers the GATEWAY_DOWN remediation copy. 5xx is intentionally
        // excluded — see the rationale on
        // `isThrownErrorCountedAsUpstreamGatewayFailure`.
        if (
          !receivedSuccessResult &&
          matchedTransientError &&
          (matchedTransientError.label === 'api_400' ||
            matchedTransientError.label === 'api_408' ||
            matchedTransientError.label === 'deadline_exceeded')
        ) {
          upstreamGatewayFailures++;
        }
        const hitTransientApiError =
          !receivedSuccessResult &&
          !authErrorDetected &&
          attempt < MAX_RETRIES &&
          !!matchedTransientError;

        if (hitTransientApiError && matchedTransientError) {
          logToFile(
            `Retrying after ${matchedTransientError.pattern} (next attempt: ${
              attempt + 2
            } of ${MAX_RETRIES + 1})`,
          );
          analytics.wizardCapture('agent api error retry', {
            attempt,
            error: matchedTransientError.label,
          });
          publishRetryBanner({
            attempt: attempt + 2,
            maxRetries: MAX_RETRIES + 1,
            errorStatus: extractApiErrorHttpStatusFromPattern(
              matchedTransientError.pattern,
            ),
            reason: matchedTransientError.pattern.includes('API Error')
              ? 'Upstream error'
              : `Upstream ${matchedTransientError.label}`,
          });
          postStreamRetryActive = true;
          lastRetryReason = 'transient_api';
          collectedText.length = 0;
          recentStatuses.length = 0;
          signalDone();
          // Drain the prior iterator before the next attempt — see issue #297.
          await drainPriorResponse(response);
          logSuppressedHookBridgeNoise(hookBridgeRaceSuppressed, attempt);
          continue;
        }

        // Clean completion — exit the retry loop
        postStreamRetryActive = false;
        clearRetryBanner();
        logSuppressedHookBridgeNoise(hookBridgeRaceSuppressed, attempt);
        break;
      } catch (innerError) {
        clearTimeout(staleTimer);
        unsubscribePromptRelease();
        wizardSignal.removeEventListener('abort', onWizardAbort);
        signalDone(); // unblock the prompt stream for this attempt
        // Always drain the prior iterator after an exception, regardless
        // of whether we'll retry. Cheap and defends against the hook
        // bridge race in issue #297.
        await drainPriorResponse(response);
        logSuppressedHookBridgeNoise(hookBridgeRaceSuppressed, attempt);

        // Wizard-wide abort (Ctrl+C / SIGINT / graceful-exit) — bail out
        // immediately without retrying. Falling through to the retry branch
        // would re-enter the stale-timer / SDK loop and waste the 2s grace
        // window the user is waiting on.
        if (wizardSignal.aborted) {
          logToFile('Agent loop exiting: wizard signal aborted');
          throw innerError;
        }

        // Auth-aborted — do not retry. The early-detect block in the message
        // loop fired controller.abort('auth_failed') after AUTH_RETRY_LIMIT
        // consecutive 401 retries; falling into the stall-retry branch would
        // re-run the same broken credentials. Break to the post-loop AUTH_ERROR
        // path instead.
        if (authErrorDetected) {
          logToFile('Agent loop exiting: auth error detected, not retrying');
          break;
        }

        // Stall-aborted or API error with retries remaining — try again
        if (controller.signal.aborted && attempt < MAX_RETRIES) {
          logToFile(
            `Retrying after stall (next attempt: ${attempt + 2} of ${
              MAX_RETRIES + 1
            })`,
          );
          publishRetryBanner({
            attempt: attempt + 2,
            maxRetries: MAX_RETRIES + 1,
            errorStatus: null,
            reason: 'Agent stalled',
          });
          postStreamRetryActive = true;
          lastRetryReason = 'stall';
          continue;
        }

        // Transient SDK/proxy error: malformed conversation history (tool_use
        // without tool_result), API errors, or Vertex-specific transient failures.
        // These resolve on a fresh retry with a new conversation.
        const errMsg =
          innerError instanceof Error ? innerError.message : String(innerError);

        // Vertex / wizard-proxy payload-shape rejection — see post-stream
        // branch for rationale. Try structured-error parse first, fall
        // back to the legacy marker.
        const structuredThrownErr = !receivedSuccessResult
          ? parseStructuredUpstreamError(errMsg)
          : null;
        const isThrownPayloadRejection =
          (structuredThrownErr !== null &&
            isPayloadShapeRejection(structuredThrownErr)) ||
          (!receivedSuccessResult &&
            errMsg.includes(GATEWAY_INVALID_REQUEST_MARKER));
        if (isThrownPayloadRejection) {
          logToFile(
            'Agent error: GATEWAY_INVALID_REQUEST (payload rejected by upstream — not retrying)',
            structuredThrownErr
              ? { upstreamMessage: structuredThrownErr.message }
              : {},
          );
          analytics.wizardCapture('agent gateway invalid request', {
            attempt,
            'upstream message':
              structuredThrownErr?.message?.slice(0, 2048) ?? null,
            'upstream status': structuredThrownErr?.status ?? null,
          });
          gatewayInvalidRequestDetected = true;
          break;
        }

        // Track upstream-gateway-shaped thrown errors on EVERY attempt
        // (including the final one). Mirrors the post-stream branch.
        if (
          !receivedSuccessResult &&
          isThrownErrorCountedAsUpstreamGatewayFailure(errMsg)
        ) {
          upstreamGatewayFailures++;
        }
        const isTransientSdkError =
          attempt < MAX_RETRIES &&
          !authErrorDetected &&
          isTransientThrownSdkErrorMessage(errMsg);
        if (isTransientSdkError) {
          // Cap at 2KB rather than 200 chars: Vertex JSON-schema rejection
          // messages routinely exceed 200 chars and the most diagnostic
          // part (the field name + expected type) was being truncated.
          // Sentry stack traces are bigger and we keep them.
          logToFile(
            `Retrying after transient SDK error (next attempt: ${
              attempt + 2
            } of ${MAX_RETRIES + 1}): ${errMsg.slice(0, 2048)}`,
          );
          analytics.wizardCapture('agent sdk error retry', {
            attempt,
            error: errMsg.slice(0, 2048),
          });
          publishRetryBanner({
            attempt: attempt + 2,
            maxRetries: MAX_RETRIES + 1,
            errorStatus: extractHttpStatusLooseFromMessage(errMsg),
            reason: 'Transient error',
          });
          postStreamRetryActive = true;
          lastRetryReason = 'sdk_thrown';
          collectedText.length = 0;
          recentStatuses.length = 0;
          continue;
        }

        // Already received a successful result — this is an SDK cleanup race condition
        if (receivedSuccessResult) {
          return completeWithSuccess(innerError as Error);
        }

        // Re-throw to the outer catch for API error handling / spinner cleanup
        throw innerError;
      }
    }

    const outputText = collectedText.join('\n');

    // Auth error takes priority — the agent cannot recover without re-authentication
    if (authErrorDetected) {
      logToFile('Agent error: AUTH_ERROR');
      spinner.stop('Authentication failed');
      _activeStatusReporter = undefined;
      return exitWithError(AgentErrorType.AUTH_ERROR);
    }

    // Structured error signals via `report_status` (replaces text-marker regex).
    if (reportedError) {
      const { code, detail } = reportedError;
      if (code === 'MCP_MISSING') {
        logToFile('Agent error: MCP_MISSING');
        spinner.stop(detail || "Couldn't reach Amplitude's setup service");
        _activeStatusReporter = undefined;
        return exitWithError(AgentErrorType.MCP_MISSING, detail);
      }
      if (code === 'RESOURCE_MISSING') {
        logToFile('Agent error: RESOURCE_MISSING');
        spinner.stop(detail || "Couldn't load setup instructions");
        _activeStatusReporter = undefined;
        return exitWithError(AgentErrorType.RESOURCE_MISSING, detail);
      }
      // Unknown structured error code — log it, let the regex-driven API-error
      // path below still run (API errors aren't reported via report_status).
      // `String()` coerce: control-flow narrowing reduces `code` to `never`
      // here in the type system, but `StatusReport.code` is typed `string` at
      // the source, so emitters can legitimately produce future codes the
      // narrowing doesn't know about. Coerce to string to satisfy
      // `@typescript-eslint/restrict-template-expressions` while preserving
      // the defensive log.
      logToFile(`Unhandled structured error code: ${String(code)}`);
    }

    // Backwards-compat: bundled skills (skills/integration/**) still emit
    // [ERROR-MCP-MISSING] / [ERROR-RESOURCE-MISSING] text markers per their
    // workflow files. #172 removed scanning, which silently dropped fatal
    // signals from skill-driven flows. Re-scan as a fallback so old skills
    // continue to surface errors correctly. The structured `report_status`
    // path above is preferred and runs first.
    if (outputText.includes('[ERROR-MCP-MISSING]')) {
      const idx = outputText.indexOf('[ERROR-MCP-MISSING]');
      const markerLine = outputText.slice(idx, idx + 200).split('\n')[0];
      logToFile('Agent error: MCP_MISSING (legacy text marker)');
      spinner.stop("Couldn't reach Amplitude's setup service");
      _activeStatusReporter = undefined;
      return exitWithError(AgentErrorType.MCP_MISSING, markerLine);
    }
    if (outputText.includes('[ERROR-RESOURCE-MISSING]')) {
      const idx = outputText.indexOf('[ERROR-RESOURCE-MISSING]');
      const markerLine = outputText.slice(idx, idx + 200).split('\n')[0];
      logToFile('Agent error: RESOURCE_MISSING (legacy text marker)');
      spinner.stop("Couldn't load setup instructions");
      _activeStatusReporter = undefined;
      return exitWithError(AgentErrorType.RESOURCE_MISSING, markerLine);
    }

    // Check for API errors (rate limits, etc.)
    // Extract just the API error line(s), not the entire output
    const apiErrorMatch = outputText.match(/API Error: [^\n]+/g);
    const apiErrorMessage = apiErrorMatch
      ? apiErrorMatch.join('\n')
      : 'Unknown API error';

    // Transport-level errors (RATE_LIMIT / API_ERROR / GATEWAY_DOWN) gate on
    // !receivedSuccessResult: the Claude Agent SDK retries some upstream
    // failures internally without tearing down the for-await stream. A
    // single wizard attempt can witness a failed `result` (is_error: true,
    // "API Error: 400 terminated"), then a fresh `system: init`, then a
    // clean `result` (is_error: false) — both result texts accumulate in
    // collectedText. If the inner retry succeeded, trust it instead of
    // reclassifying based on the stale "API Error: …" fragment. Auth and
    // structured/legacy [ERROR-…] markers above stay ungated because those
    // represent real wizard-level errors that the SDK cannot retry away.
    if (!receivedSuccessResult && outputText.includes('API Error: 429')) {
      logToFile('Agent error: RATE_LIMIT');
      spinner.stop('Rate limit exceeded');
      return exitWithError(AgentErrorType.RATE_LIMIT, apiErrorMessage);
    }

    // Wizard-proxy / Vertex AI rejected the payload shape. Distinct from
    // GATEWAY_DOWN (which is "every retry failed the same way") and from
    // RATE_LIMIT (which is recoverable on retry). The runner surfaces a
    // remediation message that points users at upgrading the wizard.
    //
    // Consult both `outputText` (the result-message path captures the
    // marker in `collectedText`) and the sticky flag (the catch path
    // sets the flag from the thrown `Error.message` because the throw
    // can fire before any messages reach `collectedText`).
    if (
      !receivedSuccessResult &&
      (gatewayInvalidRequestDetected ||
        outputText.includes(GATEWAY_INVALID_REQUEST_MARKER))
    ) {
      logToFile('Agent error: GATEWAY_INVALID_REQUEST');
      spinner.stop('Wizard request rejected by gateway');
      return exitWithError(
        AgentErrorType.GATEWAY_INVALID_REQUEST,
        apiErrorMessage.includes('Unknown')
          ? GATEWAY_INVALID_REQUEST_MARKER
          : apiErrorMessage,
      );
    }

    // Every attempt died with an upstream-gateway-shaped error and we
    // never observed a successful result — the gateway is unhealthy,
    // not the wizard. Surface as GATEWAY_DOWN so the runner can show a
    // specific, actionable message (try ANTHROPIC_API_KEY bypass).
    if (
      attemptCount > 0 &&
      upstreamGatewayFailures >= attemptCount &&
      !receivedSuccessResult
    ) {
      logToFile(
        `Agent error: GATEWAY_DOWN (${upstreamGatewayFailures}/${attemptCount} attempts failed upstream)`,
      );
      spinner.stop('LLM gateway unavailable');
      return exitWithError(AgentErrorType.GATEWAY_DOWN, apiErrorMessage);
    }

    if (!receivedSuccessResult && outputText.includes('API Error:')) {
      logToFile('Agent error: API_ERROR');
      spinner.stop('API error occurred');
      return exitWithError(AgentErrorType.API_ERROR, apiErrorMessage);
    }

    return completeWithSuccess();
  } catch (error) {
    // Signal done to unblock the async generator
    signalDone();

    // Auth-aborted while the SDK was still streaming — the early-detect path
    // fired controller.abort('auth_failed') and the resulting AbortError
    // bubbled up. Surface AUTH_ERROR so agent-runner shows the friendly
    // re-auth / manual-signup outro instead of a generic API_ERROR.
    if (authErrorDetected) {
      logToFile('Agent error (caught): AUTH_ERROR');
      spinner.stop('Authentication failed');
      _activeStatusReporter = undefined;
      return exitWithError(AgentErrorType.AUTH_ERROR);
    }

    // If we already received a successful result, the error is from SDK cleanup
    // This happens due to a race condition: the SDK tries to send a cleanup command
    // after the prompt stream closes, but streaming mode is still active.
    // See: https://github.com/anthropics/claude-agent-sdk-typescript/issues/41
    if (receivedSuccessResult) {
      return completeWithSuccess(error as Error);
    }

    // Check if we collected an API error before the exception was thrown
    const outputText = collectedText.join('\n');

    // Extract just the API error line(s), not the entire output
    const apiErrorMatch = outputText.match(/API Error: [^\n]+/g);
    const apiErrorMessage = apiErrorMatch
      ? apiErrorMatch.join('\n')
      : 'Unknown API error';

    if (outputText.includes('API Error: 429')) {
      logToFile('Agent error (caught): RATE_LIMIT');
      spinner.stop('Rate limit exceeded');
      return exitWithError(AgentErrorType.RATE_LIMIT, apiErrorMessage);
    }

    // See note in the non-throwing return path above — Vertex / wizard-proxy
    // payload-shape rejection. Distinct from GATEWAY_DOWN. Consult the
    // sticky flag for thrown-error cases where the marker came from the
    // exception message rather than the streamed output.
    if (
      gatewayInvalidRequestDetected ||
      outputText.includes(GATEWAY_INVALID_REQUEST_MARKER)
    ) {
      logToFile('Agent error (caught): GATEWAY_INVALID_REQUEST');
      spinner.stop('Wizard request rejected by gateway');
      return exitWithError(
        AgentErrorType.GATEWAY_INVALID_REQUEST,
        apiErrorMessage.includes('Unknown')
          ? GATEWAY_INVALID_REQUEST_MARKER
          : apiErrorMessage,
      );
    }

    // Backwards-compat fallback for bundled skills emitting legacy text
    // markers — see note in the non-throwing return path.
    if (outputText.includes('[ERROR-MCP-MISSING]')) {
      const idx = outputText.indexOf('[ERROR-MCP-MISSING]');
      const markerLine = outputText.slice(idx, idx + 200).split('\n')[0];
      logToFile('Agent error (caught): MCP_MISSING (legacy text marker)');
      spinner.stop("Couldn't reach Amplitude's setup service");
      return exitWithError(AgentErrorType.MCP_MISSING, markerLine);
    }
    if (outputText.includes('[ERROR-RESOURCE-MISSING]')) {
      const idx = outputText.indexOf('[ERROR-RESOURCE-MISSING]');
      const markerLine = outputText.slice(idx, idx + 200).split('\n')[0];
      logToFile('Agent error (caught): RESOURCE_MISSING (legacy text marker)');
      spinner.stop("Couldn't load setup instructions");
      return exitWithError(AgentErrorType.RESOURCE_MISSING, markerLine);
    }

    // See note in the non-throwing return path above — surface
    // GATEWAY_DOWN when every attempt died upstream.
    if (
      attemptCount > 0 &&
      upstreamGatewayFailures >= attemptCount &&
      !receivedSuccessResult
    ) {
      logToFile(
        `Agent error (caught): GATEWAY_DOWN (${upstreamGatewayFailures}/${attemptCount} attempts failed upstream)`,
      );
      spinner.stop('LLM gateway unavailable');
      return exitWithError(AgentErrorType.GATEWAY_DOWN, apiErrorMessage);
    }

    if (outputText.includes('API Error:')) {
      logToFile('Agent error (caught): API_ERROR');
      spinner.stop('API error occurred');
      return exitWithError(AgentErrorType.API_ERROR, apiErrorMessage);
    }

    // No API error found, re-throw the original exception
    spinner.stop(errorMessage);
    getUI().log.error(`Error: ${(error as Error).message}`);
    logToFile('Agent run failed:', error);
    debug('Full error:', error);
    // Record an unclassified terminal so the run-summary event still
    // fires for orchestrators watching this run.
    recordTerminal({
      kind: 'error',
      error: AgentErrorType.API_ERROR,
      message: (error as Error).message,
    });
    throw error;
  } finally {
    clearInterval(heartbeatInterval);
    // `dispose()` closes EVERY watcher the helper created plus any
    // pending poll-fallback timer — there's no path where one of the
    // two file handles can leak when both canonical and legacy paths
    // exist (the bug that was previously inline here).
    eventPlanHandle?.dispose();
    dashboardHandle?.dispose();
    clearRetryBanner();
    // Belt-and-braces: every activity setter inside the run has a paired
    // clear (cold-start clears on first message; mcp-tool clears on
    // PostToolUse; rate-limit-retry clears via clearRetryBanner above).
    // But aborted / crashed runs can exit the loop with one of those still
    // active — leaving the ActivityLine spinning forever after the
    // OutroScreen has rendered. Force-clear here so the post-run UI is
    // guaranteed clean regardless of which path we exit on.
    try {
      getUI().setCurrentActivity(null);
    } catch {
      // UI may not be initialised in some test paths.
    }
    _activeStatusReporter = undefined;

    // Consolidated run-summary event. One row per agent run carrying the
    // counters orchestrators need to detect "user stuck in retry loop"
    // patterns without having to stitch multiple per-attempt events.
    // Fires from the finally block so it lands on every termination
    // path (success, classified error, rethrown). First-write-wins on
    // `terminalState` means a cleanup error doesn't clobber the real
    // outcome.
    try {
      const summaryDurationMs = Date.now() - startTime;
      analytics.wizardCapture('agent run summary', {
        'duration ms': summaryDurationMs,
        'duration seconds': Math.round(summaryDurationMs / 1000),
        attempts: attemptCount,
        'upstream gateway failures': upstreamGatewayFailures,
        'gateway invalid request': gatewayInvalidRequestDetected,
        'terminal status':
          terminalState?.kind === 'success'
            ? 'success'
            : terminalState?.kind === 'error'
            ? terminalState.error
            : 'unknown',
        'terminal message':
          terminalState?.kind === 'error'
            ? terminalState.message?.slice(0, 2048) ?? null
            : null,
        // Helps detect "many retries even though we ultimately succeeded" —
        // a sign the gateway is degraded but not down.
        'retried successfully':
          terminalState?.kind === 'success' && upstreamGatewayFailures > 0,
      });
    } catch (e) {
      // Never let a telemetry hiccup mask the real outcome.
      logToFile('Agent run summary emit failed:', e);
    }
  }
}

/**
 * Handle SDK messages and provide user feedback
 *
 * @param receivedSuccessResult - If true, suppress user-facing error output for cleanup errors
 *                          while still logging to file. The SDK may emit a second error
 *                          result after success due to cleanup race conditions.
 */
function handleSDKMessage(
  message: SDKMessage,
  options: WizardOptions,
  spinner: SpinnerHandle,
  collectedText: string[],
  receivedSuccessResult = false,
  recentStatuses?: string[],
): void {
  logToFile(`SDK Message: ${message.type}`, JSON.stringify(message, null, 2));

  if (options.debug) {
    debug(`SDK Message type: ${message.type}`);
  }

  switch (message.type) {
    case 'assistant': {
      // Extract text content from assistant messages
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            collectedText.push(block.text);
            // Backwards-compat: bundled skills (skills/integration/**)
            // still emit `[STATUS] <text>` markers per their workflow
            // files. #172 removed scanning here in favor of a structured
            // `report_status` MCP tool, but didn't migrate the skills —
            // silently breaking the spinner for skill-driven flows.
            // Forward each marker match to the spinner. The structured
            // path runs in parallel; whichever fires first wins.
            const markerRe = /\[STATUS\]\s+([^\n]+)/g;
            for (const m of block.text.matchAll(markerRe)) {
              const detail = m[1].trim();
              if (!detail) continue;
              spinner.message(detail.slice(0, 80));
              if (recentStatuses) {
                recentStatuses.push(detail);
                if (recentStatuses.length > 3) recentStatuses.shift();
              }
            }
          }

          // Intercept TodoWrite tool_use blocks for task progression
          if (
            block.type === 'tool_use' &&
            block.name === 'TodoWrite' &&
            block.input &&
            Array.isArray(block.input.todos)
          ) {
            getUI().syncTodos(
              block.input.todos as Array<{
                content: string;
                status: string;
                activeForm?: string;
              }>,
            );
          }
        }
      }
      break;
    }

    case 'result': {
      // Check is_error flag - can be true even when subtype is 'success'
      if (message.is_error) {
        logToFile('Agent result with error:', message.result);
        if (typeof message.result === 'string') {
          collectedText.push(message.result);
        }
        // Only show errors to user if we haven't already succeeded.
        // Post-success errors are SDK cleanup noise (telemetry failures, streaming
        // mode race conditions). Full message already logged above via JSON dump.
        //
        // Cap the user-visible message at 2KB at the SOURCE — Anthropic
        // SDK exceptions sometimes include the entire failing SSE stream
        // (40-50KB of model id, signature blobs, partial JSON deltas)
        // serialized into a single string. Past sessions surfaced 50KB
        // `log.message` strings that polluted orchestrator context.
        // `truncateLogMessage` is the same helper the NDJSON emit layer
        // uses; capping here keeps the on-disk verbose log bounded too.
        if (message.errors && !receivedSuccessResult) {
          for (const err of message.errors) {
            const errStr = typeof err === 'string' ? err : String(err);
            const capped = truncateLogMessage(errStr);
            getUI().log.error(`Error: ${capped}`);
            logToFile('ERROR:', capped);
          }
        }
      } else if (message.subtype === 'success') {
        logToFile('Agent completed successfully');
        if (typeof message.result === 'string') {
          collectedText.push(message.result);
        }
      } else {
        logToFile('Agent result with error:', message.result);
        // Error result - only show to user if we haven't already succeeded.
        // Full message already logged above via JSON dump. Cap each
        // error string at 2KB at the source (same rationale as the
        // `is_error` branch above): Anthropic SDK exceptions sometimes
        // serialize the entire failing SSE stream into the error text.
        if (message.errors && !receivedSuccessResult) {
          for (const err of message.errors) {
            const errStr = typeof err === 'string' ? err : String(err);
            const capped = truncateLogMessage(errStr);
            getUI().log.error(`Error: ${capped}`);
            logToFile('ERROR:', capped);
          }
        }
      }
      break;
    }

    case 'system': {
      if (message.subtype === 'init') {
        const mcpStatuses = message.mcp_servers ?? [];
        logToFile('Agent session initialized', {
          model: message.model,
          tools: message.tools?.length,
          mcpServers: mcpStatuses,
        });

        for (const server of mcpStatuses) {
          logToFile(`MCP "${server.name}": ${server.status}`);
          if (server.status !== 'connected') {
            getUI().log.warn(
              `MCP server "${server.name}" is not connected (${server.status})`,
            );
          }
        }
      }
      break;
    }

    default:
      // Log other message types for debugging
      if (options.debug) {
        debug(`Unhandled message type: ${message.type}`);
      }
      break;
  }
}

/**
 * Sniff a single SDK message for discovery-shaped tool calls / results
 * (package manager probe, env-key probe, which skill loaded) and stash a
 * compact summary into the supplied AgentState. The retry path reads
 * those summaries via `buildRetryHint` to skip redundant probes on
 * attempt N+1.
 *
 * Strategy:
 *   - assistant.tool_use: bump per-tool counters (used for diagnostics).
 *   - user.tool_result: extract the relevant signal for our cache list.
 *
 * The set of tools we care about is intentionally narrow — these are the
 * cold-start probes that dominate the early seconds of a run. Adding more
 * here grows the retry-hint block, which costs prompt tokens; bias toward
 * "would skipping this tool call save more than the hint costs?".
 *
 * Exported for unit tests.
 */
export function captureDiscoveryFromMessage(
  message: SDKMessage,
  state: AgentState,
): void {
  if (message.type === 'assistant') {
    const content = message.message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (
        block?.type === 'tool_use' &&
        typeof (block as { name?: unknown }).name === 'string'
      ) {
        const toolName = (block as { name: string }).name;
        state.recordToolUse(toolName);
        // Skill loads: capture the skill ID directly off the tool input
        // (no wait for tool_result needed — the agent commits to the
        // skill at the tool_use site).
        if (toolName === 'Skill') {
          const input = (block as { input?: unknown }).input;
          if (input && typeof input === 'object') {
            const skillId = (input as { skill?: unknown }).skill;
            if (typeof skillId === 'string' && skillId.length <= 200) {
              state.recordDiscovery('Skill loaded', skillId);
            }
          }
        }
      }
    }
    return;
  }

  if (message.type !== 'user') return;
  const content = message.message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block?.type !== 'tool_result') continue;
    // SDKContentBlock's tool_result variant types `content` as
    // (string | ContentBlock[]) — narrow defensively. Array shapes
    // (multimodal tool replies) aren't useful for our discovery sniff.
    const rawContent = (block as unknown as { content?: unknown }).content;
    const text = typeof rawContent === 'string' ? rawContent : null;
    if (!text) continue;

    // Tool name isn't on the tool_result block itself — `tool_use_result`
    // sits at the message root. The shape is the SDK's own envelope; we
    // try a couple of lookup paths defensively.
    const envelope = (
      message as unknown as {
        tool_use_result?: { commandName?: string; tool_name?: string };
      }
    ).tool_use_result;
    const toolName =
      envelope?.commandName ?? envelope?.tool_name ?? '<unknown>';

    if (toolName === 'mcp__wizard-tools__detect_package_manager') {
      // Result text has shape "Detected: pnpm (lockfile: pnpm-lock.yaml)…"
      // or similar; just stash the first line so the next attempt can
      // skip the probe and use the same install command.
      const firstLine = text.split('\n')[0]?.trim();
      if (firstLine) {
        state.recordDiscovery('Package manager (already probed)', firstLine);
      }
    } else if (toolName === 'mcp__wizard-tools__check_env_keys') {
      // Result lists which Amplitude env keys are present in .env files.
      // Trim to the first 3 lines — full output can be hundreds of bytes.
      const summary = text.split('\n').slice(0, 3).join(' | ').trim();
      if (summary) {
        state.recordDiscovery(
          'Env keys (already probed)',
          summary.slice(0, 200),
        );
      }
    }
  }
}
