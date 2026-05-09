/**
 * Unit coverage for the SSE-frame suppression helpers in
 * `src/lib/agent-events.ts`.
 *
 * Background: when the Anthropic gateway terminates a streaming
 * response with a 4xx (most commonly `400 terminated` mid-stream), the
 * SDK throws an error whose `.message` contains the entire failing SSE
 * response body — hundreds of `event:` / `data:` framing lines plus
 * `partial_json` `tool_use` deltas. Earlier the wizard's `legacy DEBUG
 * Agent result with error: ...` log line was dumping that protocol
 * noise verbatim into the user-visible TUI Logs tab (Sentry
 * #7442894144). `suppressSseFrames` collapses each run of frames into
 * a `[N SSE frames suppressed]` marker; `sanitizeErrorMessageForLog`
 * pipelines that with `truncateLogMessage` so even the marker-stripped
 * form can't blow past the on-disk log budget.
 *
 * These tests lock down the matcher rules end-to-end so a future
 * regression on either the per-line detector OR the truncation cap is
 * surfaced fast.
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_LOG_MESSAGE_LENGTH,
  sanitizeErrorMessageForLog,
  suppressSseFrames,
} from '../agent-events.js';

describe('suppressSseFrames', () => {
  it('returns short, non-SSE messages verbatim', () => {
    expect(suppressSseFrames('hello world')).toBe('hello world');
    expect(suppressSseFrames('TypeError: foo is not a function')).toBe(
      'TypeError: foo is not a function',
    );
    // Empty string is fine — the fast-path early-return covers it.
    expect(suppressSseFrames('')).toBe('');
  });

  it('collapses a contiguous SSE block into a single marker', () => {
    // Production-shaped error message: a `400` HTTP status line at the
    // head, then the entire failing SSE body (alternating `event:` /
    // `data:` lines with blank-line framing) concatenated in.
    const input = [
      'API Error: 400',
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"claude-sonnet-4-6","id":"msg_vrtx_01"}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"nwarner/w"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"rktree-"}}',
    ].join('\n');

    const out = suppressSseFrames(input);
    // The leading non-frame line survives.
    expect(out).toContain('API Error: 400');
    // None of the SSE framing or `partial_json` payload survives.
    expect(out).not.toContain('event: message_start');
    expect(out).not.toContain('event: content_block_delta');
    expect(out).not.toContain('partial_json');
    expect(out).not.toContain('nwarner/w');
    expect(out).not.toContain('claude-sonnet-4-6');
    // A single marker replaces the whole block, with the exact frame count.
    expect(out).toMatch(/\[1[01] SSE frames suppressed\]/);
  });

  it('handles the inline-prefix case (first frame on the same line as the HTTP status)', () => {
    // Real shape from the bug report: the SDK sometimes serializes the
    // first `event: message_start` adjacent to the status line, all on
    // one line, with the rest of the body following on subsequent lines.
    const input =
      'API Error: 400 event: message_start\n' +
      'data: {"type":"message_start","message":{"model":"claude-sonnet-4-6"}}\n' +
      'event: ping\n' +
      'data: {"type":"ping"}';

    const out = suppressSseFrames(input);
    // The status prefix is preserved and the inline frame is counted.
    expect(out).toContain('API Error: 400');
    expect(out).not.toContain('event: message_start');
    expect(out).not.toContain('event: ping');
    expect(out).not.toContain('claude-sonnet-4-6');
    expect(out).toMatch(/\[\d+ SSE frames? suppressed\]/);
  });

  it('preserves a real error riding alongside SSE noise', () => {
    // Same defense as the existing `stripStreamEventNoise` /
    // `partitionHookBridgeRace` pair: a real diagnostic that happens
    // to be batched alongside protocol noise must survive — without
    // this, debugging post-mortems would lose the actual stack trace.
    const input =
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta"}}\n' +
      'TypeError: Cannot read property foo of undefined\n' +
      '    at /Users/ada/wizard/src/foo.ts:42:7';

    const out = suppressSseFrames(input);
    expect(out).toContain('TypeError: Cannot read property foo of undefined');
    expect(out).toContain('/Users/ada/wizard/src/foo.ts:42:7');
    expect(out).not.toContain('content_block_delta');
    expect(out).toMatch(/\[2 SSE frames suppressed\]/);
  });

  it('uses singular "frame" wording when only one frame is suppressed', () => {
    const input = 'API Error: 400\nevent: ping';
    const out = suppressSseFrames(input);
    expect(out).toContain('[1 SSE frame suppressed]');
    // Defensive: the plural form must NOT be emitted for n=1.
    expect(out).not.toContain('[1 SSE frames suppressed]');
  });

  it('matches bare-JSON frames (no `event:` / `data:` SSE wrapper)', () => {
    // The SDK occasionally serializes the body as bare JSON objects
    // separated by newlines — same protocol shape, different framing.
    const input =
      'TypeError: boom\n' +
      '{"type":"message_start","message":{"model":"claude-sonnet-4-6"}}\n' +
      '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"x"}}';

    const out = suppressSseFrames(input);
    expect(out).toContain('TypeError: boom');
    expect(out).not.toContain('"type":"message_start"');
    expect(out).not.toContain('"type":"content_block_delta"');
    expect(out).toMatch(/\[2 SSE frames suppressed\]/);
  });

  it('passes through unknown event types unchanged', () => {
    // Defensive: only the known stream-event subtypes get suppressed.
    // A genuine `tool_result` or other event must NOT be silently
    // dropped — those are real diagnostic content.
    const input = 'event: tool_result\ndata: {"type":"tool_result"}';
    expect(suppressSseFrames(input)).toBe(input);
  });
});

describe('sanitizeErrorMessageForLog', () => {
  it('strips SSE frames AND truncates oversized messages', () => {
    // Build an error message that's BOTH dirty (SSE-laden) AND huge —
    // the realistic worst case that prompted the fix. The pipeline
    // must do both jobs in one shot.
    const sseBody = Array.from({ length: 500 }, (_, i) =>
      [
        'event: content_block_delta',
        `data: {"type":"content_block_delta","index":${i},"delta":{"type":"input_json_delta","partial_json":"${'x'.repeat(
          50,
        )}"}}`,
      ].join('\n'),
    ).join('\n');
    const dirtyMessage = `API Error: 400\n${sseBody}`;

    expect(dirtyMessage.length).toBeGreaterThan(MAX_LOG_MESSAGE_LENGTH);

    const out = sanitizeErrorMessageForLog(dirtyMessage);

    // Truncation cap holds.
    expect(out.length).toBeLessThanOrEqual(MAX_LOG_MESSAGE_LENGTH);
    // SSE suppression ran (no raw frames survive).
    expect(out).not.toContain('event: content_block_delta');
    expect(out).not.toContain('partial_json');
    // The non-frame head is preserved.
    expect(out).toContain('API Error: 400');
  });

  it('returns short, clean messages verbatim', () => {
    expect(sanitizeErrorMessageForLog('rate limited')).toBe('rate limited');
  });

  it('does not append the [truncated] suffix when only SSE suppression was needed', () => {
    // After suppression the message is well under the cap — `truncateLogMessage`
    // should be a no-op in this branch, so the suffix must NOT appear.
    const input = [
      'API Error: 400',
      'event: message_start',
      'data: {"type":"message_start","message":{}}',
      'event: ping',
      'data: {"type":"ping"}',
    ].join('\n');

    const out = sanitizeErrorMessageForLog(input);
    expect(out).not.toContain('[truncated; see verbose log]');
    expect(out).toContain('SSE frames suppressed');
  });
});
