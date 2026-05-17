/**
 * save-diagnostic-artifact — locks down the shared mkdir + write + fallback
 * pipeline behind ConsoleView's `/debug` and `/diagnostics` slash commands.
 *
 * Both commands previously inlined the same `mkdir → writeFileSync → catch`
 * sequence. The helper absorbs disk-write failures and returns the lines the
 * caller hands straight to `setCommandFeedback`. These tests pin:
 *
 *   - Successful writes produce `[...summary, '', 'Saved to: <path>']`.
 *   - Failed writes (read-only fs, permissions) produce the fallback footer
 *     instead — the TUI must not crash on disk errors.
 *   - The written file lands at `<runDir>/<fileName>` with the expected
 *     payload bytes.
 */

import { describe, expect, test, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { saveDiagnosticArtifact } from '../save-diagnostic-artifact.js';
import {
  CACHE_ROOT_OVERRIDE_ENV,
  getRunDir,
} from '../../../../utils/storage-paths.js';

describe('saveDiagnosticArtifact', () => {
  let tmpRoot: string;
  let originalCache: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-sda-'));
    originalCache = process.env[CACHE_ROOT_OVERRIDE_ENV];
    process.env[CACHE_ROOT_OVERRIDE_ENV] = tmpRoot;
  });

  afterEach(() => {
    if (originalCache === undefined) {
      delete process.env[CACHE_ROOT_OVERRIDE_ENV];
    } else {
      process.env[CACHE_ROOT_OVERRIDE_ENV] = originalCache;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('writes payload to <runDir>/<fileName> and reports the absolute path', async () => {
    const installDir = '/Users/dev/project';
    const { feedbackLines } = await saveDiagnosticArtifact({
      installDir,
      fileName: 'debug-snapshot.json',
      payload: '{"hello":"world"}',
      summaryLines: ['Debug snapshot:', '  flow: setup'],
      fallbackMessage: '(could not save)',
    });

    const expectedPath = path.join(
      getRunDir(installDir),
      'debug-snapshot.json',
    );
    expect(feedbackLines).toEqual([
      'Debug snapshot:',
      '  flow: setup',
      '',
      `Saved to: ${expectedPath}`,
    ]);
    expect(fs.readFileSync(expectedPath, 'utf8')).toBe('{"hello":"world"}');
  });

  test('returns the fallback message when the write throws (read-only fs)', async () => {
    // Point the cache root at a file (not a directory) so `mkdirSync`
    // throws — the cheapest way to simulate a write failure without
    // mucking with file permissions on macOS.
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.writeFileSync(tmpRoot, 'not a dir');

    const { feedbackLines } = await saveDiagnosticArtifact({
      installDir: '/Users/dev/project',
      fileName: 'diagnostics.txt',
      payload: 'doesntmatter',
      summaryLines: ['line 1', 'line 2'],
      fallbackMessage: '(could not write diagnostics file)',
    });

    // No `Saved to:` footer when the write fails — fallback footer
    // instead. Summary lines remain so the user still sees the inline
    // content they asked for.
    expect(feedbackLines).toEqual([
      'line 1',
      'line 2',
      '',
      '(could not write diagnostics file)',
    ]);
  });
});
