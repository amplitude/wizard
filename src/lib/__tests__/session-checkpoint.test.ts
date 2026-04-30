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

    // ── Hydration + TTL invariants ────────────────────────────────────────
    //
    // These four cover the contract the rest of the wizard relies on:
    //   1. A fresh checkpoint hydrates region + org/project + framework.
    //   2. A checkpoint older than 24h is treated as stale and ignored.
    //   3. A checkpoint belonging to a different installDir is ignored.
    //   4. Malformed JSON / schema-mismatch returns null cleanly.
    //
    // bin.ts wires the load through `Object.assign(session, checkpoint)` so
    // any field the loader doesn't return is a silent regression — the
    // Object.assign would simply skip it. That makes it cheap to add fields
    // to the schema and easy to forget to surface them on read; these
    // assertions catch that failure mode.

    it('hydrates region + org/project + framework when fresh', async () => {
      filePath = writeCheckpoint(installDir, {
        region: 'eu',
        selectedOrgId: 'org-42',
        selectedOrgName: 'Acme EU',
        selectedWorkspaceId: 'ws-1',
        selectedWorkspaceName: 'Production',
        integration: Integration.nextjs,
        detectedFrameworkLabel: 'Next.js',
        detectionComplete: true,
        introConcluded: true,
      });

      const loaded = await loadCheckpoint(installDir);
      expect(loaded).not.toBeNull();
      expect(loaded?.region).toBe('eu');
      expect(loaded?.selectedOrgId).toBe('org-42');
      expect(loaded?.selectedOrgName).toBe('Acme EU');
      expect(loaded?.selectedProjectId).toBe('ws-1');
      expect(loaded?.selectedProjectName).toBe('Production');
      expect(loaded?.integration).toBe(Integration.nextjs);
      expect(loaded?.detectionComplete).toBe(true);
      expect(loaded?.introConcluded).toBe(true);
    });

    it('treats a >24h-old checkpoint as stale and returns null', async () => {
      const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      filePath = writeCheckpoint(installDir, {
        savedAt: stale,
        region: 'us',
      });

      const loaded = await loadCheckpoint(installDir);
      expect(loaded).toBeNull();
    });

    it('ignores a checkpoint whose installDir does not match', async () => {
      // Write a checkpoint at our installDir, but tag it as belonging to
      // a different project. Mirrors what would happen if a user copied
      // a temp dir between projects, or if the cache root were shared.
      filePath = writeCheckpoint(installDir, {
        installDir: '/some/other/project',
        region: 'us',
      });

      const loaded = await loadCheckpoint(installDir);
      expect(loaded).toBeNull();
    });

    it('returns null for malformed JSON without throwing', async () => {
      filePath = checkpointPathFor(installDir);
      fs.mkdirSync(getRunDir(installDir), { recursive: true });
      fs.writeFileSync(filePath, '{ this is not valid json');

      // Must not throw — startup should never crash because of a bad
      // checkpoint file.
      const loaded = await loadCheckpoint(installDir);
      expect(loaded).toBeNull();
    });
  },
);
