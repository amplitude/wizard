import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrationShim } from '../storage-migration.js';
import {
  CACHE_ROOT_OVERRIDE_ENV,
  getBenchmarkFile,
  getCheckpointFile,
  getDashboardFile,
  getEventsFile,
  getPlansDir,
  getProjectMetaDir,
  getStateFile,
  getUpdateCheckFile,
  LEGACY_PATHS,
  projectHash,
} from '../storage-paths.js';

describe('runMigrationShim', () => {
  let cacheRoot: string;
  let installDir: string;
  let originalCacheOverride: string | undefined;

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'wiz-migrate-cache-'));
    installDir = mkdtempSync(join(tmpdir(), 'wiz-migrate-project-'));
    originalCacheOverride = process.env[CACHE_ROOT_OVERRIDE_ENV];
    process.env[CACHE_ROOT_OVERRIDE_ENV] = cacheRoot;
  });

  afterEach(() => {
    rmSync(cacheRoot, { recursive: true, force: true });
    rmSync(installDir, { recursive: true, force: true });
    if (originalCacheOverride === undefined) {
      delete process.env[CACHE_ROOT_OVERRIDE_ENV];
    } else {
      process.env[CACHE_ROOT_OVERRIDE_ENV] = originalCacheOverride;
    }
  });

  it('moves the legacy events.json into the new .amplitude/ subdir', () => {
    const legacy = LEGACY_PATHS.events(installDir);
    const canonical = getEventsFile(installDir);
    const payload = '[{"name":"x","description":"y"}]';
    writeFileSync(legacy, payload);

    runMigrationShim(installDir);

    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(canonical)).toBe(true);
    expect(readFileSync(canonical, 'utf8')).toBe(payload);
  });

  it('moves the legacy dashboard.json into the new .amplitude/ subdir', () => {
    const legacy = LEGACY_PATHS.dashboard(installDir);
    const canonical = getDashboardFile(installDir);
    const payload = '{"dashboardUrl":"https://x"}';
    writeFileSync(legacy, payload);

    runMigrationShim(installDir);

    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(canonical)).toBe(true);
    expect(readFileSync(canonical, 'utf8')).toBe(payload);
  });

  it('moves the legacy checkpoint into <runDir>/checkpoint.json', () => {
    const hash = projectHash(installDir);
    const legacy = LEGACY_PATHS.checkpoint(hash);
    const canonical = getCheckpointFile(installDir);
    const payload = '{"savedAt":"2026-04-26T00:00:00.000Z"}';
    writeFileSync(legacy, payload);

    runMigrationShim(installDir);

    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(canonical)).toBe(true);
    expect(readFileSync(canonical, 'utf8')).toBe(payload);

    // Cleanup the temp checkpoint file we wrote — it lives in the system
    // tmpdir, not in our test cacheRoot/installDir, so the afterEach won't
    // catch it.
    if (existsSync(legacy)) rmSync(legacy);
  });

  it('moves agent-state files matching the legacy pattern', () => {
    const attemptId = 'migrate-attempt-test';
    const legacy = LEGACY_PATHS.state(attemptId);
    const canonical = getStateFile(attemptId);
    writeFileSync(legacy, '{}');

    runMigrationShim(installDir);

    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(canonical)).toBe(true);
  });

  it('moves the legacy update-check cache', () => {
    const legacy = LEGACY_PATHS.updateCheck();
    const canonical = getUpdateCheckFile();
    const payload = '{"lastCheckedAt":1000,"latestVersion":"1.0.0"}';
    writeFileSync(legacy, payload);

    runMigrationShim(installDir);

    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(canonical)).toBe(true);
    expect(readFileSync(canonical, 'utf8')).toBe(payload);
  });

  it('migrates the entire legacy plans dir into the new plans dir', () => {
    const legacyDir = LEGACY_PATHS.plansDir();
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'plan-a.json'), '{}');
    writeFileSync(join(legacyDir, 'plan-b.json'), '{}');

    runMigrationShim(installDir);

    const newDir = getPlansDir();
    expect(existsSync(join(newDir, 'plan-a.json'))).toBe(true);
    expect(existsSync(join(newDir, 'plan-b.json'))).toBe(true);
  });

  it('is idempotent — running twice is a no-op when nothing legacy remains', () => {
    runMigrationShim(installDir);
    expect(() => runMigrationShim(installDir)).not.toThrow();
  });

  // Regression: bugbot caught that the migration unconditionally
  // scanned the entire `tmpdir()` on every wizard startup. Once the
  // first pass completes, a sentinel marks the cache root as migrated
  // so subsequent calls skip the expensive readdir scans.
  it('writes a sentinel after the user-scoped migration completes', () => {
    const sentinel = join(cacheRoot, '.migrated-v1');
    expect(existsSync(sentinel)).toBe(false);

    runMigrationShim(installDir);
    expect(existsSync(sentinel)).toBe(true);
  });

  // Regression: the global sentinel must NOT gate per-project
  // migration. If a user upgrades and runs the wizard against project
  // A first, the sentinel is written. Running against project B
  // afterwards must still migrate project B's legacy files —
  // otherwise the second-and-onward projects silently lose
  // crash-recovery state and the preserved-across-runs event plan.
  it('per-project migration runs even when the user-scoped sentinel exists', () => {
    // Drop the sentinel as if a previous project already migrated.
    mkdirSync(cacheRoot, { recursive: true });
    writeFileSync(join(cacheRoot, '.migrated-v1'), 'migrated-at=...');

    // Stage project B's legacy event plan (the wizard never saw this
    // project before).
    const legacy = LEGACY_PATHS.events(installDir);
    writeFileSync(legacy, '[{"name":"x","description":"y"}]');

    runMigrationShim(installDir);

    // Per-project moves still happened.
    expect(existsSync(legacy)).toBe(false);
    const canonical = getEventsFile(installDir);
    expect(existsSync(canonical)).toBe(true);
  });

  it('preserves the canonical file when both legacy and canonical exist', () => {
    const legacy = LEGACY_PATHS.events(installDir);
    const canonical = getEventsFile(installDir);
    mkdirSync(getProjectMetaDir(installDir), { recursive: true });
    writeFileSync(canonical, '"canonical-wins"');
    writeFileSync(legacy, '"legacy-loses"');

    runMigrationShim(installDir);

    // Canonical wins. The legacy file is intentionally left in place
    // for events.json / dashboard.json (preserveLegacy=true) so a
    // concurrent wizard run that's currently writing the legacy path
    // can't be clobbered mid-flight. The agent's next watcher tick
    // picks the freshest file via mtime regardless.
    expect(readFileSync(canonical, 'utf8')).toBe('"canonical-wins"');
    expect(existsSync(legacy)).toBe(true);
    expect(readFileSync(legacy, 'utf8')).toBe('"legacy-loses"');
  });

  it('skips per-project migration when installDir is undefined', () => {
    const legacy = LEGACY_PATHS.events(installDir);
    writeFileSync(legacy, '[]');

    runMigrationShim();

    // Per-project migration didn't run, so the legacy file still exists.
    expect(existsSync(legacy)).toBe(true);
  });

  it('does not migrate the global benchmark file when a project version exists', () => {
    // The legacy benchmark path is the literal `/tmp/...` that the old
    // `middleware/config.ts` hardcoded. Use `LEGACY_PATHS.benchmark`
    // (string) — deriving from `tmpdir()` would give `/var/folders/...`
    // on macOS and miss the file the migration is looking for.
    const legacyBenchmark = LEGACY_PATHS.benchmark;
    const canonical = getBenchmarkFile(installDir);
    mkdirSync(join(cacheRoot, 'runs', projectHash(installDir)), {
      recursive: true,
    });
    writeFileSync(canonical, '{"new":true}');
    // Save and restore — `/tmp/amplitude-wizard-benchmark.json` is a
    // shared path; a real benchmark run alongside this test could be
    // clobbered otherwise.
    const preExisting = existsSync(legacyBenchmark)
      ? readFileSync(legacyBenchmark, 'utf8')
      : null;
    try {
      writeFileSync(legacyBenchmark, '{"old":true}');

      runMigrationShim(installDir);

      expect(readFileSync(canonical, 'utf8')).toBe('{"new":true}');
      // Legacy benchmark should be cleaned up either way.
      expect(existsSync(legacyBenchmark)).toBe(false);
    } finally {
      if (preExisting !== null) writeFileSync(legacyBenchmark, preExisting);
    }
  });

  // Regression: bugbot caught that the migration helper used a custom
  // `parentDir` that searched only for `'/'`, breaking on Windows where
  // `path.join` produces `\`-separated paths. We now use `path.dirname`,
  // which handles both separators. This test exercises the move pipeline
  // end-to-end on POSIX, which is the only place tests can run; the
  // semantic guarantee is that `dirname()` is correct on Windows and the
  // unit test for `getRunDir()` already covers Windows-style joins.
  it('creates parent dirs for nested move targets via path.dirname', () => {
    // The state migration moves into `<cacheRoot>/state/<id>.json` whose
    // parent (`state/`) doesn't exist on a fresh cache root. If the
    // migration's parent-dir helper got confused, `renameSync` would
    // fail with ENOENT and the file would stay in tmpdir.
    const legacy = join(tmpdir(), 'amplitude-wizard-state-newdir-test.json');
    writeFileSync(legacy, '{}');

    runMigrationShim(installDir);

    const canonical = join(
      cacheRoot,
      'state',
      `newdir-test-${process.pid}.json`,
    );
    expect(existsSync(canonical)).toBe(true);
    expect(existsSync(legacy)).toBe(false);
  });

  // Regression: ordering matters. `bin.ts` runs the migration BEFORE
  // `setProjectLogFile` so the bootstrap log doesn't pre-exist when we
  // try to move the legacy global log into it. This test verifies the
  // migration step itself preserves the legacy log content when the
  // bootstrap target doesn't yet exist.
  //
  // The legacy path is the hardcoded `/tmp/amplitude-wizard.log` (we
  // don't have a way to redirect it without a runtime hook). To stay
  // safe alongside any pre-existing file the developer may have on
  // their machine, we save and restore.
  it('moves the legacy global log into the new bootstrap location', () => {
    const legacy = '/tmp/amplitude-wizard.log';
    const target = join(cacheRoot, 'bootstrap.log');
    const preExisting = existsSync(legacy)
      ? readFileSync(legacy, 'utf8')
      : null;
    try {
      writeFileSync(legacy, 'legacy log content\n');

      runMigrationShim(installDir);

      expect(existsSync(legacy)).toBe(false);
      expect(readFileSync(target, 'utf8')).toBe('legacy log content\n');
    } finally {
      if (preExisting !== null) writeFileSync(legacy, preExisting);
    }
  });
});
