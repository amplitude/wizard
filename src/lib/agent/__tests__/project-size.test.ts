/**
 * Unit tests for project-size detection used by the pre-flight gate.
 *
 * Covers:
 *   - File counting walks subdirectories.
 *   - `node_modules`, `.git`, build outputs, and dotted IDE/cache dirs
 *     are skipped (otherwise every project looks "large").
 *   - Event counting reads `<installDir>/.amplitude/events.json`.
 *   - Threshold-resolution honors env-var overrides + falls back to
 *     defaults on missing / invalid input.
 *   - The wall-clock cap is respected (smoke check — we don't try to
 *     synthesize a real timeout because that would be flaky).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_EVENT_THRESHOLD,
  DEFAULT_FILE_THRESHOLD,
  detectProjectSize,
  resolveThresholds,
  shouldUseJitMode,
} from '../project-size';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'project-size-'));
}

function touch(file: string, content = ''): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

describe('detectProjectSize', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('counts files at the project root', () => {
    touch(path.join(dir, 'index.ts'));
    touch(path.join(dir, 'package.json'));
    const report = detectProjectSize(dir);
    expect(report.fileCount).toBe(2);
    expect(report.timedOut).toBe(false);
  });

  it('walks subdirectories', () => {
    touch(path.join(dir, 'src/a.ts'));
    touch(path.join(dir, 'src/nested/b.ts'));
    touch(path.join(dir, 'src/nested/deep/c.ts'));
    const report = detectProjectSize(dir);
    expect(report.fileCount).toBe(3);
  });

  it('skips node_modules', () => {
    touch(path.join(dir, 'src/a.ts'));
    touch(path.join(dir, 'node_modules/pkg/index.js'));
    touch(path.join(dir, 'node_modules/pkg/sub/x.js'));
    const report = detectProjectSize(dir);
    expect(report.fileCount).toBe(1);
  });

  it('skips .git, build outputs, and dotted cache directories', () => {
    touch(path.join(dir, 'src/a.ts'));
    touch(path.join(dir, '.git/HEAD'));
    touch(path.join(dir, 'dist/bundle.js'));
    touch(path.join(dir, '.next/static/chunk.js'));
    touch(path.join(dir, '.cache/foo.bin'));
    touch(path.join(dir, 'coverage/lcov.info'));
    touch(path.join(dir, '__pycache__/foo.pyc'));
    const report = detectProjectSize(dir);
    expect(report.fileCount).toBe(1);
  });

  it('counts confirmed events from .amplitude/events.json', () => {
    touch(path.join(dir, 'src/a.ts'));
    const events = [
      { name: 'page_view', properties: {} },
      { name: 'sign_up', properties: {} },
      { name: '   ', properties: {} }, // whitespace-only name should not count
      { name: 'checkout_started', properties: {} },
    ];
    touch(
      path.join(dir, '.amplitude/events.json'),
      JSON.stringify(events, null, 2),
    );
    const report = detectProjectSize(dir);
    expect(report.eventCount).toBe(3);
  });

  it('returns zero events when events.json is missing or malformed', () => {
    touch(path.join(dir, '.amplitude/events.json'), '{not json');
    const report = detectProjectSize(dir);
    expect(report.eventCount).toBe(0);
  });

  it('does not throw on permission-denied or vanished directories', () => {
    // Confirm best-effort behavior even when the tree contains nothing
    // readable. This is the smoke test — synthesizing real EACCES would
    // require platform-specific chmod that's flaky in CI.
    expect(() => detectProjectSize(dir)).not.toThrow();
  });

  it('counts files inside `env/` directories (not skipped)', () => {
    // Regression: bare `env` was previously in the skip list, which
    // undercounted T3-stack apps that put env-validation schemas under
    // `src/env/`. We removed it; legitimate `env/` source dirs must be
    // walked.
    touch(path.join(dir, 'src/env/server.ts'));
    touch(path.join(dir, 'src/env/client.ts'));
    touch(path.join(dir, 'src/env/index.ts'));
    const report = detectProjectSize(dir);
    expect(report.fileCount).toBe(3);
  });

  it('still skips Python virtualenvs via `.venv`', () => {
    // Confirms the env removal did not regress virtualenv handling.
    touch(path.join(dir, 'src/a.py'));
    touch(path.join(dir, '.venv/lib/site-packages/foo.py'));
    const report = detectProjectSize(dir);
    expect(report.fileCount).toBe(1);
  });

  it('aborts the walk early once the file-count cap is exceeded', () => {
    // Defends against multi-second blocking on large monorepos.
    for (let i = 0; i < 50; i += 1) {
      touch(path.join(dir, `src/file-${i}.ts`));
    }
    const report = detectProjectSize(dir, { maxFiles: 10 });
    expect(report.timedOut).toBe(true);
    // We may overshoot the cap by a single readdir batch, so just assert
    // we stopped well below the full 50-file count.
    expect(report.fileCount).toBeLessThan(50);
  });
});

describe('resolveThresholds', () => {
  it('returns documented defaults when env is empty', () => {
    const t = resolveThresholds({});
    expect(t.fileThreshold).toBe(DEFAULT_FILE_THRESHOLD);
    expect(t.eventThreshold).toBe(DEFAULT_EVENT_THRESHOLD);
  });

  it('honors AMPLITUDE_WIZARD_PREFLIGHT_FILE_THRESHOLD', () => {
    const t = resolveThresholds({
      AMPLITUDE_WIZARD_PREFLIGHT_FILE_THRESHOLD: '42',
    });
    expect(t.fileThreshold).toBe(42);
    expect(t.eventThreshold).toBe(DEFAULT_EVENT_THRESHOLD);
  });

  it('honors AMPLITUDE_WIZARD_PREFLIGHT_EVENT_THRESHOLD', () => {
    const t = resolveThresholds({
      AMPLITUDE_WIZARD_PREFLIGHT_EVENT_THRESHOLD: '7',
    });
    expect(t.fileThreshold).toBe(DEFAULT_FILE_THRESHOLD);
    expect(t.eventThreshold).toBe(7);
  });

  it('falls back to defaults on negative or non-numeric overrides', () => {
    const a = resolveThresholds({
      AMPLITUDE_WIZARD_PREFLIGHT_FILE_THRESHOLD: '-1',
      AMPLITUDE_WIZARD_PREFLIGHT_EVENT_THRESHOLD: 'banana',
    });
    expect(a.fileThreshold).toBe(DEFAULT_FILE_THRESHOLD);
    expect(a.eventThreshold).toBe(DEFAULT_EVENT_THRESHOLD);

    const b = resolveThresholds({
      AMPLITUDE_WIZARD_PREFLIGHT_FILE_THRESHOLD: '0',
    });
    expect(b.fileThreshold).toBe(DEFAULT_FILE_THRESHOLD);
  });
});

describe('shouldUseJitMode', () => {
  const thresholds = { fileThreshold: 200, eventThreshold: 50 };

  it('returns false for small projects under both thresholds', () => {
    expect(
      shouldUseJitMode(
        { fileCount: 50, eventCount: 0, timedOut: false },
        thresholds,
      ),
    ).toBe(false);
  });

  it('returns true once the file threshold is exceeded', () => {
    expect(
      shouldUseJitMode(
        { fileCount: 201, eventCount: 0, timedOut: false },
        thresholds,
      ),
    ).toBe(true);
  });

  it('returns true once the event threshold is exceeded', () => {
    expect(
      shouldUseJitMode(
        { fileCount: 5, eventCount: 51, timedOut: false },
        thresholds,
      ),
    ).toBe(true);
  });

  it('treats a timed-out scan as JIT-mode (large project)', () => {
    expect(
      shouldUseJitMode(
        { fileCount: 0, eventCount: 0, timedOut: true },
        thresholds,
      ),
    ).toBe(true);
  });
});
