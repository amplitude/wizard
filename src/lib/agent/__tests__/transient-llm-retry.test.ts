import { describe, it, expect } from 'vitest';

import {
  findTransientSdkOutputPattern,
  extractApiErrorHttpStatusFromPattern,
  GATEWAY_INVALID_REQUEST_MARKER,
  isPayloadShapeRejection,
  isThrownErrorCountedAsUpstreamGatewayFailure,
  isTransientThrownSdkErrorMessage,
  parseStructuredUpstreamError,
} from '../transient-llm-retry.js';

describe('transient-llm-retry', () => {
  it('findTransientSdkOutputPattern matches partial stream text', () => {
    const m = findTransientSdkOutputPattern('foo\nAPI Error: 503 bar');
    expect(m?.label).toBe('api_503');
  });

  it('extractApiErrorHttpStatusFromPattern parses API Error prefix', () => {
    expect(extractApiErrorHttpStatusFromPattern('API Error: 429 x')).toBe(429);
    expect(extractApiErrorHttpStatusFromPattern('no status')).toBeNull();
  });

  it('GATEWAY_INVALID_REQUEST_MARKER is stable for proxy contract tests', () => {
    expect(GATEWAY_INVALID_REQUEST_MARKER).toContain('model provider');
  });

  it('isThrownErrorCountedAsUpstreamGatewayFailure', () => {
    expect(isThrownErrorCountedAsUpstreamGatewayFailure('API Error: 400')).toBe(
      true,
    );
    expect(
      isThrownErrorCountedAsUpstreamGatewayFailure('DEADLINE_EXCEEDED'),
    ).toBe(true);
    expect(isThrownErrorCountedAsUpstreamGatewayFailure('API Error: 503')).toBe(
      false,
    );
  });

  it('isTransientThrownSdkErrorMessage covers tool and stream cases', () => {
    expect(isTransientThrownSdkErrorMessage('tool_use without result')).toBe(
      true,
    );
    expect(isTransientThrownSdkErrorMessage('Stream closed')).toBe(true);
    expect(isTransientThrownSdkErrorMessage('unrelated')).toBe(false);
  });
});

describe('parseStructuredUpstreamError', () => {
  // The shape `wizard-proxy/router.ts:325 buildUpstreamErrorBody` returns
  // for a Vertex 400 today, after the proxy parses Vertex's body and
  // sanitizes sensitive fields. The Anthropic SDK wraps it as
  // `API Error: NNN <stringified-json>` in thrown errors and stream output.
  it('extracts a payload-shape rejection (400 with upstream)', () => {
    const text =
      'API Error: 400 {"type":"error","error":{"type":"api_error","message":"Invalid value at \'tools[0].input_schema.additionalProperties\'","upstream":{"error":{"code":400}}}}';
    const parsed = parseStructuredUpstreamError(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.status).toBe(400);
    expect(parsed?.message).toContain('additionalProperties');
    expect(parsed?.upstream).toBeDefined();
    expect(isPayloadShapeRejection(parsed!)).toBe(true);
  });

  it('treats a 400 without upstream as NOT a payload-shape rejection', () => {
    // Older proxy builds, or a non-Vertex 400 (rate, auth) — should fall
    // through to the generic transient classifier rather than short-circuit.
    const text =
      'API Error: 400 {"type":"error","error":{"type":"rate_limit","message":"slow down"}}';
    const parsed = parseStructuredUpstreamError(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.status).toBe(400);
    expect(parsed?.upstream).toBeUndefined();
    expect(isPayloadShapeRejection(parsed!)).toBe(false);
  });

  it('returns null for plain non-JSON error text (legacy SDK formatting)', () => {
    expect(parseStructuredUpstreamError('something went wrong')).toBeNull();
    expect(
      parseStructuredUpstreamError('API Error: 500 Internal Server'),
    ).toBeNull();
  });

  it('returns null when JSON envelope is malformed', () => {
    expect(parseStructuredUpstreamError('API Error: 400 {not json')).toBeNull();
  });

  it('handles trailing text after the JSON envelope', () => {
    // The SDK occasionally appends retry hints / banner copy after the
    // envelope; the parser must walk back from the last `}` until it
    // finds a valid prefix.
    const text =
      'API Error: 400 {"type":"error","error":{"type":"api_error","message":"x","upstream":{"a":1}}} (will retry in 2s)';
    const parsed = parseStructuredUpstreamError(text);
    expect(parsed?.message).toBe('x');
    expect(parsed?.upstream).toEqual({ a: 1 });
  });

  it('extracts non-400 statuses too (529, 503, etc.)', () => {
    // Non-400 with upstream populated — still parses but isPayloadShapeRejection
    // is false, since only 400s are deterministic payload rejections.
    const text =
      'API Error: 529 {"type":"error","error":{"type":"overloaded","message":"too busy","upstream":{"x":1}}}';
    const parsed = parseStructuredUpstreamError(text);
    expect(parsed?.status).toBe(529);
    expect(isPayloadShapeRejection(parsed!)).toBe(false);
  });

  it('marker substring still matched separately for legacy proxy fallback', () => {
    // The old "Invalid request sent to model provider" string lands as
    // a plain message field — not as upstream-wrapped JSON. Caller must
    // continue to substring-match the marker as a fallback path.
    const text =
      'API Error: 400 {"type":"error","error":{"type":"api_error","message":"Invalid request sent to model provider"}}';
    const parsed = parseStructuredUpstreamError(text);
    expect(parsed?.message).toContain(GATEWAY_INVALID_REQUEST_MARKER);
    // Without `upstream` populated the parser correctly says "not a
    // payload-shape rejection" — the legacy substring match in the caller
    // is what catches this case. Tested in agent-interface integration.
    expect(isPayloadShapeRejection(parsed!)).toBe(false);
  });
});
