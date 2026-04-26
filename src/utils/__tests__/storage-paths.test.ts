import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CACHE_ROOT_OVERRIDE_ENV,
  ensureDir,
  getBenchmarkFile,
  getCacheRoot,
  getCheckpointFile,
  getDashboardFile,
  getEventsFile,
  getInstallationErrorLogFile,
  getLogFile,
  getPlanFile,
  getPlansDir,
  getProjectMetaDir,
  getRunDir,
  getStateFile,
  getStructuredLogFile,
  getUpdateCheckFile,
  LEGACY_PATHS,
  projectHash,
} from '../storage-paths.js';

describe('storage-paths', () => {
  let tmpRoot: string;
  let originalOverride: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-paths-test-'));
    originalOverride = process.env[CACHE_ROOT_OVERRIDE_ENV];
    process.env[CACHE_ROOT_OVERRIDE_ENV] = tmpRoot;
  });

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env[CACHE_ROOT_OVERRIDE_ENV];
    } else {
      process.env[CACHE_ROOT_OVERRIDE_ENV] = originalOverride;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('getCacheRoot', () => {
    it('honors AMPLITUDE_WIZARD_CACHE_DIR override', () => {
      expect(getCacheRoot()).toBe(tmpRoot);
    });

    it('falls back to ~/.amplitude/wizard when override is unset', () => {
      delete process.env[CACHE_ROOT_OVERRIDE_ENV];
      expect(getCacheRoot()).toBe(
        path.join(os.homedir(), '.amplitude', 'wizard'),
      );
    });

    it('ignores empty-string override', () => {
      process.env[CACHE_ROOT_OVERRIDE_ENV] = '';
      expect(getCacheRoot()).toBe(
        path.join(os.homedir(), '.amplitude', 'wizard'),
      );
    });
  });

  describe('projectHash', () => {
    it('produces a 12-char hex digest', () => {
      const hash = projectHash('/some/install/dir');
      expect(hash).toMatch(/^[a-f0-9]{12}$/);
    });

    it('is deterministic for the same input', () => {
      expect(projectHash('/foo')).toBe(projectHash('/foo'));
    });

    it('produces different digests for different inputs', () => {
      expect(projectHash('/foo')).not.toBe(projectHash('/bar'));
    });
  });

  describe('per-project paths', () => {
    const installDir = '/Users/test/project-a';

    it('runDir is under runs/<hash>/', () => {
      const runDir = getRunDir(installDir);
      const hash = projectHash(installDir);
      expect(runDir).toBe(path.join(tmpRoot, 'runs', hash));
    });

    it('log/structured-log/benchmark/checkpoint all live in the run dir', () => {
      const runDir = getRunDir(installDir);
      expect(getLogFile(installDir)).toBe(path.join(runDir, 'log.txt'));
      expect(getStructuredLogFile(installDir)).toBe(
        path.join(runDir, 'log.ndjson'),
      );
      expect(getBenchmarkFile(installDir)).toBe(
        path.join(runDir, 'benchmark.json'),
      );
      expect(getCheckpointFile(installDir)).toBe(
        path.join(runDir, 'checkpoint.json'),
      );
    });

    it('different install dirs do not collide', () => {
      const a = getLogFile('/Users/test/project-a');
      const b = getLogFile('/Users/test/project-b');
      expect(a).not.toBe(b);
    });

    it('installation-error log lands in the run dir with a timestamp suffix', () => {
      const file = getInstallationErrorLogFile(installDir);
      expect(file.startsWith(getRunDir(installDir))).toBe(true);
      expect(file).toMatch(/installation-error-\d+\.log$/);
    });
  });

  describe('per-user paths (no installDir scope)', () => {
    it('plansDir + planFile', () => {
      expect(getPlansDir()).toBe(path.join(tmpRoot, 'plans'));
      expect(getPlanFile('abc-123')).toBe(
        path.join(tmpRoot, 'plans', 'abc-123.json'),
      );
    });

    it('stateFile is per-attempt under state/', () => {
      expect(getStateFile('attempt-xyz')).toBe(
        path.join(tmpRoot, 'state', 'attempt-xyz.json'),
      );
    });

    it('updateCheck file is at the cache root', () => {
      expect(getUpdateCheckFile()).toBe(
        path.join(tmpRoot, 'update-check.json'),
      );
    });
  });

  describe('per-project metadata dir', () => {
    it('lives directly under installDir as .amplitude/', () => {
      expect(getProjectMetaDir('/p')).toBe(path.join('/p', '.amplitude'));
      expect(getEventsFile('/p')).toBe(
        path.join('/p', '.amplitude', 'events.json'),
      );
      expect(getDashboardFile('/p')).toBe(
        path.join('/p', '.amplitude', 'dashboard.json'),
      );
    });
  });

  describe('ensureDir', () => {
    it('creates nested directories', () => {
      const target = path.join(tmpRoot, 'a', 'b', 'c');
      ensureDir(target);
      expect(fs.existsSync(target)).toBe(true);
    });

    it('is idempotent', () => {
      const target = path.join(tmpRoot, 'idempotent');
      ensureDir(target);
      ensureDir(target);
      expect(fs.existsSync(target)).toBe(true);
    });

    it('does not throw when mkdir fails', () => {
      // Create a file at the target path so mkdir can't make a directory there
      const blocker = path.join(tmpRoot, 'blocker');
      fs.writeFileSync(blocker, '');
      expect(() => ensureDir(blocker)).not.toThrow();
    });
  });

  describe('LEGACY_PATHS', () => {
    it('points the log entries at the pre-refactor /tmp paths', () => {
      expect(LEGACY_PATHS.log).toBe('/tmp/amplitude-wizard.log');
      expect(LEGACY_PATHS.logl).toBe('/tmp/amplitude-wizard.logl');
    });

    it('produces tmpdir-scoped per-project legacy paths', () => {
      const hash = projectHash('/p');
      expect(LEGACY_PATHS.checkpoint(hash)).toBe(
        path.join(os.tmpdir(), `amplitude-wizard-checkpoint-${hash}.json`),
      );
      expect(LEGACY_PATHS.state('attempt-1')).toBe(
        path.join(os.tmpdir(), 'amplitude-wizard-state-attempt-1.json'),
      );
    });

    it('produces project-scoped legacy event/dashboard dotfile paths', () => {
      expect(LEGACY_PATHS.events('/p')).toBe(
        path.join('/p', '.amplitude-events.json'),
      );
      expect(LEGACY_PATHS.dashboard('/p')).toBe(
        path.join('/p', '.amplitude-dashboard.json'),
      );
    });
  });
});
