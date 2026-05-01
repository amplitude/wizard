import { describe, expect, it } from 'vitest';
import {
  formatRedactedNdjson,
  REDACTED,
  redactEvent,
  redactNdjsonStream,
} from './ndjson-redact';

describe('redactEvent', () => {
  it('redacts @timestamp, session_id, and run_id', () => {
    const event = {
      v: 1,
      '@timestamp': '2026-05-01T12:34:56.789Z',
      type: 'lifecycle',
      message: 'Starting',
      session_id: 'a1b2c3d4-1111-4222-8333-abcdef012345',
      run_id: '11111111-2222-4333-8444-555555555555',
    };
    const redacted = redactEvent({ ...event });
    expect(redacted).toMatchObject({
      '@timestamp': REDACTED.timestamp,
      session_id: REDACTED.uuid,
      run_id: REDACTED.uuid,
    });
    // Stable fields are untouched.
    expect(redacted.v).toBe(1);
    expect(redacted.type).toBe('lifecycle');
    expect(redacted.message).toBe('Starting');
  });

  it('redacts duration fields inside data', () => {
    const event = {
      type: 'lifecycle',
      data: {
        event: 'run_completed',
        outcome: 'success',
        durationMs: 4231,
        exitCode: 0,
      },
    };
    const redacted = redactEvent({ ...event, data: { ...event.data } });
    expect(redacted.data).toMatchObject({
      durationMs: REDACTED.duration,
      outcome: 'success',
      exitCode: 0,
    });
  });

  it('redacts install-dir prefixes inside string payloads', () => {
    const installDir = '/tmp/wizard-scenario-XYZ';
    const event = {
      type: 'result',
      data: {
        event: 'file_change_applied',
        path: `${installDir}/src/lib/analytics.ts`,
        operation: 'create',
      },
    };
    const redacted = redactEvent(
      { ...event, data: { ...event.data } },
      {
        installDir,
      },
    );
    expect((redacted.data as { path: string }).path).toBe(
      `${REDACTED.installDir}/src/lib/analytics.ts`,
    );
  });

  it('redacts toolUseId only when redactToolUseIds is set', () => {
    const event = {
      type: 'progress',
      data: {
        event: 'tool_call',
        tool: 'Edit',
        toolUseId: 'toolu_01ABCdefGHIjklMNOpqrSTUv',
      },
    };
    const without = redactEvent(structuredClone(event));
    expect((without.data as { toolUseId: string }).toolUseId).toBe(
      'toolu_01ABCdefGHIjklMNOpqrSTUv',
    );
    const withFlag = redactEvent(structuredClone(event), {
      redactToolUseIds: true,
    });
    expect((withFlag.data as { toolUseId: string }).toolUseId).toBe(
      REDACTED.toolUseId,
    );
  });

  it('redacts UUIDs nested anywhere in data payloads', () => {
    const event = {
      type: 'lifecycle',
      data: {
        event: 'setup_context',
        amplitude: {
          orgId: '12345678-aaaa-4bbb-8ccc-dddddddddddd',
          projectName: 'Acme',
        },
      },
    };
    const redacted = redactEvent(structuredClone(event));
    expect(
      (redacted.data as { amplitude: { orgId: string } }).amplitude.orgId,
    ).toBe(REDACTED.uuid);
    expect(
      (redacted.data as { amplitude: { projectName: string } }).amplitude
        .projectName,
    ).toBe('Acme');
  });

  it('walks arrays inside data', () => {
    const event = {
      type: 'result',
      data: {
        event: 'setup_complete',
        files: {
          written: [
            '/tmp/wizard-scenario-XYZ/file1.ts',
            '/tmp/wizard-scenario-XYZ/file2.ts',
          ],
          modified: [],
        },
      },
    };
    const redacted = redactEvent(structuredClone(event), {
      installDir: '/tmp/wizard-scenario-XYZ',
    });
    expect(
      (redacted.data as { files: { written: string[] } }).files.written,
    ).toEqual([
      `${REDACTED.installDir}/file1.ts`,
      `${REDACTED.installDir}/file2.ts`,
    ]);
  });

  it('is idempotent', () => {
    const event = {
      '@timestamp': '2026-05-01T12:34:56.789Z',
      session_id: 'a1b2c3d4-1111-4222-8333-abcdef012345',
    };
    const once = redactEvent(structuredClone(event));
    const twice = redactEvent(structuredClone(once));
    expect(twice).toEqual(once);
  });
});

describe('redactNdjsonStream', () => {
  it('parses, redacts, and preserves ordering', () => {
    const raw = [
      JSON.stringify({
        '@timestamp': '2026-05-01T00:00:01.000Z',
        type: 'lifecycle',
        message: 'a',
        session_id: '11111111-2222-4333-8444-555555555555',
        run_id: '22222222-3333-4444-8555-666666666666',
      }),
      '',
      JSON.stringify({
        '@timestamp': '2026-05-01T00:00:02.000Z',
        type: 'result',
        message: 'b',
      }),
    ].join('\n');

    const events = redactNdjsonStream(raw);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      '@timestamp': REDACTED.timestamp,
      type: 'lifecycle',
      message: 'a',
      session_id: REDACTED.uuid,
      run_id: REDACTED.uuid,
    });
    expect(events[1]).toMatchObject({
      '@timestamp': REDACTED.timestamp,
      type: 'result',
      message: 'b',
    });
  });

  it('throws on malformed JSON with the offending line number', () => {
    const raw = '{"valid": true}\nnot json\n';
    expect(() => redactNdjsonStream(raw)).toThrow(/line 2/);
  });

  it('throws on a JSON value that is not an object', () => {
    const raw = '{"valid": true}\n["array", "not", "object"]\n';
    expect(() => redactNdjsonStream(raw)).toThrow(/not a JSON object/);
  });
});

describe('formatRedactedNdjson', () => {
  it('round-trips redacted events to NDJSON text', () => {
    const events = [
      { type: 'lifecycle', '@timestamp': REDACTED.timestamp },
      { type: 'result', '@timestamp': REDACTED.timestamp },
    ];
    const text = formatRedactedNdjson(events);
    expect(text.split('\n')).toHaveLength(2);
    expect(JSON.parse(text.split('\n')[0])).toEqual(events[0]);
  });
});
