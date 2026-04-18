/**
 * Bet 5 Slice 5 — sanitized bug report.
 *
 * Covers the pure builder. Write-to-disk is a trivial fs.writeFileSync
 * call wrapped in a try/catch that returns null on failure; verified
 * in integration.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../observability', () => ({
  getRunId: () => 'run-xyz',
  getAttemptId: () => 'att-001',
  getSessionId: () => 'sess-abc',
  getLogFilePath: () => '/tmp/amplitude-wizard.log',
}));

vi.mock('../observability/redact', () => ({
  // Passthrough mock — real redactor covered by its own tests. We're
  // testing structure here, not redaction semantics.
  redactString: (s: string) => s,
}));

vi.mock('../../utils/debug', () => ({
  logToFile: vi.fn(),
}));

import { buildBugReportBody, bugReportPath } from '../bug-report';

describe('buildBugReportBody', () => {
  it('includes required correlation IDs and env metadata', () => {
    const body = buildBugReportBody({
      errorMessage: 'agent stalled',
      integration: 'nextjs',
    });
    expect(body).toContain('Run ID: run-xyz');
    expect(body).toContain('Attempt ID: att-001');
    expect(body).toContain('Session ID: sess-abc');
    expect(body).toContain('Integration: nextjs');
    expect(body).toContain('Log file: /tmp/amplitude-wizard.log');
    expect(body).toMatch(/Node version: v\d+\.\d+/);
  });

  it('surfaces a placeholder when no error message is supplied', () => {
    const body = buildBugReportBody({ integration: 'django' });
    expect(body).toContain('(no error message provided)');
  });

  it('includes the "what I was doing" prompt for the user', () => {
    const body = buildBugReportBody();
    expect(body).toContain('## What I was doing');
    expect(body).toContain('(please describe the steps');
  });

  it('defaults integration to "unknown" when absent', () => {
    const body = buildBugReportBody();
    expect(body).toContain('Integration: unknown');
  });
});

describe('bugReportPath', () => {
  it('returns a tmpdir path ending in amplitude-bug-report.txt', () => {
    expect(bugReportPath()).toMatch(/amplitude-bug-report\.txt$/);
  });
});
