/**
 * Layer 0 single-init-call scorer — regression for the overlap math.
 *
 * `amplitude.init(` matches both INIT_PATTERNS (the namespaced form)
 * AND BARE_INIT_CALL (because the leading `.` is a non-word char, so
 * `\binit(` matches the suffix of `amplitude.init(`). Without the
 * overlap subtraction, a file with one `amplitude.init(` plus a
 * named-init import was counted as two — hard-failing clean integrations.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { scorer } from '../layer0-hard-fail/single-init-call.js';
import type { Artifact, Scenario } from '../../runner/types.js';

function makeArtifact(addedPaths: string[]): Artifact {
  return {
    runId: 'run-test',
    scenario: 'test',
    ring: 1,
    startedAt: '2026-05-06T12:00:00Z',
    finishedAt: '2026-05-06T12:00:01Z',
    exitCode: 0,
    runLog: [],
    stderr: '',
    fsSnapshot: {
      files: {},
      diff: { added: addedPaths, modified: [], deleted: [] },
    },
    source: 'live',
  };
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const dummyScenario = {} as Scenario;

describe('single-init-call scorer overlap math', () => {
  it('counts amplitude.init() with a named-init import as one init', () => {
    const root = mkdtempSync(join(tmpdir(), 'eval-init-test-'));
    process.env.EVALS_WORKING_DIR = root;
    const path = 'src/main.ts';
    writeFile(
      join(root, path),
      `import { init } from '@amplitude/unified';\namplitude.init('key');\n`,
    );
    const r = scorer.evaluate(makeArtifact([path]), dummyScenario);
    expect(r.pass).toBe(true);
  });

  it('still hard-fails on two init calls in the same file', () => {
    const root = mkdtempSync(join(tmpdir(), 'eval-init-test-'));
    process.env.EVALS_WORKING_DIR = root;
    const path = 'src/main.ts';
    writeFile(
      join(root, path),
      `import { init } from '@amplitude/unified';\ninit('key1');\ninit('key2');\n`,
    );
    const r = scorer.evaluate(makeArtifact([path]), dummyScenario);
    expect(r.pass).toBe(false);
    expect(r.hardFail).toBe(true);
  });

  it('hard-fails when no init is found', () => {
    const root = mkdtempSync(join(tmpdir(), 'eval-init-test-'));
    process.env.EVALS_WORKING_DIR = root;
    const path = 'src/main.ts';
    writeFile(join(root, path), `export const noop = () => 1;\n`);
    const r = scorer.evaluate(makeArtifact([path]), dummyScenario);
    expect(r.pass).toBe(false);
    expect(r.hardFail).toBe(true);
  });
});
