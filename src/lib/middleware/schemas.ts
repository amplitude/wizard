/**
 * Zod schemas for SDK message validation.
 *
 * These schemas enforce the structural types defined in types.ts at runtime.
 * Use `safeParseSDKMessage` at ingestion boundaries (the for-await loop in
 * agent-interface.ts and the middleware pipeline) so malformed messages are
 * logged and skipped rather than causing uncaught property-access errors.
 *
 * The SDK message schema is a `z.discriminatedUnion('type', ...)` so each
 * variant (assistant, user, system, result, etc.) gets per-branch validation
 * and zod can narrow on `message.type` for downstream consumers. Each branch
 * uses `.passthrough()` so unknown forward-compatible fields don't cause
 * parse failures — the SDK adds new fields between minor versions and the
 * wizard has historically tolerated that.
 *
 * The `Other` branch (any unknown `type` string) is intentional: when the
 * SDK ships a brand new top-level message variant we want to log and skip
 * it, not throw. We accept any string `type` there and let the consuming
 * switch fall through to the default arm.
 */

import { z } from 'zod';
import type {
  SDKMessage,
  SDKUsage,
  SDKContentBlock,
  SDKCompactMetadata,
  SDKModelUsageEntry,
} from './types';

// ── Leaf schemas ────────────────────────────────────────────────────────────

export const sdkUsageSchema: z.ZodType<SDKUsage> = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional(),
  cache_creation: z
    .object({
      ephemeral_5m_input_tokens: z.number().optional(),
      ephemeral_1h_input_tokens: z.number().optional(),
    })
    .optional(),
  total_cost_usd: z.number().optional(),
});

export const sdkContentBlockSchema: z.ZodType<SDKContentBlock> = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    name: z.string().optional(),
    input: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const sdkCompactMetadataSchema: z.ZodType<SDKCompactMetadata> = z.object(
  {
    pre_tokens: z.number().optional(),
    trigger: z.string().optional(),
  },
);

export const sdkModelUsageEntrySchema: z.ZodType<SDKModelUsageEntry> = z.object(
  {
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    cacheCreationInputTokens: z.number().optional(),
    cacheReadInputTokens: z.number().optional(),
  },
);

const sdkMessageBodySchema = z
  .object({
    id: z.string().optional(),
    usage: sdkUsageSchema.optional(),
    content: z.array(sdkContentBlockSchema).optional(),
  })
  .passthrough();

const sdkMcpServerSchema = z
  .object({ name: z.string(), status: z.string() })
  .passthrough();

// ── Per-type branch schemas ─────────────────────────────────────────────────
//
// Each branch covers a `type` literal observed in the SDK union
// (see node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts → SDKMessage).
// Required fields stay required; optional / forward-compat fields are
// modeled loosely with `.passthrough()` on each branch.

export const sdkAssistantMessageSchema = z
  .object({
    type: z.literal('assistant'),
    subtype: z.string().optional(),
    message: sdkMessageBodySchema.optional(),
    usage: sdkUsageSchema.optional(),
    total_cost_usd: z.number().optional(),
    modelUsage: z.record(z.string(), sdkModelUsageEntrySchema).optional(),
  })
  .passthrough();

export const sdkUserMessageSchema = z
  .object({
    type: z.literal('user'),
    subtype: z.string().optional(),
    message: sdkMessageBodySchema.optional(),
  })
  .passthrough();

export const sdkSystemMessageSchema = z
  .object({
    type: z.literal('system'),
    subtype: z.string().optional(),
    model: z.string().optional(),
    tools: z.array(z.unknown()).optional(),
    mcp_servers: z.array(sdkMcpServerSchema).optional(),
    compact_metadata: sdkCompactMetadataSchema.optional(),
  })
  .passthrough();

export const sdkResultMessageSchema = z
  .object({
    type: z.literal('result'),
    subtype: z.string().optional(),
    is_error: z.boolean().optional(),
    result: z.string().optional(),
    errors: z.array(z.string()).optional(),
    usage: sdkUsageSchema.optional(),
    total_cost_usd: z.number().optional(),
    num_turns: z.number().optional(),
    modelUsage: z.record(z.string(), sdkModelUsageEntrySchema).optional(),
  })
  .passthrough();

export const sdkStreamEventMessageSchema = z
  .object({
    type: z.literal('stream_event'),
    subtype: z.string().optional(),
  })
  .passthrough();

/**
 * Catch-all branch for SDK message types the wizard doesn't model explicitly
 * (status, auth_status, tool_progress, rate_limit_event, prompt_suggestion,
 * tool_use_summary, etc.). Captures any non-matching `type` string so unknown
 * variants parse successfully and downstream switch statements fall through
 * to their default arm rather than crashing.
 */
export const sdkOtherMessageSchema = z
  .object({
    type: z.string(),
    subtype: z.string().optional(),
  })
  .passthrough()
  .refine(
    (v) =>
      v.type !== 'assistant' &&
      v.type !== 'user' &&
      v.type !== 'system' &&
      v.type !== 'result' &&
      v.type !== 'stream_event',
    { message: 'matched by a more-specific branch' },
  );

// ── Discriminated union ─────────────────────────────────────────────────────

const sdkKnownMessageSchema = z.discriminatedUnion('type', [
  sdkAssistantMessageSchema,
  sdkUserMessageSchema,
  sdkSystemMessageSchema,
  sdkResultMessageSchema,
  sdkStreamEventMessageSchema,
]);

/**
 * Validates one SDK message. Tries the discriminated union of known types
 * first (assistant / user / system / result / stream_event); falls back to
 * the catch-all `sdkOtherMessageSchema` for forward-compatible unknown types.
 *
 * Cast to `z.ZodType<SDKMessage>` because the structural `SDKMessage` interface
 * in types.ts has a `[key: string]: unknown` index signature, so each branch
 * (with `.passthrough()`) is a structural subtype.
 */
export const sdkMessageSchema = z.union([
  sdkKnownMessageSchema,
  sdkOtherMessageSchema,
]) as unknown as z.ZodType<SDKMessage>;

// ── Per-branch narrow types ─────────────────────────────────────────────────
//
// Exported so future refactors can drop `as unknown as` casts in
// handleSDKMessage (out of scope for this PR).

export type AssistantMessage = z.infer<typeof sdkAssistantMessageSchema>;
export type UserMessage = z.infer<typeof sdkUserMessageSchema>;
export type SystemMessage = z.infer<typeof sdkSystemMessageSchema>;
export type ResultMessage = z.infer<typeof sdkResultMessageSchema>;
export type StreamEventMessage = z.infer<typeof sdkStreamEventMessageSchema>;
export type OtherMessage = z.infer<typeof sdkOtherMessageSchema>;

// ── Parse helpers ───────────────────────────────────────────────────────────

export type SDKMessageParseResult =
  | { ok: true; message: SDKMessage }
  | { ok: false; error: z.ZodError };

/**
 * Validate an unknown value as an SDKMessage.
 * Returns a discriminated result so callers can log and skip bad messages.
 */
export function safeParseSDKMessage(value: unknown): SDKMessageParseResult {
  const result = sdkMessageSchema.safeParse(value);
  if (result.success) {
    return { ok: true, message: result.data };
  }
  return { ok: false, error: result.error };
}
