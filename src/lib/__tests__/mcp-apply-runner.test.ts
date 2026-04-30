/**
 * Unit tests for the in-process MCP apply runner.
 *
 * Drives the runner against a mock wizard binary (a small Node script
 * we write to a tmp file and execute with `process.execPath`) so we
 * exercise the full child_process spawn + stdout-line-parsing pipeline
 * without a real wizard run.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runApplyInProcess, runResetInProcess } from '../mcp-apply-runner.js';

/**
 * Build a tiny Node script that emits NDJSON lines to stdout in
 * canonical wizard shape, then exits with the given code. Returns the
 * absolute path to the script. Caller is responsible for cleanup.
 */
function makeMockBin(
  tmpDir: string,
  emits: string[],
  exitCode: number,
): string {
  const lines = emits
    .map((line) => `process.stdout.write(${JSON.stringify(line)} + '\\n');`)
    .join('\n');
  const script = `${lines}\nprocess.exit(${exitCode});`;
  const file = path.join(tmpDir, 'mock-wizard.js');
  fs.writeFileSync(file, script);
  return file;
}

describe('runApplyInProcess', () => {
  let tmp: string;
  // Silence the runner's stderr forwarding so the test output stays clean.
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-apply-runner-'));
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    stderrSpy.mockRestore();
  });

  it('returns ok:false when wizardBin is empty', async () => {
    const result = await runApplyInProcess(
      {
        planId: 'p',
        eventDecision: 'approved',
      },
      '',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('binary path');
    }
  });

  it('extracts setup_complete from a successful NDJSON stream', async () => {
    const mockBin = makeMockBin(
      tmp,
      [
        JSON.stringify({
          v: 1,
          type: 'lifecycle',
          message: 'apply_started',
          data: {
            event: 'setup_context',
            phase: 'apply_started',
            amplitude: { appId: '12345', orgName: 'Acme' },
          },
        }),
        JSON.stringify({
          v: 1,
          type: 'result',
          message: 'setup_complete: app TodoMVC',
          data: {
            event: 'setup_complete',
            amplitude: {
              appId: '12345',
              appName: 'TodoMVC',
              dashboardUrl: 'https://app.amplitude.com/.../d/abc',
            },
            files: { written: ['src/index.js'], modified: [] },
          },
        }),
        JSON.stringify({
          v: 1,
          type: 'lifecycle',
          message: 'run_completed',
          data: { event: 'run_completed', outcome: 'success', exitCode: 0 },
        }),
      ],
      0,
    );
    const result = await runApplyInProcess(
      { planId: 'p', eventDecision: 'approved' },
      mockBin,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exitCode).toBe(0);
      expect(result.setupComplete).toMatchObject({
        event: 'setup_complete',
        amplitude: { appId: '12345' },
      });
      expect(result.amplitude).toMatchObject({ appId: '12345' });
      expect(result.eventCount).toBe(3);
    }
  });

  it('captures the last error event on a non-zero exit', async () => {
    const mockBin = makeMockBin(
      tmp,
      [
        JSON.stringify({
          v: 1,
          type: 'error',
          message: 'apply failed: plan not found',
          data: { event: 'apply_failed', reason: 'not_found' },
        }),
      ],
      4,
    );
    const result = await runApplyInProcess(
      { planId: 'p', eventDecision: 'approved' },
      mockBin,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exitCode).toBe(4);
      expect(result.lastError).toBeDefined();
      expect(result.lastError?.message).toContain('plan not found');
      expect(result.setupComplete).toBeNull();
    }
  });

  it('forwards every NDJSON line to stderr (live progress for the orchestrator)', async () => {
    const mockBin = makeMockBin(
      tmp,
      [
        JSON.stringify({ v: 1, type: 'log', message: 'step 1' }),
        JSON.stringify({ v: 1, type: 'log', message: 'step 2' }),
        JSON.stringify({ v: 1, type: 'log', message: 'step 3' }),
      ],
      0,
    );
    await runApplyInProcess(
      { planId: 'p', eventDecision: 'approved' },
      mockBin,
    );
    // Each NDJSON line should have been written to stderr with the
    // `[wizard apply]` prefix. Three lines → at least three calls.
    expect(stderrSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    const allStderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(allStderr).toContain('step 1');
    expect(allStderr).toContain('step 3');
  });

  it('handles a non-newline-terminated final line gracefully', async () => {
    // Mimic a child that flushes the last line without trailing \n.
    const file = path.join(tmp, 'mock-no-trailing.js');
    fs.writeFileSync(
      file,
      `process.stdout.write(${JSON.stringify(
        JSON.stringify({
          v: 1,
          type: 'result',
          data: {
            event: 'setup_complete',
            amplitude: { appId: '999' },
          },
        }),
      )});\nprocess.exit(0);\n`,
    );
    const result = await runApplyInProcess(
      { planId: 'p', eventDecision: 'approved' },
      file,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // We don't strictly require setupComplete to be parsed for the
      // un-terminated final line (the runner only parses on \n) — but
      // the eventCount should still reflect the drained buffer.
      expect(result.eventCount).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('runResetInProcess', () => {
  let tmp: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-reset-runner-'));
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    stderrSpy.mockRestore();
  });

  it('returns ok:false when wizardBin is empty', async () => {
    const result = await runResetInProcess('/tmp', '');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('binary path');
    }
  });

  it('parses the reset event payload from JSON stdout', async () => {
    const mockBin = makeMockBin(
      tmp,
      [
        JSON.stringify({
          v: 1,
          type: 'result',
          message: 'wizard reset: removed 2, skipped 2',
          data: {
            event: 'reset',
            removed: ['/p/.amplitude', '/p/.amplitude-events.json'],
            skipped: [
              '/p/.amplitude-dashboard.json',
              '/p/amplitude-setup-report.md',
            ],
          },
        }),
      ],
      0,
    );
    const result = await runResetInProcess('/tmp', mockBin);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exitCode).toBe(0);
      expect(result.removed).toHaveLength(2);
      expect(result.skipped).toHaveLength(2);
    }
  });
});
