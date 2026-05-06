import { describe, it, expect } from 'vitest';

import {
  findTransientSdkOutputPattern,
  extractApiErrorHttpStatusFromPattern,
  GATEWAY_INVALID_REQUEST_MARKER,
  isThrownErrorCountedAsUpstreamGatewayFailure,
  isTransientThrownSdkErrorMessage,
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
