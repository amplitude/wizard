/**
 * PR 1.3 — createTracingHeaders shape + W3C traceparent format.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initCorrelation, nextAttemptId } from '../observability/correlation';
import { createTracingHeaders } from '../../utils/custom-headers';
import { resolveMode } from '../mode-config';

describe('createTracingHeaders', () => {
  beforeEach(() => {
    initCorrelation('test-session');
    resolveMode({ isTTY: true });
  });

  it('emits all required X-Wizard-* headers', () => {
    const headers = createTracingHeaders();
    expect(headers['X-Wizard-Run-Id']).toBeTruthy();
    expect(headers['X-Wizard-Attempt-Id']).toBeTruthy();
    expect(headers['X-Wizard-Session-Id']).toBe('test-session');
    expect(headers['X-Wizard-Version']).toMatch(/^\d+\.\d+\.\d+/);
    expect(headers['X-Wizard-Mode']).toBe('interactive');
  });

  it('emits a W3C-compliant traceparent', () => {
    const headers = createTracingHeaders();
    const tp = headers['traceparent'];
    expect(tp).toBeDefined();
    // Format: 00-<32 hex>-<16 hex>-01
    expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('only includes X-Wizard-Integration when the caller passes one', () => {
    const without = createTracingHeaders();
    expect(without['X-Wizard-Integration']).toBeUndefined();

    const withIntegration = createTracingHeaders({ integration: 'nextjs' });
    expect(withIntegration['X-Wizard-Integration']).toBe('nextjs');
  });

  it('keeps trace-id constant across attempt rotations', () => {
    const before = createTracingHeaders();
    nextAttemptId();
    const after = createTracingHeaders();

    const traceIdBefore = before['traceparent'].split('-')[1];
    const traceIdAfter = after['traceparent'].split('-')[1];
    expect(traceIdAfter).toBe(traceIdBefore);

    const parentIdBefore = before['traceparent'].split('-')[2];
    const parentIdAfter = after['traceparent'].split('-')[2];
    expect(parentIdAfter).not.toBe(parentIdBefore);

    expect(after['X-Wizard-Run-Id']).toBe(before['X-Wizard-Run-Id']);
    expect(after['X-Wizard-Attempt-Id']).not.toBe(
      before['X-Wizard-Attempt-Id'],
    );
  });

  it('reflects the resolved execution mode', () => {
    resolveMode({ agent: true, isTTY: false });
    const headers = createTracingHeaders();
    expect(headers['X-Wizard-Mode']).toBe('agent');

    resolveMode({ ci: true, isTTY: false });
    const ciHeaders = createTracingHeaders();
    expect(ciHeaders['X-Wizard-Mode']).toBe('ci');
  });
});
