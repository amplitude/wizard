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

  it('preserves the canonical file when both legacy and canonical exist', () => {
    const legacy = LEGACY_PATHS.events(installDir);
    const canonical = getEventsFile(installDir);
    mkdirSync(getProjectMetaDir(installDir), { recursive: true });
    writeFileSync(canonical, '"canonical-wins"');
    writeFileSync(legacy, '"legacy-loses"');

    runMigrationShim(installDir);

    expect(readFileSync(canonical, 'utf8')).toBe('"canonical-wins"');
    expect(existsSync(legacy)).toBe(false);
  });

  it('skips per-project migration when installDir is undefined', () => {
    const legacy = LEGACY_PATHS.events(installDir);
    writeFileSync(legacy, '[]');

    runMigrationShim();

    // Per-project migration didn't run, so the legacy file still exists.
    expect(existsSync(legacy)).toBe(true);
  });

  it('does not migrate the global benchmark file when a project version exists', () => {
    const legacyBenchmark = join(tmpdir(), 'amplitude-wizard-benchmark.json');
    const canonical = getBenchmarkFile(installDir);
    mkdirSync(join(cacheRoot, 'runs', projectHash(installDir)), {
      recursive: true,
    });
    writeFileSync(canonical, '{"new":true}');
    writeFileSync(legacyBenchmark, '{"old":true}');

    runMigrationShim(installDir);

    expect(readFileSync(canonical, 'utf8')).toBe('{"new":true}');
    // Legacy benchmark should be cleaned up either way.
    expect(existsSync(legacyBenchmark)).toBe(false);
  });
});
