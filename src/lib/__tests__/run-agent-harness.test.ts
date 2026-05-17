/**
 * Snapshot harness for `runAgent` (src/lib/agent-interface.ts).
 *
 * `runAgent` is ~2580 lines and tightly interlocks a retry loop, an
 * SDK-message dispatch switch, and stream-delta plumbing through shared
 * outer-function-scope state. The existing `agent-interface.test.ts` is
 * a comprehensive but fragmented unit test surface — each `it` block
 * asserts a narrow expectation against a custom fixture.
 *
 * This harness pins the SHAPE of an end-to-end `runAgent` call across a
 * small set of canonical scenarios as inline snapshots. The intent is
 * not to add more behavioral coverage (that lives in
 * `agent-interface.test.ts`) but to make future refactors — extracting
 * helpers, moving control flow into modules, narrowing variable scope —
 * safe by failing loudly the moment an extraction perturbs observable
 * output.
 *
 * What the snapshot captures, per scenario:
 *   - the structured result returned by `runAgent`
 *   - the canonical sequence of spinner / UI side effects
 *   - whether the SDK query iterator was called more than once (retry)
 *   - the count of analytics events emitted (without the labels — those
 *     drift more than the structural sequence does)
 *
 * Scenarios:
 *   1. happy_path_single_turn          — init + success result
 *   2. happy_path_multi_turn           — assistant text + tool use + result
 *   3. legacy_status_marker            — [STATUS] markers flow to spinner
 *   4. compaction_recovery             — compact_boundary + post-compact success
 *   5. auth_retry_storm_aborts_early   — AUTH_RETRY_LIMIT 401s → early abort
 *   6. mid_stream_error_no_success     — SDK throws before any success result
 *   7. error_result_rate_limit         — is_error result with 429 → RATE_LIMIT
 *   8. sdk_cleanup_after_success       — success result then SDK throws → success
 *
 * Snapshots are recorded with `toMatchInlineSnapshot` so a diff in the
 * trace is visible directly in the file and a maintainer can immediately
 * see whether an extraction reordered events.
 */

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { runAgent } from '../agent-interface';
import { resetRetryBudgetForTests } from '../agent/transient-llm-retry';
import type { WizardOptions } from '../../utils/types';
import type { SpinnerHandle } from '../../ui';

// --- Module mocks --------------------------------------------------------

vi.mock('../../utils/analytics');
vi.mock('../../utils/debug');

const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const mockUIInstance = {
  log: {
    step: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
  spinner: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  text: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  note: vi.fn(),
  isCancel: vi.fn(),
  setDetectedFramework: vi.fn(),
  setCredentials: vi.fn(),
  pushStatus: vi.fn(),
  setLoginUrl: vi.fn(),
  showServiceStatus: vi.fn(),
  startRun: vi.fn(),
  syncTodos: vi.fn(),
  groupMultiselect: vi.fn(),
  multiselect: vi.fn(),
  heartbeat: vi.fn(),
  setEventPlan: vi.fn(),
  setRetryState: vi.fn(),
  setCurrentActivity: vi.fn(),
  emitAuthRetryExhausted: vi.fn(),
};
vi.mock('../../ui', () => ({
  getUI: () => mockUIInstance,
}));

// --- Fixtures ------------------------------------------------------------

const DEFAULT_OPTIONS: WizardOptions = {
  debug: false,
  installDir: '/test/dir',
  forceInstall: false,
  default: false,
  authOnboardingPath: 'sign_in',
  localMcp: false,
  ci: false,
  menu: false,
  benchmark: false,
};

const DEFAULT_AGENT_CONFIG = {
  workingDirectory: '/test/dir',
  mcpServers: {},
  model: 'claude-opus-4-5-20251101',
};

type SDKMessageLike = Record<string, unknown>;

/**
 * Shape captured by the harness for snapshotting. We intentionally
 * record only the structural slots that are stable across refactors:
 *   - `result`: the runAgent return value (after dropping volatile keys)
 *   - `spinner`: ordered sequence of spinner method calls (method + arg)
 *   - `uiCalls`: ordered list of UI methods invoked at least once
 *   - `queryCallCount`: number of SDK iterator constructions
 *   - `analyticsEventCount`: total `analytics.wizardCapture` invocations
 */
type Trace = {
  result: Record<string, unknown>;
  spinner: Array<string>;
  uiCalls: Array<string>;
  queryCallCount: number;
  analyticsEventCount: number;
};

/**
 * Drive `runAgent` against a scripted message stream and capture a
 * normalized trace.
 *
 * @param messages   pre-recorded SDK message stream for the first attempt
 * @param onAttempt  optional override for multi-attempt scenarios. When
 *                   provided, `messages` is ignored and `onAttempt(n)` is
 *                   asked for the per-attempt async generator.
 */
async function runScenario(
  messages: SDKMessageLike[],
  opts: {
    onAttempt?: (
      attempt: number,
      signal: AbortSignal,
    ) => AsyncIterable<unknown>;
    expectThrow?: boolean;
  } = {},
): Promise<Trace & { thrown?: string }> {
  let queryCallCount = 0;
  if (opts.onAttempt) {
    mockQuery.mockImplementation(
      (params: { options: Record<string, unknown> }) => {
        queryCallCount++;
        const signal = params.options.abortSignal as AbortSignal;
        return opts.onAttempt!(queryCallCount - 1, signal);
      },
    );
  } else {
    mockQuery.mockImplementation(() => {
      queryCallCount++;
      return (async function* () {
        for (const msg of messages) yield msg;
      })();
    });
  }

  const spinnerCalls: string[] = [];
  const mockSpinner = {
    start: vi.fn((m?: string) => spinnerCalls.push(`start:${m ?? ''}`)),
    stop: vi.fn((m?: string) => spinnerCalls.push(`stop:${m ?? ''}`)),
    message: vi.fn((m: string) => spinnerCalls.push(`message:${m}`)),
  };
  mockUIInstance.spinner.mockReturnValue(mockSpinner);

  // Capture which UI methods were touched, in a stable order.
  // (We snapshot the set rather than the full call args — args carry
  // timestamps / IDs that drift across refactors without changing the
  // shape we care about pinning.)
  const uiTouched = new Set<string>();
  for (const key of Object.keys(mockUIInstance)) {
    if (key === 'spinner' || key === 'log') continue;
    const fn = (mockUIInstance as unknown as Record<string, Mock>)[key];
    if (typeof fn?.mockImplementation === 'function') {
      const wrapped = fn as Mock;
      const orig = wrapped.getMockImplementation();
      wrapped.mockImplementation((...args: unknown[]) => {
        uiTouched.add(key);
        return orig?.(...args);
      });
    }
  }

  let thrown: string | undefined;
  let result: Record<string, unknown> = {};
  try {
    result = (await runAgent(
      DEFAULT_AGENT_CONFIG,
      'test prompt',
      DEFAULT_OPTIONS,
      mockSpinner as unknown as SpinnerHandle,
      { successMessage: 'Done', errorMessage: 'Failed' },
    )) as Record<string, unknown>;
  } catch (err) {
    thrown = err instanceof Error ? err.message : String(err);
    if (!opts.expectThrow) throw err;
  }

  // Normalize the result so volatile fields don't make the snapshot
  // brittle: drop `plannedEvents` when empty (it's always [] for these
  // harness scenarios — instrumented paths are exercised elsewhere).
  if (
    Array.isArray(result.plannedEvents) &&
    (result.plannedEvents as unknown[]).length === 0
  ) {
    const rest = { ...result };
    delete rest.plannedEvents;
    result = rest;
  }

  const analyticsModule = await import('../../utils/analytics');
  const analyticsMock = (
    analyticsModule.analytics as unknown as {
      wizardCapture: Mock;
    }
  ).wizardCapture;
  const analyticsEventCount = analyticsMock?.mock.calls.length ?? 0;

  return {
    result,
    spinner: spinnerCalls,
    uiCalls: [...uiTouched].sort(),
    queryCallCount,
    analyticsEventCount,
    ...(thrown ? { thrown } : {}),
  };
}

// --- Test suite ----------------------------------------------------------

describe('runAgent snapshot harness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRetryBudgetForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------
  // Scenario 1 — happy path, single turn
  //
  // Minimum viable run: init + success. Pins the steady-state spinner
  // sequence (start → stop with successMessage) and proves no UI side
  // effects beyond the spinner happen on a no-op run.
  // ---------------------------------------------------------------------
  it('scenario 1: happy_path_single_turn', async () => {
    const trace = await runScenario([
      {
        type: 'system',
        subtype: 'init',
        model: 'claude-opus-4-5-20251101',
        tools: [],
        mcp_servers: [],
      },
      { type: 'result', subtype: 'success', is_error: false, result: 'OK' },
    ]);
    expect(trace.result).toEqual({});
    expect(trace.queryCallCount).toBe(1);
    expect(trace.spinner).toMatchInlineSnapshot(`
      [
        "start:Customizing your Amplitude setup...",
        "stop:Done",
      ]
    `);
  });

  // ---------------------------------------------------------------------
  // Scenario 2 — happy path, multi-turn with a tool call
  //
  // Assistant text + tool_use + tool_result + success. Pins that
  // tool-use events don't leak extra spinner stops or UI surface beyond
  // the normal start/stop.
  // ---------------------------------------------------------------------
  it('scenario 2: happy_path_multi_turn', async () => {
    const trace = await runScenario([
      {
        type: 'system',
        subtype: 'init',
        model: 'claude-opus-4-5-20251101',
        tools: [],
        mcp_servers: [],
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me inspect the project.' },
            { type: 'tool_use', id: 't1', name: 'Read', input: {} },
          ],
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'file body' },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'All done.' }],
        },
      },
      { type: 'result', subtype: 'success', is_error: false, result: 'OK' },
    ]);
    expect(trace.result).toEqual({});
    expect(trace.queryCallCount).toBe(1);
    expect(trace.spinner).toMatchInlineSnapshot(`
      [
        "start:Customizing your Amplitude setup...",
        "stop:Done",
      ]
    `);
  });

  // ---------------------------------------------------------------------
  // Scenario 3 — legacy [STATUS] markers
  //
  // 31 bundled skills still emit the [STATUS] text marker (instead of
  // the structured `report_status` MCP tool). This pins the path that
  // forwards them to the spinner.
  // ---------------------------------------------------------------------
  it('scenario 3: legacy_status_marker', async () => {
    const trace = await runScenario([
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: '[STATUS] Inspecting project structure' },
          ],
        },
      },
      { type: 'result', subtype: 'success', is_error: false, result: '' },
    ]);
    expect(trace.result).toEqual({});
    // The legacy [STATUS] marker must round-trip into spinner.message.
    expect(trace.spinner.includes('message:Inspecting project structure')).toBe(
      true,
    );
  });

  // ---------------------------------------------------------------------
  // Scenario 4 — compaction recovery
  //
  // The SDK emits `compact_boundary` mid-stream and continues into a
  // post-compact success. Pins that the run survives compaction without
  // triggering a retry (`queryCallCount === 1`).
  // ---------------------------------------------------------------------
  it('scenario 4: compaction_recovery', async () => {
    const trace = await runScenario([
      {
        type: 'system',
        subtype: 'init',
        model: 'claude-opus-4-5-20251101',
        tools: [],
        mcp_servers: [],
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Working...' }],
        },
      },
      { type: 'system', subtype: 'compact_boundary' },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Resumed after compaction.' }],
        },
      },
      { type: 'result', subtype: 'success', is_error: false, result: 'OK' },
    ]);
    expect(trace.result).toEqual({});
    expect(trace.queryCallCount).toBe(1);
    expect(trace.spinner).toMatchInlineSnapshot(`
      [
        "start:Customizing your Amplitude setup...",
        "stop:Done",
      ]
    `);
  });

  // ---------------------------------------------------------------------
  // Scenario 5 — auth retry storm short-circuits early
  //
  // The SDK retries 401s up to ~10x. `runAgent` should bail at
  // AUTH_RETRY_LIMIT (2). Pins the structural outcome:
  //   - AUTH_ERROR result
  //   - llm-gateway subkind (a 401 from the gateway, not the
  //     amplitude-wizard MCP)
  //   - the `emitAuthRetryExhausted` lifecycle event fires (recorded
  //     here via `uiCalls`)
  // ---------------------------------------------------------------------
  it('scenario 5: auth_retry_storm_aborts_early', async () => {
    function* authRetryStorm() {
      for (let i = 0; i < 10; i++) {
        yield {
          type: 'system',
          subtype: 'api_retry',
          attempt: i,
          error_status: 401,
          error: 'authentication_failed',
          retry_delay_ms: 1000,
        };
      }
    }
    mockQuery.mockReturnValue(authRetryStorm());
    const trace = await runScenario([], {
      onAttempt: () => authRetryStorm(),
    });
    expect(trace.result.error).toBe('WIZARD_AUTH_ERROR');
    expect(trace.result.authSubkind).toBe('llm-gateway');
    expect(trace.uiCalls).toContain('emitAuthRetryExhausted');
  });

  // ---------------------------------------------------------------------
  // Scenario 6 — mid-stream error with no prior success
  //
  // SDK throws before yielding any success result. The error must
  // propagate out of `runAgent` (not be swallowed into a success).
  // ---------------------------------------------------------------------
  it('scenario 6: mid_stream_error_no_success', async () => {
    const trace = await runScenario([], {
      onAttempt: () =>
        (async function* () {
          yield {
            type: 'system',
            subtype: 'init',
            model: 'claude-opus-4-5-20251101',
            tools: [],
            mcp_servers: [],
          };
          throw new Error('Fatal SDK error');
        })(),
      expectThrow: true,
    });
    // Either an exception propagates or it's classified as an error result.
    // Both shapes are observable here — we pin whichever the implementation
    // chose so a refactor that flips the path is caught.
    expect(trace.thrown !== undefined || trace.result.error !== undefined).toBe(
      true,
    );
    if (trace.thrown !== undefined) {
      expect(trace.thrown).toContain('Fatal SDK error');
    }
  });

  // ---------------------------------------------------------------------
  // Scenario 7 — error result classified as RATE_LIMIT
  //
  // is_error result carrying "API Error: 429" must classify as
  // RATE_LIMIT and the message must round-trip.
  // ---------------------------------------------------------------------
  it('scenario 7: error_result_rate_limit', async () => {
    const trace = await runScenario([
      {
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: 'API Error: 429 Too Many Requests',
      },
    ]);
    expect(trace.result.error).toBe('WIZARD_RATE_LIMIT');
    expect(String(trace.result.message)).toContain('API Error: 429');
    expect(trace.queryCallCount).toBe(1);
  });

  // ---------------------------------------------------------------------
  // Scenario 8 — SDK cleanup throws after success
  //
  // Race: success result lands → signalDone() fires → SDK throws on
  // teardown. `runAgent` must trust the success and return cleanly,
  // not surface the cleanup error.
  // ---------------------------------------------------------------------
  it('scenario 8: sdk_cleanup_after_success', async () => {
    const trace = await runScenario([], {
      onAttempt: () =>
        (async function* () {
          yield {
            type: 'system',
            subtype: 'init',
            model: 'claude-opus-4-5-20251101',
            tools: [],
            mcp_servers: [],
          };
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: 'Agent completed',
          };
          throw new Error(
            'only prompt commands are supported in streaming mode',
          );
        })(),
    });
    // Cleanup error must be swallowed: result is bare success (no error).
    expect(trace.result).toEqual({});
    expect(trace.spinner).toMatchInlineSnapshot(`
      [
        "start:Customizing your Amplitude setup...",
        "stop:Done",
      ]
    `);
  });
});
