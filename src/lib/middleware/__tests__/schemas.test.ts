import { describe, expect, it } from 'vitest';
import {
  safeParseSDKMessage,
  sdkAssistantMessageSchema,
  sdkResultMessageSchema,
  sdkSystemMessageSchema,
  sdkUserMessageSchema,
  sdkStreamEventMessageSchema,
  sdkOtherMessageSchema,
} from '../schemas';

describe('sdkMessageSchema (discriminated union)', () => {
  describe('assistant branch', () => {
    it('parses an assistant message with content blocks', () => {
      const result = safeParseSDKMessage({
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [
            { type: 'text', text: 'hello' },
            {
              type: 'tool_use',
              name: 'TodoWrite',
              input: { todos: [{ content: 'a', status: 'pending' }] },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
        parent_tool_use_id: null,
        uuid: 'u',
        session_id: 's',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.message.type).toBe('assistant');
        expect(result.message.message?.content?.[0]).toMatchObject({
          type: 'text',
          text: 'hello',
        });
      }
    });

    it('preserves unknown forward-compat fields via passthrough', () => {
      const parsed = sdkAssistantMessageSchema.safeParse({
        type: 'assistant',
        message: { content: [] },
        // Unknown future field — must not fail
        future_field: { foo: 'bar' },
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect((parsed.data as Record<string, unknown>).future_field).toEqual({
          foo: 'bar',
        });
      }
    });
  });

  describe('user branch', () => {
    it('parses a user message', () => {
      const result = safeParseSDKMessage({
        type: 'user',
        message: { content: [{ type: 'text', text: 'hi' }] },
        parent_tool_use_id: null,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.message.type).toBe('user');
    });

    it('parses a user message via the per-branch schema', () => {
      const parsed = sdkUserMessageSchema.safeParse({
        type: 'user',
        message: {},
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe('system branch', () => {
    it('parses a system init message with mcp_servers', () => {
      const result = safeParseSDKMessage({
        type: 'system',
        subtype: 'init',
        model: 'claude-opus',
        tools: ['Read', 'Write'],
        mcp_servers: [
          { name: 'amplitude', status: 'connected' },
          { name: 'fs', status: 'failed' },
        ],
        cwd: '/tmp',
        uuid: 'u',
        session_id: 's',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.message.type).toBe('system');
        expect(result.message.subtype).toBe('init');
        expect(result.message.mcp_servers).toHaveLength(2);
      }
    });

    it('parses system with non-init subtype (compact_boundary, task_started, etc.)', () => {
      const parsed = sdkSystemMessageSchema.safeParse({
        type: 'system',
        subtype: 'compact_boundary',
        compact_metadata: { trigger: 'auto', pre_tokens: 1234 },
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe('result branch', () => {
    it('parses a successful result message', () => {
      const result = safeParseSDKMessage({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        num_turns: 3,
        total_cost_usd: 0.42,
        usage: { input_tokens: 100, output_tokens: 50 },
        modelUsage: {
          'claude-opus': { inputTokens: 100, outputTokens: 50 },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.message.type).toBe('result');
        expect(result.message.subtype).toBe('success');
        expect(result.message.is_error).toBe(false);
      }
    });

    it('parses an error result message with errors array', () => {
      const result = safeParseSDKMessage({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        result: 'boom',
        errors: ['network failure', 'timeout'],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.message.is_error).toBe(true);
        expect(result.message.errors).toEqual(['network failure', 'timeout']);
      }
    });

    it('parses via the per-branch schema with only required fields', () => {
      const parsed = sdkResultMessageSchema.safeParse({ type: 'result' });
      expect(parsed.success).toBe(true);
    });
  });

  describe('stream_event branch (partial assistant)', () => {
    it('parses a partial assistant streaming event', () => {
      const result = safeParseSDKMessage({
        type: 'stream_event',
        event: { type: 'message_delta' },
        parent_tool_use_id: null,
        uuid: 'u',
        session_id: 's',
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.message.type).toBe('stream_event');
    });

    it('parses via the per-branch schema', () => {
      const parsed = sdkStreamEventMessageSchema.safeParse({
        type: 'stream_event',
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe('forward-compat (unknown type fallback)', () => {
    it('accepts a brand-new SDK message type via the catch-all branch', () => {
      const result = safeParseSDKMessage({
        type: 'rate_limit_event',
        rate_limit_info: { status: 'allowed' },
        uuid: 'u',
        session_id: 's',
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.message.type).toBe('rate_limit_event');
    });

    it('accepts tool_progress and other future-y types', () => {
      const result = safeParseSDKMessage({
        type: 'tool_progress',
        tool_use_id: 't',
        tool_name: 'Bash',
        elapsed_time_seconds: 1.5,
      });
      expect(result.ok).toBe(true);
    });

    it('catch-all schema rejects messages already covered by known branches', () => {
      // The catch-all branch's `.refine` excludes the well-known types so
      // we don't lose discriminated-union narrowing.
      const parsed = sdkOtherMessageSchema.safeParse({ type: 'assistant' });
      expect(parsed.success).toBe(false);
    });
  });

  describe('failure modes', () => {
    it('rejects a non-object value', () => {
      const result = safeParseSDKMessage('not a message');
      expect(result.ok).toBe(false);
    });

    it('rejects a value missing the type field', () => {
      const result = safeParseSDKMessage({ subtype: 'init' });
      expect(result.ok).toBe(false);
    });

    it('rejects a value where type is not a string', () => {
      const result = safeParseSDKMessage({ type: 42 });
      expect(result.ok).toBe(false);
    });

    it('returns a structured error rather than throwing', () => {
      // safeParseSDKMessage must NEVER throw — handleSDKMessage relies on
      // the {ok, error} discriminated result to skip bad messages.
      expect(() => safeParseSDKMessage(undefined)).not.toThrow();
      const result = safeParseSDKMessage(undefined);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeDefined();
      }
    });
  });
});
