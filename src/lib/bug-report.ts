/**
 * Sanitized bug report for the error-outro recovery launchpad.
 *
 * Writes a short, shareable support report to `/tmp/amplitude-bug-report.txt`.
 * Passes every string through the observability redactor so API keys,
 * tokens, and user-typed secrets are stripped before the user pastes the
 * report into a support channel.
 *
 * Intentionally small — the diagnostic dump (`crash-dump.ts`) carries the
 * full state. This is the quick-copy companion users actually paste.
 */

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getRunId,
  getSessionId,
  getLogFilePath,
} from './observability/index.js';
import { redactString } from './observability/redact.js';
import { WIZARD_VERSION } from './constants.js';
import { logToFile } from '../utils/debug.js';

export interface BugReportInputs {
  /** Terminal-visible error message from the outro, if any. */
  errorMessage?: string | null;
  /** Framework that was being set up. */
  integration?: string | null;
}

/** Path the bug report is written to on success. */
export function bugReportPath(): string {
  return join(tmpdir(), 'amplitude-bug-report.txt');
}

/** Build the sanitized report body. Pure — no I/O. Exported for tests. */
export function buildBugReportBody(inputs: BugReportInputs = {}): string {
  const lines: string[] = [
    '# Amplitude Wizard — Support Report',
    '',
    `Captured: ${new Date().toISOString()}`,
    `Wizard version: ${WIZARD_VERSION}`,
    `Node version: ${process.version}`,
    `Platform: ${process.platform} / ${process.arch}`,
    `Run ID: ${getRunId()}`,
    `Session ID: ${getSessionId()}`,
    `Integration: ${inputs.integration ?? 'unknown'}`,
    `Log file: ${getLogFilePath()}`,
    '',
    '## Error',
    '',
    inputs.errorMessage
      ? redactString(inputs.errorMessage)
      : '(no error message provided)',
    '',
    '## What I was doing',
    '',
    '(please describe the steps you took before this error)',
    '',
    '## Additional context',
    '',
    '(attach the log file above if support asks for it)',
    '',
  ];
  return redactString(lines.join('\n'));
}

/**
 * Write the sanitized bug report to a temp file.
 * Non-throwing — returns null on failure so the caller can surface a
 * friendly message instead of crashing the outro.
 */
export function writeBugReport(inputs: BugReportInputs = {}): string | null {
  const path = bugReportPath();
  try {
    writeFileSync(path, buildBugReportBody(inputs), { mode: 0o600 });
    logToFile(`bug-report: wrote ${path}`);
    return path;
  } catch (err) {
    logToFile(
      `bug-report: write failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}
