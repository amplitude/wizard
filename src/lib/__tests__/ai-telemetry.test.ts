import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AIConfig } from '@amplitude/ai';
import { MockAmplitudeAI } from '@amplitude/ai/testing';
import { ClaudeAgentSDKTracker } from '@amplitude/ai/integrations/claude-agent-sdk';

import {
  _setAmplitudeAIForTesting,
  isAiTelemetryEnabled,
  mergeTrackerHooks,
  startAiTelemetryAttempt,
  WIZARD_AGENT_ID,
} from '../ai-telemetry';

const ENV_KILL_SWITCH = 'AMPLITUDE_WIZARD_AI_TELEMETRY';

describe('ai-telemetry', () => {
  let mock: MockAmplitudeAI;

  beforeEach(() => {
    mock = new MockAmplitudeAI(new AIConfig({ contentMode: 'metadata_only' }));
    _setAmplitudeAIForTesting(
      mock as unknown as Parameters<typeof _setAmplitudeAIForTesting>[0],
      ClaudeAgentSDKTracker as unknown as Parameters<
        typeof _setAmplitudeAIForTesting
      >[1],
    );
    delete process.env[ENV_KILL_SWITCH];
  });

  afterEach(() => {
    _setAmplitudeAIForTesting(null);
    delete process.env[ENV_KILL_SWITCH];
  });

  describe('isAiTelemetryEnabled', () => {
    it('defaults on when no kill switch and no feature flag override', () => {
      expect(isAiTelemetryEnabled()).toBe(true);
    });

    it('returns false when AMPLITUDE_WIZARD_AI_TELEMETRY=0', () => {
      process.env[ENV_KILL_SWITCH] = '0';
      expect(isAiTelemetryEnabled()).toBe(false);
    });

    it('returns false when AMPLITUDE_WIZARD_AI_TELEMETRY=false', () => {
      process.env[ENV_KILL_SWITCH] = 'false';
      expect(isAiTelemetryEnabled()).toBe(false);
    });
  });

  describe('startAiTelemetryAttempt', () => {
    it('returns null when kill switch is set', async () => {
      process.env[ENV_KILL_SWITCH] = '0';
      _setAmplitudeAIForTesting(null);
      expect(await startAiTelemetryAttempt()).toBeNull();
    });

    it('emits [Agent] Tool Call via the SDK tracker hooks', async () => {
      const attempt = await startAiTelemetryAttempt();
      expect(attempt).not.toBeNull();
      if (!attempt) return;

      const hooks = attempt.tracker.hooks(attempt.session);
      const preHook = hooks.PreToolUse[0].hooks[0];
      const postHook = hooks.PostToolUse[0].hooks[0];

      await preHook({ tool_name: 'Bash' }, 'tool-use-1', {});
      await postHook(
        {
          tool_name: 'Bash',
          tool_input: { command: 'ls' },
          tool_response: 'ok',
        },
        'tool-use-1',
        {},
      );

      const toolEvents = mock.getEvents('[Agent] Tool Call');
      expect(toolEvents).toHaveLength(1);
      const props = toolEvents[0].event_properties ?? {};
      expect(props['[Agent] Tool Name']).toBe('Bash');
      expect(props['[Agent] Tool Success']).toBe(true);
      expect(props['[Agent] Agent ID']).toBe(WIZARD_AGENT_ID);
    });

    it('processes assistant messages into [Agent] AI Response', async () => {
      const attempt = await startAiTelemetryAttempt();
      expect(attempt).not.toBeNull();
      if (!attempt) return;

      attempt.tracker.process(attempt.session, {
        type: 'assistant',
        role: 'assistant',
        content: [{ type: 'text', text: 'hello world' }],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 12, output_tokens: 4 },
      });

      const aiEvents = mock.getEvents('[Agent] AI Response');
      expect(aiEvents).toHaveLength(1);
      const props = aiEvents[0].event_properties ?? {};
      expect(props['[Agent] Model Name']).toBe('claude-sonnet-4-6');
      expect(props['[Agent] Provider']).toBe('anthropic');
      expect(props['[Agent] Input Tokens']).toBe(12);
      expect(props['[Agent] Output Tokens']).toBe(4);
    });

    it('endSession is idempotent', async () => {
      const attempt = await startAiTelemetryAttempt();
      expect(attempt).not.toBeNull();
      if (!attempt) return;

      attempt.endSession();
      attempt.endSession();

      const endEvents = mock.getEvents('[Agent] Session End');
      expect(endEvents).toHaveLength(1);
    });
  });

  describe('mergeTrackerHooks', () => {
    const noop: (
      i: Record<string, unknown>,
      t: string | null,
      c: Record<string, unknown>,
    ) => Promise<Record<string, unknown>> = async () => ({});

    it('concatenates matcher arrays per event', () => {
      const base = {
        PreToolUse: [{ matcher: null, hooks: [noop] }],
        SessionStart: [{ matcher: null, hooks: [noop] }],
      };
      const tracker = {
        PreToolUse: [{ matcher: null, hooks: [noop] }],
        PostToolUse: [{ matcher: null, hooks: [noop] }],
      };
      const merged = mergeTrackerHooks(base, tracker);
      expect(merged.PreToolUse).toHaveLength(2);
      expect(merged.PostToolUse).toHaveLength(1);
      expect(merged.SessionStart).toHaveLength(1);
    });
  });
});
