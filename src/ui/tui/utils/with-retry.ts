/**
 * Retry wrapper with exponential backoff.
 *
 * Retries transient failures (5xx, network errors) but bails immediately
 * on client errors (4xx except 429) since retrying won't help.
 */

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  label?: string;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { retries = 2, baseDelayMs = 1000, label = 'operation' } = opts;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      // Don't retry client errors (except rate limiting)
      if (isClientError(err)) throw err;
      if (attempt === retries) throw err;

      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`${label}: unreachable`);
}

/** 4xx errors (except 429) are not retryable. */
function isClientError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: number }).status;
    return status >= 400 && status < 500 && status !== 429;
  }
  return false;
}
