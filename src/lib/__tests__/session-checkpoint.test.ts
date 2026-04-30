import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadCheckpoint } from '../session-checkpoint';
import { Integration } from '../constants';
import {
  CACHE_ROOT_OVERRIDE_ENV,
  getCheckpointFile,
  getRunDir,
} from '../../utils/storage-paths';

function checkpointPathFor(installDir: string): string {
  return getCheckpointFile(installDir);
}

function writeCheckpoint(
  installDir: string,
  overrides: Record<string, unknown> = {},
): string {
  const filePath = checkpointPathFor(installDir);
  // The run dir under the cache root has to exist before writeFileSync runs.
  fs.mkdirSync(getRunDir(installDir), { recursive: true });
  const payload = {
    savedAt: new Date().toISOString(),
    installDir,
    region: 'us',
    selectedOrgId: 'org-1',
    selectedOrgName: 'Acme',
    selectedWorkspaceId: null,
    selectedWorkspaceName: null,
    selectedEnvName: null,
    integration: null,
    detectedFrameworkLabel: null,
    detectionComplete: false,
    frameworkContext: {},
    introConcluded: false,
    ...overrides,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload));
  return filePath;
}

// 20s per-describe timeout: each test does `await loadCheckpoint(...)` which
// dynamic-imports `./registry.js` — that import pulls in all 18 framework
// configs and can exceed the default 5s ceiling under parallel test-runner
// load. The previous 10s ceiling was occasionally hit on cold-cache runs
// after this PR added more concurrent test files, so we bumped to 20s.
// Bumping at the describe level (rather than vitest.config.ts) keeps the
// fix local and avoids collision with PRs touching global vitest config.
describe(
  'loadCheckpoint — self-healing of detectedFrameworkLabel',
  { timeout: 20_000 },
  () => {
    let installDir: string;
    let filePath: string;
    let cacheRoot: string;
    let originalOverride: string | undefined;

    beforeEach(() => {
      installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-ckpt-'));
      // Redirect the cache root so the checkpoint file lands in a temp dir we
      // can clean up, instead of polluting `~/.amplitude/wizard/`.
      cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-ckpt-cache-'));
      originalOverride = process.env[CACHE_ROOT_OVERRIDE_ENV];
      process.env[CACHE_ROOT_OVERRIDE_ENV] = cacheRoot;
    });

    afterEach(() => {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      fs.rmSync(installDir, { recursive: true, force: true });
      fs.rmSync(cacheRoot, { recursive: true, force: true });
      if (originalOverride === undefined) {
        delete process.env[CACHE_ROOT_OVERRIDE_ENV];
      } else {
        process.env[CACHE_ROOT_OVERRIDE_ENV] = originalOverride;
      }
    });

    it('overrides a stale "Generic" label when integration is a known framework', async () => {
      filePath = writeCheckpoint(installDir, {
        integration: Integration.javascript_web,
        detectedFrameworkLabel: 'Generic', // stale — older buggy runs wrote this
      });

      const loaded = await loadCheckpoint(installDir);
      expect(loaded?.integration).toBe(Integration.javascript_web);
      expect(loaded?.detectedFrameworkLabel).toBe('JavaScript (Web)');
    });

    it('derives the label for Vue when integration is set', async () => {
      filePath = writeCheckpoint(installDir, {
        integration: Integration.vue,
        detectedFrameworkLabel: null,
      });

      const loaded = await loadCheckpoint(installDir);
      expect(loaded?.detectedFrameworkLabel).toBe('Vue');
    });

    it('preserves null label for Generic integration', async () => {
      filePath = writeCheckpoint(installDir, {
        integration: Integration.generic,
        detectedFrameworkLabel: null,
      });

      const loaded = await loadCheckpoint(installDir);
      expect(loaded?.integration).toBe(Integration.generic);
      expect(loaded?.detectedFrameworkLabel).toBeNull();
    });

    it('keeps the persisted label when integration is null', async () => {
      filePath = writeCheckpoint(installDir, {
        integration: null,
        detectedFrameworkLabel: 'Custom',
      });

      const loaded = await loadCheckpoint(installDir);
      expect(loaded?.detectedFrameworkLabel).toBe('Custom');
    });

    it('keeps the persisted label when integration is unknown', async () => {
      filePath = writeCheckpoint(installDir, {
        integration: 'made-up-framework',
        detectedFrameworkLabel: 'Made Up',
      });

      const loaded = await loadCheckpoint(installDir);
      expect(loaded?.detectedFrameworkLabel).toBe('Made Up');
    });

    // Regression: pre-fix the schema's transform fell back
    // `selectedEnvName ?? selectedProjectName ?? null`, silently using the
    // project name as the environment name on resume. That broke HeaderBar /
    // `/whoami` and any code path that filters environments by name.
    it('does NOT fall back from selectedProjectName to selectedEnvName', async () => {
      filePath = writeCheckpoint(installDir, {
        selectedProjectId: 'proj-1',
        selectedProjectName: 'My Project',
        selectedEnvName: null,
      });

      const loaded = await loadCheckpoint(installDir);
      expect(loaded?.selectedProjectName).toBe('My Project');
      // Critical: env name stays null, NOT 'My Project'.
      expect(loaded?.selectedEnvName).toBeNull();
    });

    it('preserves an explicit selectedEnvName across reload', async () => {
      filePath = writeCheckpoint(installDir, {
        selectedProjectName: 'My Project',
        selectedEnvName: 'Production',
      });

      const loaded = await loadCheckpoint(installDir);
      expect(loaded?.selectedEnvName).toBe('Production');
    });
  },
);
