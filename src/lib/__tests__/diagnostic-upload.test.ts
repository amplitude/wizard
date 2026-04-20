/**
 * PR 3.1 — diagnostic uploader behavior:
 *   - DO_NOT_TRACK blocks upload
 *   - 404/501 falls back to a local file write
 *   - success returns the server-issued URL
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';

const axiosMock = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('axios', () => ({
  default: axiosMock,
}));

vi.mock('../api', () => ({
  getWizardProxyBase: (_zone: string) => 'https://proxy.example.com/wizard',
}));

vi.mock('../../utils/custom-headers', () => ({
  createTracingHeaders: () => ({ traceparent: 'fake' }),
}));

vi.mock('../../utils/debug', () => ({
  logToFile: vi.fn(),
}));

import { uploadBundle } from '../diagnostic-upload';
import type { DiagnosticBundle } from '../diagnostic-bundle';

function makeBundle(): DiagnosticBundle {
  return {
    bytes: Buffer.from('fake-gzip-bytes'),
    meta: {
      runId: 'run-abc',
      attemptId: 'att-1',
      sessionId: 'sess-x',
      wizardVersion: '1.2.0',
      sizeCompressedBytes: 15,
      truncated: false,
    },
  };
}

describe('uploadBundle', () => {
  beforeEach(() => {
    axiosMock.post.mockReset();
    delete process.env.DO_NOT_TRACK;
    delete process.env.AMPLITUDE_WIZARD_NO_TELEMETRY;
  });

  afterEach(() => {
    // Clean up any local-fallback files from tests.
    try {
      const path = `/tmp/amplitude-wizard-diagnostic-run-abc.gz`;
      if (existsSync(path)) rmSync(path);
    } catch {
      // best-effort cleanup
    }
  });

  it('skips when DO_NOT_TRACK is set', async () => {
    process.env.DO_NOT_TRACK = '1';
    const result = await uploadBundle(makeBundle(), { zone: 'us' });
    expect(result).toEqual({ kind: 'skipped', reason: 'telemetry-disabled' });
    expect(axiosMock.post).not.toHaveBeenCalled();
  });

  it('skips when AMPLITUDE_WIZARD_NO_TELEMETRY is set', async () => {
    process.env.AMPLITUDE_WIZARD_NO_TELEMETRY = '1';
    const result = await uploadBundle(makeBundle(), { zone: 'us' });
    expect(result.kind).toBe('skipped');
  });

  it('returns the uploaded URL on 2xx with a well-formed payload', async () => {
    axiosMock.post.mockResolvedValue({
      status: 201,
      data: { url: 'https://diag.example/r/abc', id: 'abc' },
    });
    const result = await uploadBundle(makeBundle(), { zone: 'us' });
    expect(result).toEqual({
      kind: 'uploaded',
      url: 'https://diag.example/r/abc',
      id: 'abc',
    });
  });

  it('falls back to a local file on 404', async () => {
    axiosMock.post.mockResolvedValue({ status: 404, data: undefined });
    const result = await uploadBundle(makeBundle(), { zone: 'us' });
    expect(result.kind).toBe('local');
    if (result.kind === 'local') {
      expect(result.reason).toBe('backend-missing');
      expect(existsSync(result.path)).toBe(true);
    }
  });

  it('falls back to a local file on 501', async () => {
    axiosMock.post.mockResolvedValue({ status: 501, data: undefined });
    const result = await uploadBundle(makeBundle(), { zone: 'us' });
    expect(result.kind).toBe('local');
    if (result.kind === 'local') {
      expect(result.reason).toBe('backend-missing');
    }
  });

  it('falls back to a local file on network error', async () => {
    axiosMock.post.mockRejectedValue(new Error('ENETUNREACH'));
    const result = await uploadBundle(makeBundle(), { zone: 'us' });
    expect(result.kind).toBe('local');
    if (result.kind === 'local') {
      expect(result.reason).toBe('upload-failed');
    }
  });

  it('sends Authorization header when accessToken is provided', async () => {
    axiosMock.post.mockResolvedValue({
      status: 200,
      data: { url: 'u', id: 'i' },
    });
    await uploadBundle(makeBundle(), { zone: 'us', accessToken: 'tok-123' });
    const [, , opts] = axiosMock.post.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer tok-123');
  });
});
