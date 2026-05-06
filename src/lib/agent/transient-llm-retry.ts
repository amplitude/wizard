/**
 * Transient LLM / gateway error classification for {@link runAgent} retry loops.
 * Keeps pattern strings and HTTP extraction in one place (Phase D).
 */

/**
 * Verbatim error wrapper Thunder's `wizard-proxy` returns when Vertex AI
 * rejects the upstream request body (see Thunder's
 * `src/wizard-proxy/router.ts:917-974` — the proxy clamps every 400 from
 * the model provider to this exact string and hides the real reason).
 */
export const GATEWAY_INVALID_REQUEST_MARKER =
  'Invalid request sent to model provider';

export const AGENT_TRANSIENT_SDK_OUTPUT_PATTERNS = [
  { pattern: 'API Error: 400', label: 'api_400' },
  { pattern: 'API Error: 408', label: 'api_408' },
  { pattern: 'API Error: 503', label: 'api_503' },
  { pattern: 'API Error: 529', label: 'api_529' },
  { pattern: 'DEADLINE_EXCEEDED', label: 'deadline_exceeded' },
] as const;

export type TransientSdkOutputMatch =
  (typeof AGENT_TRANSIENT_SDK_OUTPUT_PATTERNS)[number];

export function findTransientSdkOutputPattern(
  partialOutput: string,
): TransientSdkOutputMatch | undefined {
  return AGENT_TRANSIENT_SDK_OUTPUT_PATTERNS.find((m) =>
    partialOutput.includes(m.pattern),
  );
}

/** Pull a 3-digit status out of an `API Error: NNN ...` pattern. */
export function extractApiErrorHttpStatusFromPattern(
  pattern: string,
): number | null {
  const m = pattern.match(/API Error: (\d{3})/);
  return m ? Number(m[1]) : null;
}

/** Extract the first HTTP status seen in an error message, if any. */
export function extractHttpStatusLooseFromMessage(msg: string): number | null {
  const m = msg.match(/\b([4-5]\d{2})\b/);
  return m ? Number(m[1]) : null;
}

/** Thrown-error branch: count toward upstream 400 / deadline storm detection. */
export function isThrownErrorCountedAsUpstreamGatewayFailure(
  errMsg: string,
): boolean {
  return (
    errMsg.includes('API Error: 400') || errMsg.includes('DEADLINE_EXCEEDED')
  );
}

/**
 * Thrown-error branch: worth a full retry (fresh conversation / drain prior
 * stream) when below MAX_RETRIES.
 */
export function isTransientThrownSdkErrorMessage(errMsg: string): boolean {
  return (
    errMsg.includes('tool_use') ||
    errMsg.includes('tool_result') ||
    errMsg.includes('API Error: 400') ||
    errMsg.includes('API Error: 408') ||
    errMsg.includes('API Error: 503') ||
    errMsg.includes('API Error: 529') ||
    errMsg.includes('DEADLINE_EXCEEDED') ||
    errMsg.includes('Stream closed') ||
    errMsg.includes('invalid_request_error')
  );
}
