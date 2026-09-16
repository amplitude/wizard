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
 *   - The wall-clock cap is respected (synthesized via Date.now() stub).
 *   - Exact threshold edges (200/50, 201/51) — Kaia's review feedback.
 *   - `src/env/` and similar legitimate paths are NOT skipped.
 *   - File-count cap (`capHit`) does NOT auto-trip JIT — the partial
 *     count is compared against the threshold, so user-supplied
 *     thresholds higher than the cap are honored. (B1 from Bugbot.)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_EVENT_THRESHOLD,
  DEFAULT_FILE_THRESHOLD,
  DEFAULT_MAX_FILES_SCANNED,
  detectProjectSize,
  resolveThresholds,
  shouldUseJitMode,
} from '../project-size';
import { createTempDir } from '../../../utils/__tests__/helpers/temp-dir.js';

function touch(file: string, content = ''): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

describe('detectProjectSize', () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ dir, cleanup } = createTempDir('project-size-'));
  });

  afterEach(() => {
    try {
      cleanup();
    } catch {
      // ignore
    }
  });

  it('counts files at the project root', async () => {
    touch(path.join(dir, 'index.ts'));
    touch(path.join(dir, 'package.json'));
    const report = await detectProjectSize(dir);
    expect(report.fileCount).toBe(2);
    expect(report.timedOut).toBe(false);
    expect(report.capHit).toBe(false);
  });

  it('walks subdirectories', async () => {
    touch(path.join(dir, 'src/a.ts'));
    touch(path.join(dir, 'src/nested/b.ts'));
    touch(path.join(dir, 'src/nested/deep/c.ts'));
    const report = await detectProjectSize(dir);
    expect(report.fileCount).toBe(3);
  });

  it('skips node_modules', async () => {
    touch(path.join(dir, 'src/a.ts'));
    touch(path.join(dir, 'node_modules/pkg/index.js'));
    touch(path.join(dir, 'node_modules/pkg/sub/x.js'));
    const report = await detectProjectSize(dir);
    expect(report.fileCount).toBe(1);
  });

  it('skips .git, build outputs, and dotted cache directories', async () => {
    touch(path.join(dir, 'src/a.ts'));
    touch(path.join(dir, '.git/HEAD'));
    touch(path.join(dir, 'dist/bundle.js'));
    touch(path.join(dir, '.next/static/chunk.js'));
    touch(path.join(dir, '.cache/foo.bin'));
    touch(path.join(dir, 'coverage/lcov.info'));
    touch(path.join(dir, '__pycache__/foo.pyc'));
    const report = await detectProjectSize(dir);
    expect(report.fileCount).toBe(1);
  });

  it('counts confirmed events from .amplitude/events.json', async () => {
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
    const report = await detectProjectSize(dir);
    expect(report.eventCount).toBe(3);
  });

  it('returns zero events when events.json is missing or malformed', async () => {
    touch(path.join(dir, '.amplitude/events.json'), '{not json');
    const report = await detectProjectSize(dir);
    expect(report.eventCount).toBe(0);
  });

  it('rejects non-array, non-{events:[]} JSON via zod schema', async () => {
    // String at the root, or { foo: bar } without an events array, fail
    // the schema. Kaia A6: enforce the shape so the file format can't
    // drift silently.
    touch(path.join(dir, '.amplitude/events.json'), '"not-an-array"');
    const report = await detectProjectSize(dir);
    expect(report.eventCount).toBe(0);
  });

  it('does not throw on permission-denied or vanished directories', async () => {
    // Confirm best-effort behavior even when the tree contains nothing
    // readable. This is the smoke test — synthesizing real EACCES would
    // require platform-specific chmod that's flaky in CI.
    await expect(detectProjectSize(dir)).resolves.not.toThrow();
  });

  it('counts files inside `env/` directories (not skipped)', async () => {
    // Regression (Kaia A5): bare `env` was previously in the skip list,
    // which undercounted T3-stack apps that put env-validation schemas
    // under `src/env/`. Confirm legitimate `env/` source dirs are walked.
    touch(path.join(dir, 'src/env/server.ts'));
    touch(path.join(dir, 'src/env/client.ts'));
    touch(path.join(dir, 'src/env/index.ts'));
    const report = await detectProjectSize(dir);
    expect(report.fileCount).toBe(3);
  });

  it('also counts top-level `env/` and `app/env/` (T3 stack variants)', async () => {
    // Kaia A5 follow-up: confirm the env carve-out works at every depth
    // a T3 / Next.js project actually places it.
    touch(path.join(dir, 'env/server.ts'));
    touch(path.join(dir, 'app/env/index.ts'));
    const report = await detectProjectSize(dir);
    expect(report.fileCount).toBe(2);
  });

  it('still skips Python virtualenvs via `.venv`', async () => {
    // Confirms the env removal did not regress virtualenv handling.
    touch(path.join(dir, 'src/a.py'));
    touch(path.join(dir, '.venv/lib/site-packages/foo.py'));
    const report = await detectProjectSize(dir);
    expect(report.fileCount).toBe(1);
  });

  it('aborts the walk early once the file-count cap is exceeded', async () => {
    // Defends against multi-second blocking on large monorepos.
    for (let i = 0; i < 50; i += 1) {
      touch(path.join(dir, `src/file-${i}.ts`));
    }
    const report = await detectProjectSize(dir, { maxFiles: 10 });
    expect(report.capHit).toBe(true);
    // Wall-clock cap did NOT fire — the file-count cap did.
    expect(report.timedOut).toBe(false);
    // We may overshoot the cap by a single readdir batch, so just assert
    // we stopped well below the full 50-file count.
    expect(report.fileCount).toBeLessThan(50);
  });

  it('returns timedOut: true when the wall-clock cap fires', async () => {
    // Kaia A4 coverage gap (1): the 5s timeout case. We stub Date.now()
    // to advance past the cap on the second call so the loop bails on
    // the first iteration with `timedOut: true`.
    touch(path.join(dir, 'src/a.ts'));
    touch(path.join(dir, 'src/b.ts'));

    const realNow = Date.now;
    let callCount = 0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => {
      callCount += 1;
      // 1st call: start time. 2nd call onward: 6 seconds past start so
      // the timeout check immediately trips.
      if (callCount === 1) return 0;
      return 6_000;
    });
    try {
      const report = await detectProjectSize(dir, { timeoutMs: 5_000 });
      expect(report.timedOut).toBe(true);
      expect(report.capHit).toBe(false);
    } finally {
      spy.mockRestore();
      // Belt-and-braces — guard against vi.spyOn leaking across tests.
      expect(Date.now).toBe(realNow);
    }
  });

  it('widens maxFiles when env-var threshold exceeds the default cap (B1)', async () => {
    // Bugbot B1: a user-supplied threshold of e.g. 2000 must not be
    // silently capped at 500. `detectProjectSize` widens the effective
    // scan budget to 2 × threshold so the gate has signal.
    for (let i = 0; i < DEFAULT_MAX_FILES_SCANNED + 50; i += 1) {
      touch(path.join(dir, `src/file-${i}.ts`));
    }
    process.env.AMPLITUDE_WIZARD_PREFLIGHT_FILE_THRESHOLD = '2000';
    try {
      const report = await detectProjectSize(dir);
      // 550 files, threshold 2000, cap widens to 4000 — full count.
      expect(report.fileCount).toBe(DEFAULT_MAX_FILES_SCANNED + 50);
      expect(report.capHit).toBe(false);
    } finally {
      delete process.env.AMPLITUDE_WIZARD_PREFLIGHT_FILE_THRESHOLD;
    }
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
        { fileCount: 50, eventCount: 0, timedOut: false, capHit: false },
        thresholds,
      ),
    ).toBe(false);
  });

  it('returns false at exact file threshold (boundary check)', () => {
    // Kaia A4 coverage gap (2): the gate uses strict `>`, so 200 files
    // at threshold 200 must STAY on full mode.
    expect(
      shouldUseJitMode(
        { fileCount: 200, eventCount: 0, timedOut: false, capHit: false },
        thresholds,
      ),
    ).toBe(false);
  });

  it('returns false at exact event threshold (boundary check)', () => {
    // Same boundary check for events: 50 events at threshold 50 stays full.
    expect(
      shouldUseJitMode(
        { fileCount: 0, eventCount: 50, timedOut: false, capHit: false },
        thresholds,
      ),
    ).toBe(false);
  });

  it('returns true once the file threshold is exceeded (201 trips)', () => {
    expect(
      shouldUseJitMode(
        { fileCount: 201, eventCount: 0, timedOut: false, capHit: false },
        thresholds,
      ),
    ).toBe(true);
  });

  it('returns true once the event threshold is exceeded (51 trips)', () => {
    expect(
      shouldUseJitMode(
        { fileCount: 5, eventCount: 51, timedOut: false, capHit: false },
        thresholds,
      ),
    ).toBe(true);
  });

  it('treats a timed-out scan as JIT-mode (large project)', () => {
    expect(
      shouldUseJitMode(
        { fileCount: 0, eventCount: 0, timedOut: true, capHit: false },
        thresholds,
      ),
    ).toBe(true);
  });

  it('does NOT auto-trip JIT when only capHit fires (B1 regression)', () => {
    // Bugbot B1: file-count cap firing must not force JIT regardless of
    // threshold. With a partial count of 150 against a threshold of 200,
    // the gate stays on full mode — the user's higher threshold is honored.
    expect(
      shouldUseJitMode(
        { fileCount: 150, eventCount: 0, timedOut: false, capHit: true },
        thresholds,
      ),
    ).toBe(false);
  });

  it('does trip JIT when capHit AND fileCount exceeds threshold', () => {
    // Sanity: when the partial count is genuinely above the threshold,
    // the gate trips just like any other count.
    expect(
      shouldUseJitMode(
        { fileCount: 501, eventCount: 0, timedOut: false, capHit: true },
        thresholds,
      ),
    ).toBe(true);
  });
});
