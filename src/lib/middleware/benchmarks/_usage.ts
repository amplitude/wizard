/**
 * Shared usage-math helpers for benchmark plugins.
 *
 * The wizard tracks "total input" as the sum of plain input tokens plus
 * both cache flavours (read + creation). This matches the conceptual
 * "context size" the SDK shipped — see TokenTrackerPlugin and
 * ContextSizeTrackerPlugin docstrings. Centralising the formula keeps
 * the two plugins from drifting if a new cache bucket ever appears.
 */

import type { SDKUsage } from '../types';

/**
 * Returns `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
 * for a single SDK usage entry. Returns 0 for null/undefined to keep call
 * sites branch-free.
 */
export function inputTokensWithCache(
  usage: SDKUsage | null | undefined,
): number {
  if (!usage) return 0;
  return (
    Number(usage.input_tokens ?? 0) +
    Number(usage.cache_read_input_tokens ?? 0) +
    Number(usage.cache_creation_input_tokens ?? 0)
  );
}
