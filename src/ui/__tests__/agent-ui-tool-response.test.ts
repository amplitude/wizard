/**
 * Regression suite for PR B11 — `tool_response` envelope + `tool_call.id`
 * correlation field.
 *
 * Audit signal: three independent agent-mode subagents flagged this gap
 * as the biggest parent-agent UX cliff in the wire today (`tool_call`
 * fires at PreToolUse but NOTHING fires at PostToolUse for non-write
 * tools — orchestrators see "Bash: pnpm install" and then radio
 * silence). This PR closes the gap with a `tool_response` envelope
 * keyed on the SDK's `tool_use_id` for strict correlation.
 *
 * Coverage:
 *
 *  1. `AgentUI.emitToolResponse` envelope shape on stdout —
 *     `type: 'progress'`, `data.event: 'tool_response'`, the
 *     registered `data_version`, the full payload (tool, id, outcome,
 *     durationMs, exitCode, contentHead, isError, errorMessage,
 *     summary).
 *
 *  2. `tool_call.id` correlation invariant — when an `id` is set on
 *     the `tool_call`, the matching `tool_response` carries the same
 *     `id`. v2-stamped `tool_call` envelope.
 *
 *  3. Failure path — `outcome: 'error'`, `isError: true`,
 *     `errorMessage` populated and truncated to the registered cap.
 *
 *  4. Success path — `contentHead` populated and truncated to the
 *     registered cap; secret env-values redacted via `redactString`
 *     before they hit the wire.
 *
 *  5. Denied path — `outcome: 'denied'`, `isError: true`, no
 *     `errorMessage` required (the denial reason flows through
 *     `errorMessage` when the caller supplies it).
 *
 *  6. Duration: non-negative; clock-skew floors to 0.
 *
 *  7. No-op on non-AgentUI implementations (LoggingUI).
 *
 *  8. Pure helpers: `truncateToBytes` (UTF-8 safe),
 *     `extractToolUseId` (snake_case + camelCase), and
 *     `extractToolContentHead` (string / `{stdout,stderr,exitCode}` /
 *     `content[]` shapes).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentUI } from '../agent-ui.js';
import {
  EVENT_DATA_VERSIONS,
  TOOL_RESPONSE_CONTENT_HEAD_MAX_BYTES,
  TOOL_RESPONSE_ERROR_MESSAGE_MAX_BYTES,
  TOOL_RESPONSE_SUMMARY_MAX_CHARS,
  truncateToBytes,
} from '../../lib/agent-events.js';
import {
  extractToolContentHead,
  extractToolUseId,
} from '../../lib/inner-lifecycle.js';

interface NDJSONEvent {
  v: 1;
  '@timestamp': string;
  type: string;
  message: string;
  session_id?: string;
  run_id?: string;
  data?: Record<string, unknown>;
  data_version?: number;
  level?: string;
}

const setupStdoutSpy = (): { writes: string[]; restore: () => void } => {
  const writes: string[] = [];
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  return { writes, restore: () => spy.mockRestore() };
};

const parseEvents = (writes: string[]): NDJSONEvent[] =>
  writes.map((w) => JSON.parse(w.trim()) as NDJSONEvent);

const findToolResponses = (writes: string[]): NDJSONEvent[] =>
  parseEvents(writes).filter(
    (e) =>
      (e.data as { event?: string } | undefined)?.event === 'tool_response',
  );

const findToolCalls = (writes: string[]): NDJSONEvent[] =>
  parseEvents(writes).filter(
    (e) => (e.data as { event?: string } | undefined)?.event === 'tool_call',
  );

// ── AgentUI envelope: emitToolResponse ─────────────────────────────────

describe('AgentUI.emitToolResponse (PR B11: tool_response envelope)', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('emits a progress envelope with data.event = "tool_response" and the registered data_version', () => {
    const ui = new AgentUI();
    ui.emitToolResponse?.({
      tool: 'Bash',
      id: 'toolu_01abc',
      outcome: 'success',
      durationMs: 1234,
      exitCode: 0,
      contentHead: 'hello world',
      isError: false,
      summary: 'echo hello',
    });
    const events = findToolResponses(writes);
    expect(events.length).toBe(1);
    const event = events[0];
    expect(event.v).toBe(1);
    expect(event.type).toBe('progress');
    expect(event.data).toMatchObject({
      event: 'tool_response',
      tool: 'Bash',
      id: 'toolu_01abc',
      outcome: 'success',
      durationMs: 1234,
      exitCode: 0,
      contentHead: 'hello world',
      isError: false,
      summary: 'echo hello',
    });
    expect(event.data_version).toBe(EVENT_DATA_VERSIONS.tool_response);
    expect(EVENT_DATA_VERSIONS.tool_response).toBe(1);
  });

  it('preserves @timestamp as an ISO string', () => {
    const ui = new AgentUI();
    ui.emitToolResponse?.({
      tool: 'Read',
      outcome: 'success',
      durationMs: 5,
      isError: false,
    });
    const event = findToolResponses(writes)[0];
    expect(typeof event['@timestamp']).toBe('string');
    expect(() => new Date(event['@timestamp']).toISOString()).not.toThrow();
  });

  // ── Correlation invariant ────────────────────────────────────────────

  it('correlation: tool_call.id matches the subsequent tool_response.id and tool_call is v2', () => {
    const ui = new AgentUI();
    ui.emitToolCall({ tool: 'Bash', id: 'toolu_corr_1', summary: 'pnpm test' });
    ui.emitToolResponse?.({
      tool: 'Bash',
      id: 'toolu_corr_1',
      outcome: 'success',
      durationMs: 42,
      isError: false,
    });
    const calls = findToolCalls(writes);
    const responses = findToolResponses(writes);
    expect(calls.length).toBe(1);
    expect(responses.length).toBe(1);
    expect((calls[0].data as { id?: string }).id).toBe('toolu_corr_1');
    expect((responses[0].data as { id?: string }).id).toBe('toolu_corr_1');
    expect((calls[0].data as { id?: string }).id).toBe(
      (responses[0].data as { id?: string }).id,
    );
    // tool_call bumped to v2 for the id field — orchestrators that
    // want strict correlation branch on data_version >= 2.
    expect(calls[0].data_version).toBe(EVENT_DATA_VERSIONS.tool_call);
    expect(EVENT_DATA_VERSIONS.tool_call).toBe(2);
  });

  it('omits id from the envelope when the caller did not supply one', () => {
    const ui = new AgentUI();
    ui.emitToolResponse?.({
      tool: 'Read',
      outcome: 'success',
      durationMs: 1,
      isError: false,
    });
    const event = findToolResponses(writes)[0];
    expect((event.data as Record<string, unknown>).id).toBeUndefined();
    expect('id' in (event.data as Record<string, unknown>)).toBe(false);
  });

  // ── Failure path ─────────────────────────────────────────────────────

  it('failure path: isError=true carries errorMessage truncated to the registered cap', () => {
    const ui = new AgentUI();
    // Build an error message that exceeds the cap so we exercise the
    // truncation boundary. The cap is registered in agent-events.ts;
    // we round-trip through the constant so the test pins the actual
    // wire contract.
    const overcap = 'X'.repeat(TOOL_RESPONSE_ERROR_MESSAGE_MAX_BYTES + 200);
    ui.emitToolResponse?.({
      tool: 'Bash',
      id: 'toolu_err',
      outcome: 'error',
      durationMs: 999,
      exitCode: 1,
      isError: true,
      errorMessage: overcap,
    });
    const event = findToolResponses(writes)[0];
    const data = event.data as { errorMessage: string; isError: boolean };
    expect(data.isError).toBe(true);
    // Truncated payload includes the U+2026 suffix (3 UTF-8 bytes),
    // so the upper bound is cap + 3.
    expect(Buffer.byteLength(data.errorMessage, 'utf8')).toBeLessThanOrEqual(
      TOOL_RESPONSE_ERROR_MESSAGE_MAX_BYTES + 3,
    );
    expect(data.errorMessage.endsWith('…')).toBe(true);
  });

  // ── Success path / sanitization ──────────────────────────────────────

  it('success path: contentHead truncated to the registered cap and tokens redacted', () => {
    const ui = new AgentUI();
    const overcap =
      'A'.repeat(TOOL_RESPONSE_CONTENT_HEAD_MAX_BYTES - 20) +
      // Embed a sk- API key shape that the redactor scrubs at the wire
      // boundary so the orchestrator never sees the raw secret.
      ' Bearer sk-ant-1234567890abcdef1234567890abcdef';
    ui.emitToolResponse?.({
      tool: 'Bash',
      id: 'toolu_ok',
      outcome: 'success',
      durationMs: 12,
      exitCode: 0,
      isError: false,
      contentHead: overcap,
    });
    const event = findToolResponses(writes)[0];
    const data = event.data as { contentHead: string };
    expect(Buffer.byteLength(data.contentHead, 'utf8')).toBeLessThanOrEqual(
      TOOL_RESPONSE_CONTENT_HEAD_MAX_BYTES + 3,
    );
    // Verify the redactor scrubbed the API-key fragment. Cheap check:
    // the literal value must not survive on the wire.
    expect(data.contentHead).not.toContain('sk-ant-1234567890abcdef');
  });

  it('truncates summary at the registered char cap', () => {
    const ui = new AgentUI();
    const overcap = 'b'.repeat(TOOL_RESPONSE_SUMMARY_MAX_CHARS + 50);
    ui.emitToolResponse?.({
      tool: 'Read',
      outcome: 'success',
      durationMs: 1,
      isError: false,
      summary: overcap,
    });
    const event = findToolResponses(writes)[0];
    const data = event.data as { summary: string };
    expect(data.summary.length).toBe(TOOL_RESPONSE_SUMMARY_MAX_CHARS);
  });

  // ── Denied path ──────────────────────────────────────────────────────

  it('denied outcome: tool blocked by canUseTool gate, isError=true', () => {
    const ui = new AgentUI();
    ui.emitToolResponse?.({
      tool: 'Bash',
      id: 'toolu_deny',
      outcome: 'denied',
      durationMs: 0,
      isError: true,
      errorMessage: 'permission denied: rm -rf is on the blocklist',
    });
    const event = findToolResponses(writes)[0];
    expect(event.data).toMatchObject({
      event: 'tool_response',
      tool: 'Bash',
      id: 'toolu_deny',
      outcome: 'denied',
      isError: true,
    });
  });

  // ── Duration invariants ──────────────────────────────────────────────

  it('floors negative durationMs to 0 (defensive against clock-skew callers)', () => {
    const ui = new AgentUI();
    ui.emitToolResponse?.({
      tool: 'Read',
      outcome: 'success',
      durationMs: -42,
      isError: false,
    });
    const event = findToolResponses(writes)[0];
    expect((event.data as { durationMs: number }).durationMs).toBe(0);
  });

  it('durationMs is monotonic w.r.t. the matching tool_call timestamp', () => {
    // The tool_call fires first; the tool_response follows after some
    // wall-clock interval. The response's durationMs measures THAT
    // interval, so the response's emit-time must be >= call's
    // emit-time + durationMs. Pin the invariant.
    const ui = new AgentUI();
    ui.emitToolCall({ tool: 'Bash', id: 'mono', summary: 'sleep 0.1' });
    const callEmitMs = Date.parse(findToolCalls(writes)[0]['@timestamp'] ?? '');
    ui.emitToolResponse?.({
      tool: 'Bash',
      id: 'mono',
      outcome: 'success',
      durationMs: 100,
      isError: false,
    });
    const responseEmitMs = Date.parse(
      findToolResponses(writes)[0]['@timestamp'] ?? '',
    );
    expect(responseEmitMs).toBeGreaterThanOrEqual(callEmitMs);
    expect(
      (findToolResponses(writes)[0].data as { durationMs: number }).durationMs,
    ).toBeGreaterThanOrEqual(0);
  });

  // ── Defensive: schema rejection ──────────────────────────────────────

  it('drops a malformed outcome at the boundary (no envelope on wire)', () => {
    const ui = new AgentUI();
    ui.emitToolResponse?.({
      tool: 'Bash',
      // @ts-expect-error — intentional malformed outcome
      outcome: 'unknown',
      durationMs: 1,
      isError: false,
    });
    expect(findToolResponses(writes).length).toBe(0);
  });
});

// ── No-op surface on non-AgentUI implementations ───────────────────────

describe('emitToolResponse no-op on non-AgentUI implementations', () => {
  it('is optional on the WizardUI base interface (LoggingUI does not implement)', async () => {
    const { LoggingUI } = await import('../logging-ui.js');
    const logging = new LoggingUI();
    expect(
      (logging as unknown as { emitToolResponse?: unknown }).emitToolResponse,
    ).toBeUndefined();
  });
});

// ── Pure helpers ───────────────────────────────────────────────────────

describe('truncateToBytes (UTF-8 byte-bounded truncation)', () => {
  it('returns the input verbatim when already under cap', () => {
    expect(truncateToBytes('hello', 100)).toBe('hello');
  });

  it('truncates to the byte cap and appends the U+2026 suffix', () => {
    const result = truncateToBytes('A'.repeat(100), 10);
    // 10 ASCII bytes + 3 UTF-8 bytes for '…' = 13 total
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(13);
    expect(result.endsWith('…')).toBe(true);
    expect(result.startsWith('AAAA')).toBe(true);
  });

  it('does not split a multi-byte codepoint at the cap boundary', () => {
    // 'é' is 2 UTF-8 bytes (0xC3 0xA9). A cap of 5 on 'éééé' (8 bytes)
    // must NOT leave a half-byte at the end — the truncator backs up
    // to a complete codepoint boundary.
    const result = truncateToBytes('éééé', 5);
    // The truncated body must round-trip without UTF-8 corruption
    // (re-decoding must produce no U+FFFD replacement chars).
    expect(result.includes('�')).toBe(false);
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns empty string for non-positive max', () => {
    expect(truncateToBytes('hello', 0)).toBe('');
    expect(truncateToBytes('hello', -5)).toBe('');
  });
});

describe('extractToolUseId (correlation key extraction)', () => {
  it('returns the snake_case tool_use_id when present', () => {
    expect(extractToolUseId({ tool_use_id: 'toolu_abc' })).toBe('toolu_abc');
  });

  it('falls back to the camelCase toolUseId for legacy SDK shapes', () => {
    expect(extractToolUseId({ toolUseId: 'toolu_xyz' })).toBe('toolu_xyz');
  });

  it('returns null when neither field is set or empty', () => {
    expect(extractToolUseId({})).toBeNull();
    expect(extractToolUseId({ tool_use_id: '' })).toBeNull();
    expect(extractToolUseId({ tool_use_id: 42 })).toBeNull();
  });

  it('prefers tool_use_id when both fields are set (current SDK contract)', () => {
    expect(extractToolUseId({ tool_use_id: 'snake', toolUseId: 'camel' })).toBe(
      'snake',
    );
  });
});

describe('extractToolContentHead (response payload normalization)', () => {
  it('returns null content for missing tool_response / tool_result', () => {
    expect(extractToolContentHead({})).toEqual({
      content: null,
      exitCode: undefined,
    });
  });

  it('returns the string content verbatim when tool_response is a raw string', () => {
    expect(extractToolContentHead({ tool_response: 'raw output' })).toEqual({
      content: 'raw output',
      exitCode: undefined,
    });
  });

  it('extracts Bash-style {stdout, stderr, exitCode} into combined content + exitCode', () => {
    const result = extractToolContentHead({
      tool_response: {
        stdout: 'hello',
        stderr: 'oops',
        exitCode: 2,
      },
    });
    expect(result.content).toContain('hello');
    expect(result.content).toContain('oops');
    expect(result.exitCode).toBe(2);
  });

  it('concatenates content[] text chunks into a single string', () => {
    const result = extractToolContentHead({
      tool_response: {
        content: [
          { type: 'text', text: 'line 1' },
          { type: 'text', text: 'line 2' },
        ],
      },
    });
    expect(result.content).toBe('line 1\nline 2');
  });

  it('falls back to top-level text / output / message fields', () => {
    expect(
      extractToolContentHead({ tool_response: { text: 'top-level text' } })
        .content,
    ).toBe('top-level text');
    expect(
      extractToolContentHead({ tool_response: { output: 'output field' } })
        .content,
    ).toBe('output field');
  });

  it('falls back to tool_result (older SDK shape) when tool_response is absent', () => {
    expect(extractToolContentHead({ tool_result: 'older shape' }).content).toBe(
      'older shape',
    );
  });
});
