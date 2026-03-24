/**
 * Zod schemas for SDK message validation.
 *
 * These schemas enforce the structural types defined in types.ts at runtime.
 * Use `safeParseSDKMessage` at ingestion boundaries (the for-await loop in
 * agent-interface.ts and the middleware pipeline) so malformed messages are
 * logged and skipped rather than causing uncaught property-access errors.
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

// ── SDKMessage ──────────────────────────────────────────────────────────────

export const sdkMessageSchema: z.ZodType<SDKMessage> = z
  .object({
    type: z.string(),
    subtype: z.string().optional(),
    message: z
      .object({
        id: z.string().optional(),
        usage: sdkUsageSchema.optional(),
        content: z.array(sdkContentBlockSchema).optional(),
      })
      .passthrough()
      .optional(),
    compact_metadata: sdkCompactMetadataSchema.optional(),
    is_error: z.boolean().optional(),
    result: z.string().optional(),
    errors: z.array(z.string()).optional(),
    model: z.string().optional(),
    tools: z.array(z.unknown()).optional(),
    mcp_servers: z
      .array(z.object({ name: z.string(), status: z.string() }))
      .optional(),
    usage: sdkUsageSchema.optional(),
    total_cost_usd: z.number().optional(),
    num_turns: z.number().optional(),
    modelUsage: z.record(z.string(), sdkModelUsageEntrySchema).optional(),
  })
  .passthrough();

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
