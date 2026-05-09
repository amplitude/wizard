import { describe, it, expect, beforeEach } from 'vitest';

import {
  findTransientSdkOutputPattern,
  extractApiErrorHttpStatusFromPattern,
  extractUpstreamModelFields,
  formatUnsupportedModelMessage,
  GATEWAY_INVALID_REQUEST_MARKER,
  isPayloadShapeRejection,
  isThrownErrorCountedAsUpstreamGatewayFailure,
  isTransientThrownSdkErrorMessage,
  parseStructuredUpstreamError,
  computeRetryBackoffMs,
  RETRY_BACKOFF_BASE_MS,
  RETRY_BACKOFF_CAP_MS,
  RETRY_BUDGET_PER_SESSION,
  getRetryBudget,
  resetRetryBudgetForTests,
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

  it('isThrownErrorCountedAsUpstreamGatewayFailure includes 400 / 408 / DEADLINE_EXCEEDED', () => {
    // The "gateway storm" detection drives the GATEWAY_DOWN exit-code
    // path with the actionable "set ANTHROPIC_API_KEY" copy. 408 was
    // missing from this set, so timeout-only storms exited as generic
    // API_ERROR and missed the remediation.
    expect(isThrownErrorCountedAsUpstreamGatewayFailure('API Error: 400')).toBe(
      true,
    );
    expect(isThrownErrorCountedAsUpstreamGatewayFailure('API Error: 408')).toBe(
      true,
    );
    expect(
      isThrownErrorCountedAsUpstreamGatewayFailure('DEADLINE_EXCEEDED'),
    ).toBe(true);
    // 5xx must NOT count as a "gateway down" signal — that's a Vertex
    // backend issue the proxy is already retrying. Conflating the two
    // would misattribute Vertex outages to the gateway.
    expect(isThrownErrorCountedAsUpstreamGatewayFailure('API Error: 502')).toBe(
      false,
    );
    expect(isThrownErrorCountedAsUpstreamGatewayFailure('API Error: 503')).toBe(
      false,
    );
    expect(isThrownErrorCountedAsUpstreamGatewayFailure('API Error: 504')).toBe(
      false,
    );
  });

  it('isTransientThrownSdkErrorMessage covers tool, stream, and 5xx cases', () => {
    expect(isTransientThrownSdkErrorMessage('tool_use without result')).toBe(
      true,
    );
    expect(isTransientThrownSdkErrorMessage('Stream closed')).toBe(true);
    // 502 / 504 were missing — without them, an SDK that exhausted its
    // internal retries on a Vertex frontend-hop failure would exit as
    // generic API_ERROR with no outer-loop retry. Pin all five 5xx
    // statuses we care about.
    expect(isTransientThrownSdkErrorMessage('API Error: 502 Bad Gateway')).toBe(
      true,
    );
    expect(isTransientThrownSdkErrorMessage('API Error: 503')).toBe(true);
    expect(
      isTransientThrownSdkErrorMessage('API Error: 504 Gateway Timeout'),
    ).toBe(true);
    expect(isTransientThrownSdkErrorMessage('API Error: 529')).toBe(true);
    expect(isTransientThrownSdkErrorMessage('unrelated')).toBe(false);
  });

  it('findTransientSdkOutputPattern matches each 5xx status by exact label', () => {
    // The label is what `upstreamGatewayFailures` keys on for storm
    // attribution and what telemetry tags by `pattern_label`. Pin them
    // so a refactor that renames a label silently breaks dashboards.
    expect(findTransientSdkOutputPattern('API Error: 502')?.label).toBe(
      'api_502',
    );
    expect(findTransientSdkOutputPattern('API Error: 504')?.label).toBe(
      'api_504',
    );
    expect(findTransientSdkOutputPattern('API Error: 408')?.label).toBe(
      'api_408',
    );
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

  it('populates receivedModel + supportedModels from the upstream envelope', () => {
    // The proxy now passes the model's actual rejection reason through:
    // `error.upstream.received_model` + `error.upstream.supported_models`.
    // When present, the parser surfaces them as flat string / string[]
    // fields so the caller renders an actionable
    // `"Model 'X' is not supported. Try one of: …"` line.
    const text =
      'API Error: 400 {"type":"error","error":{"type":"api_error","message":"Model not supported","upstream":{"received_model":"claude-opus-fictional","supported_models":["claude-sonnet-4-5","claude-opus-4-5"]}}}';
    const parsed = parseStructuredUpstreamError(text);
    expect(parsed?.receivedModel).toBe('claude-opus-fictional');
    expect(parsed?.supportedModels).toEqual([
      'claude-sonnet-4-5',
      'claude-opus-4-5',
    ]);
  });

  it('omits receivedModel / supportedModels when absent', () => {
    // Schema rejections (additionalProperties etc.) carry upstream but
    // not the model fields — parser must not invent values.
    const text =
      'API Error: 400 {"type":"error","error":{"type":"api_error","message":"x","upstream":{"error":{"code":400}}}}';
    const parsed = parseStructuredUpstreamError(text);
    expect(parsed?.upstream).toBeDefined();
    expect(parsed?.receivedModel).toBeUndefined();
    expect(parsed?.supportedModels).toBeUndefined();
  });
});

describe('extractUpstreamModelFields', () => {
  it('returns empty object for non-object inputs', () => {
    expect(extractUpstreamModelFields(null)).toEqual({});
    expect(extractUpstreamModelFields(undefined)).toEqual({});
    expect(extractUpstreamModelFields('hello')).toEqual({});
    expect(extractUpstreamModelFields(42)).toEqual({});
  });

  it('drops empty / non-string entries from supported_models', () => {
    // Defensive against a sloppy proxy build emitting nulls or stray
    // objects in the array — we filter to non-empty strings.
    const out = extractUpstreamModelFields({
      received_model: 'm',
      supported_models: ['a', '', null, 42, 'b'],
    });
    expect(out.receivedModel).toBe('m');
    expect(out.supportedModels).toEqual(['a', 'b']);
  });

  it('omits supportedModels entirely when no valid entries remain', () => {
    const out = extractUpstreamModelFields({
      received_model: 'm',
      supported_models: ['', null],
    });
    expect(out.supportedModels).toBeUndefined();
  });
});

describe('formatUnsupportedModelMessage', () => {
  it('renders the canonical line when both fields are present', () => {
    expect(
      formatUnsupportedModelMessage({
        receivedModel: 'claude-opus-fictional',
        supportedModels: ['claude-sonnet-4-5', 'claude-opus-4-5'],
      }),
    ).toBe(
      "Model 'claude-opus-fictional' is not supported. Try one of: claude-sonnet-4-5, claude-opus-4-5",
    );
  });

  it('returns null when either field is missing', () => {
    // Missing the list — fall back to the verbatim Vertex message.
    expect(
      formatUnsupportedModelMessage({
        receivedModel: 'm',
        supportedModels: [],
      }),
    ).toBeNull();
    expect(
      formatUnsupportedModelMessage({ supportedModels: ['a'] }),
    ).toBeNull();
    expect(formatUnsupportedModelMessage({})).toBeNull();
  });
});

describe('per-chunk stream timeout matchers', () => {
  // Per-chunk deadline errors come back from `wizard-proxy/streaming.ts`
  // and were previously NOT in either matcher set, so a chunk-deadline
  // storm exited as generic API_ERROR with no outer-loop retry. Pin both
  // the post-stream pattern and the thrown-error matcher so a future
  // refactor can't silently regress.
  it('classifies chunk_deadline_exceeded as a transient SDK output pattern', () => {
    const m = findTransientSdkOutputPattern(
      'foo\nchunk_deadline_exceeded after 30s',
    );
    expect(m?.label).toBe('chunk_deadline_exceeded');
  });

  it('classifies the human-readable "stream chunk timeout" alias too', () => {
    const m = findTransientSdkOutputPattern(
      'foo\nstream chunk timeout (no SSE for 45s)',
    );
    expect(m?.label).toBe('chunk_deadline_exceeded');
  });

  it('flags chunk timeout in the thrown-error branch as transient', () => {
    expect(
      isTransientThrownSdkErrorMessage('chunk_deadline_exceeded after 30s'),
    ).toBe(true);
    expect(
      isTransientThrownSdkErrorMessage('stream chunk timeout (no SSE for 45s)'),
    ).toBe(true);
  });
});

describe('computeRetryBackoffMs', () => {
  it.each([
    // [attempt, random, expected — no retry-after]
    // attempt 1 → exp 0 → 2000 + jitter*2000
    [1, 0, RETRY_BACKOFF_BASE_MS],
    [1, 0.5, RETRY_BACKOFF_BASE_MS + RETRY_BACKOFF_BASE_MS * 0.5],
    [1, 1, RETRY_BACKOFF_BASE_MS * 2],
    // attempt 2 → exp 1 → 4000 + jitter*2000
    [2, 0, 4000],
    [2, 0.25, 4000 + 500],
    // attempt 5 → exp 4 → 32000 + jitter, but cap 30000
    [5, 0, RETRY_BACKOFF_CAP_MS],
    [5, 1, RETRY_BACKOFF_CAP_MS],
  ])(
    'attempt=%d random=%f → exact additive-jitter value',
    (attempt, random, expected) => {
      expect(computeRetryBackoffMs(attempt, null, () => random)).toBe(expected);
    },
  );

  it('honors retry-after as a floor when larger than computed backoff', () => {
    // attempt=1 with random=0 → 2000ms, but retry-after says 7000ms → 7000ms.
    expect(computeRetryBackoffMs(1, 7_000, () => 0)).toBe(7_000);
  });

  it('ignores retry-after when smaller than computed backoff', () => {
    // attempt=2 with random=0 → 4000ms; retry-after 100ms is below floor.
    expect(computeRetryBackoffMs(2, 100, () => 0)).toBe(4_000);
  });

  it('clamps retry-after to the cap to defend against runaway server hints', () => {
    // attempt=1, retry-after says 10 minutes; we still cap at 30s so the
    // run isn't hung indefinitely on a bad gateway header.
    expect(computeRetryBackoffMs(1, 10 * 60 * 1000, () => 0)).toBe(
      RETRY_BACKOFF_CAP_MS,
    );
  });

  it('treats null / non-finite retry-after as absent', () => {
    expect(computeRetryBackoffMs(1, null, () => 0)).toBe(RETRY_BACKOFF_BASE_MS);
    expect(computeRetryBackoffMs(1, NaN, () => 0)).toBe(RETRY_BACKOFF_BASE_MS);
    // Negative is ignored — Retry-After cannot mean "go back in time".
    expect(computeRetryBackoffMs(1, -500, () => 0)).toBe(RETRY_BACKOFF_BASE_MS);
  });

  it('clamps random output to [0, 1] so a misbehaving rng cannot blow the math up', () => {
    // 1.5 should clip to 1; -0.5 should clip to 0.
    expect(computeRetryBackoffMs(1, null, () => 1.5)).toBe(
      RETRY_BACKOFF_BASE_MS * 2,
    );
    expect(computeRetryBackoffMs(1, null, () => -0.5)).toBe(
      RETRY_BACKOFF_BASE_MS,
    );
  });

  it('jitter spreads consecutive retries across a non-trivial window (anti-thundering-herd smoke)', () => {
    // Eight calls at the same attempt with Math.random must not all
    // return the same value. The window is `[base*2^exp, base*2^exp + base]`
    // so we expect at least 2 distinct values across 8 samples.
    const samples = new Set<number>();
    for (let i = 0; i < 8; i++) samples.add(computeRetryBackoffMs(2));
    expect(samples.size).toBeGreaterThan(1);
  });
});

describe('getRetryBudget (process-scoped)', () => {
  beforeEach(() => {
    resetRetryBudgetForTests();
  });

  it('starts at the configured limit', () => {
    expect(getRetryBudget().limit).toBe(RETRY_BUDGET_PER_SESSION);
    expect(getRetryBudget().remaining()).toBe(RETRY_BUDGET_PER_SESSION);
  });

  it('tryConsume succeeds up to the limit and then fails', () => {
    const budget = getRetryBudget();
    for (let i = 0; i < RETRY_BUDGET_PER_SESSION; i++) {
      expect(budget.tryConsume()).toBe(true);
    }
    expect(budget.tryConsume()).toBe(false);
    expect(budget.remaining()).toBe(0);
  });

  it('budget is shared across calls to getRetryBudget (singleton)', () => {
    const a = getRetryBudget();
    const b = getRetryBudget();
    expect(a.tryConsume()).toBe(true);
    expect(b.remaining()).toBe(RETRY_BUDGET_PER_SESSION - 1);
  });

  it('resetRetryBudgetForTests restores a fresh singleton', () => {
    const before = getRetryBudget();
    before.tryConsume();
    before.tryConsume();
    expect(before.remaining()).toBe(RETRY_BUDGET_PER_SESSION - 2);
    resetRetryBudgetForTests();
    expect(getRetryBudget().remaining()).toBe(RETRY_BUDGET_PER_SESSION);
  });
});
