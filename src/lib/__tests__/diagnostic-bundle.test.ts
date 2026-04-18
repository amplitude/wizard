/**
 * PR 3.1 — diagnostic bundle structure and size cap.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../observability', () => ({
  getLogFilePath: vi.fn(),
  getRunId: () => 'run-abc',
  getAttemptId: () => 'att-1',
  getSessionId: () => 'sess-x',
  getBreadcrumbs: () => [
    { timestamp: 't1', category: 'auth', message: 'logged in' },
  ],
}));

vi.mock('../observability/redact', () => ({
  redact: (v: unknown) => v,
}));

import { buildBundle } from '../diagnostic-bundle';
import { getLogFilePath } from '../observability';

describe('buildBundle', () => {
  let tmp: string;
  let logPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wizard-bundle-'));
    logPath = join(tmp, 'amplitude-wizard.log');
    vi.mocked(getLogFilePath).mockReturnValue(logPath);

    const ndjson =
      ['a', 'b', 'c']
        .map((k) => JSON.stringify({ namespace: 'test', msg: k }))
        .join('\n') + '\n';
    writeFileSync(logPath + 'l', ndjson);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('gzips a valid JSON payload with meta, breadcrumbs, and log entries', () => {
    const bundle = buildBundle();
    const decompressed = gunzipSync(bundle.bytes).toString('utf8');
    const payload = JSON.parse(decompressed) as Record<string, unknown>;

    expect(payload.schema).toBe('amplitude-wizard-diagnostic/1');
    expect(payload.meta).toMatchObject({
      runId: 'run-abc',
      attemptId: 'att-1',
      sessionId: 'sess-x',
    });
    expect(payload.breadcrumbs).toHaveLength(1);
    expect(payload.logEntries).toHaveLength(2); // first line dropped as possibly truncated
  });

  it('includes the caller-supplied snapshot under "snapshot"', () => {
    const bundle = buildBundle({ snapshot: { foo: 'bar' } });
    const payload = JSON.parse(gunzipSync(bundle.bytes).toString('utf8'));
    expect(payload.snapshot).toEqual({ foo: 'bar' });
  });

  it('reports bundle metadata on the return value', () => {
    const bundle = buildBundle();
    expect(bundle.meta.runId).toBe('run-abc');
    expect(bundle.meta.sizeCompressedBytes).toBe(bundle.bytes.byteLength);
    expect(bundle.meta.truncated).toBe(false);
  });

  it('tolerates a missing log file without throwing', () => {
    rmSync(logPath + 'l');
    const bundle = buildBundle();
    expect(bundle.bytes.byteLength).toBeGreaterThan(0);
  });
});
