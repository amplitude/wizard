import { describe, it, expect } from 'vitest';
import { collapseSdkStreamClosedNoise } from '../agent-interface';
import { classifyLogLine } from '../../ui/tui/utils/log-viewer';

/**
 * Coverage for the SDK 0.2.121 `task_notification` → `Stream closed`
 * race-noise collapser. The full bug + remediation lives in `agent-
 * interface.ts` (`SDK_STREAM_CLOSED_RE`, `collapseSdkStreamClosedNoise`,
 * and the `stderr` callback wiring); these tests pin the matching rules
 * and the “does not pollute the LogViewer error counter” invariant.
 *
 * Sample stderr blob shape (real-world, trimmed):
 *
 *   Error in hook callback hook_2: 9207 | ${H.map(...)
 *   9208 | `)}
 *   ...
 *   9212 | ... if(this.inputClosed)throw Error("Stream closed"); ...
 *
 *   error: Stream closed
 *         at sendRequest (/$bunfs/root/src/entrypoints/cli.js:9212:133)
 *         at <anonymous> (/$bunfs/root/src/entrypoints/cli.js:9212:2290)
 *         ...
 */

const SAMPLE_BLOB = `Error in hook callback hook_2: 9207 | ${'$'}{H.map((q)=>...).join(\`\\n\`)}
9208 | \`)}
9209 | Re-create them if still needed.
9210 | </system-reminder>...
9211 | ...some decompiled cli.js source...
9212 | ...if(this.inputClosed)throw Error("Stream closed");...

error: Stream closed
      at sendRequest (/$bunfs/root/src/entrypoints/cli.js:9212:133)
      at <anonymous> (/$bunfs/root/src/entrypoints/cli.js:9212:2290)
      at SY3 (/$bunfs/root/src/entrypoints/cli.js:8797:1258)
      at <anonymous> (/$bunfs/root/src/entrypoints/cli.js:8794:2078)
      at next (1:11)
      at q (/$bunfs/root/src/entrypoints/cli.js:2661:20152)
      at qt_ (/$bunfs/root/src/entrypoints/cli.js:2661:20302)
      at next (1:11)
      at MP (/$bunfs/root/src/entrypoints/cli.js:8794:10582)
      at next (1:11)
`;

const TASK_NOTIFICATION_BLOB = `[2026-05-07T16:43:02.484Z] task_notification fired for tool_use_id=toolu_vrtx_01ABC

Error: Stream closed
      at sendRequest (/$bunfs/root/src/entrypoints/cli.js:9212:133)
      at next (1:11)
`;

describe('collapseSdkStreamClosedNoise', () => {
  it('returns null for unrelated stderr (no race signature)', () => {
    expect(
      collapseSdkStreamClosedNoise('TypeError: foo is not a function\n'),
    ).toBeNull();
    expect(collapseSdkStreamClosedNoise('')).toBeNull();
    expect(
      collapseSdkStreamClosedNoise('WARN: agent took 30s on tool call\n'),
    ).toBeNull();
  });

  it('returns null for a bare "Stream closed" line missing the SDK frame', () => {
    // Conservative match: "Stream closed" alone is NOT the SDK race —
    // some other module (or a future SDK rename) might say the same
    // thing. We require an SDK-side signal too.
    expect(
      collapseSdkStreamClosedNoise('Error: Stream closed at userland.js:42\n'),
    ).toBeNull();
  });

  it('preserves genuine errors that ride alongside SDK noise in the same chunk', () => {
    // Regression: chunk-level collapse used to swallow co-batched
    // genuine error lines. The line-level partition keeps them in
    // `passthrough` so the caller can still log them.
    const blob = `TypeError: cannot read properties of null
error: Stream closed
      at sendRequest (/$bunfs/root/src/entrypoints/cli.js:9212:133)
      at next (1:11)
RangeError: maximum call stack exceeded
`;
    const result = collapseSdkStreamClosedNoise(blob);
    expect(result).not.toBeNull();
    if (!result) return;
    // SDK lines were collapsed.
    expect(result.suppressedLines).toBe(3);
    // Genuine errors survived in passthrough.
    expect(result.passthrough).toContain('TypeError: cannot read properties');
    expect(result.passthrough).toContain('RangeError: maximum call stack');
    // Passthrough must NOT contain any SDK noise lines.
    expect(result.passthrough).not.toContain('Stream closed');
    expect(result.passthrough).not.toContain('cli.js:9212');
  });

  it('passthrough is empty when the chunk is pure SDK noise', () => {
    const result = collapseSdkStreamClosedNoise(SAMPLE_BLOB);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.passthrough).toBe('');
  });

  it('collapses the full SDK race blob to a single line', () => {
    const result = collapseSdkStreamClosedNoise(SAMPLE_BLOB);
    expect(result).not.toBeNull();
    if (!result) return;
    // The collapsed line is one line — no embedded newlines.
    expect(result.collapsedLine.split('\n')).toHaveLength(1);
    expect(result.collapsedLine).toContain('SDK stream-closed race');
    expect(result.collapsedLine).toContain('benign');
    expect(result.suppressedLines).toBeGreaterThan(5);
  });

  it('collapses a task_notification race chunk and tags context', () => {
    const result = collapseSdkStreamClosedNoise(TASK_NOTIFICATION_BLOB);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.context).toBe('task_notification');
    expect(result.collapsedLine).toContain('task_notification');
  });

  it('falls back to context="unknown" when task_notification is absent', () => {
    const result = collapseSdkStreamClosedNoise(SAMPLE_BLOB);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.context).toBe('unknown');
  });

  it('the collapsed line does NOT trigger the LogViewer error classifier', () => {
    // The TUI Logs tab counts entries whose first line classifies as
    // 'error' (regex `\berror\b|\bfail(?:ed)?\b`, case-insensitive,
    // see `src/ui/tui/utils/log-viewer.ts`). The whole point of
    // collapsing is to STOP each SDK race from incrementing that
    // counter by ~10× per occurrence — so the replacement string
    // must not match the regex. If this test fails we'd be back to
    // inflating the counter (just with one line instead of ten).
    const result = collapseSdkStreamClosedNoise(SAMPLE_BLOB);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(classifyLogLine(result.collapsedLine)).not.toBe('error');
  });

  it('singularizes "stack-trace line" when only one line is suppressed', () => {
    // Belt-and-suspenders: a 1-line blob should still match (because
    // the SDK signature is on that single line) and the message must
    // read naturally.
    const single =
      'Error: Stream closed at sendRequest (/$bunfs/root/src/entrypoints/cli.js:9212:133)';
    const result = collapseSdkStreamClosedNoise(single);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.collapsedLine).toContain('stack-trace line;');
    expect(result.collapsedLine).not.toContain('stack-trace lines');
  });
});
