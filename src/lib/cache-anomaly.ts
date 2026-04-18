export const WARM_RUN_TOKEN_FLOOR = 5000;
export const CACHE_MISS_THRESHOLD = 0.4;

export function shouldEmitCacheMissAnomaly(params: {
  cacheHitRate: number | null;
  inputTokens: number;
}): boolean {
  const { cacheHitRate, inputTokens } = params;
  return (
    cacheHitRate !== null &&
    inputTokens >= WARM_RUN_TOKEN_FLOOR &&
    cacheHitRate < CACHE_MISS_THRESHOLD
  );
}
