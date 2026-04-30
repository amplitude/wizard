import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { selfHealStaleProjectState } from '../self-heal.js';
import { writeAmpliConfig } from '../ampli-config.js';
import { CACHE_ROOT_OVERRIDE_ENV } from '../../utils/storage-paths.js';
import {
  persistApiKey,
  readApiKey,
  clearApiKey,
} from '../../utils/api-key-store.js';
import { saveCheckpoint } from '../session-checkpoint.js';
import type { WizardSession } from '../wizard-session.js';

const STUB_SESSION = (installDir: string): WizardSession =>
  ({
    installDir,
    region: 'us',
    selectedOrgId: 'stale-org',
    selectedOrgName: 'Stale Org',
    selectedProjectId: 'stale-project',
    selectedProjectName: 'Stale Project',
    selectedEnvName: 'Production',
    integration: null,
    detectedFrameworkLabel: null,
    detectionComplete: false,
    frameworkContext: {},
    frameworkContextAnswerOrder: [],
    introConcluded: true,
  } as unknown as WizardSession);

describe('selfHealStaleProjectState', () => {
  let installDir: string;
  let cacheRoot: string;

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-heal-proj-'));
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-heal-cache-'));
    process.env[CACHE_ROOT_OVERRIDE_ENV] = cacheRoot;
  });

  afterEach(() => {
    delete process.env[CACHE_ROOT_OVERRIDE_ENV];
    try {
      fs.rmSync(installDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    try {
      fs.rmSync(cacheRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('no-ops on a healthy project (ampli.json present)', () => {
    writeAmpliConfig(installDir, { OrgId: 'o', ProjectId: 'p' });
    fs.mkdirSync(path.join(installDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(path.join(installDir, '.amplitude', 'events.json'), '[]');

    const result = selfHealStaleProjectState(installDir);

    expect(result.healed).toBe(false);
    expect(result.reason).toContain('ampli.json present');
    expect(result.artifactsRemoved).toEqual([]);
    expect(
      fs.existsSync(path.join(installDir, '.amplitude', 'events.json')),
    ).toBe(true);
  });

  it('no-ops on a fresh project (no ampli.json, no caches)', () => {
    const result = selfHealStaleProjectState(installDir);

    expect(result.healed).toBe(false);
    expect(result.reason).toContain('no per-project cache');
    expect(result.artifactsRemoved).toEqual([]);
  });

  it('wipes .amplitude/, checkpoint, and stored API key after git reset', () => {
    // Simulate post-`git reset` state: ampli.json gone, but per-project
    // caches still reference an old project.
    fs.mkdirSync(path.join(installDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      path.join(installDir, '.amplitude', 'events.json'),
      '[{"event":"stale"}]',
    );
    fs.writeFileSync(
      path.join(installDir, '.amplitude', 'dashboard.json'),
      '{"url":"https://stale"}',
    );
    saveCheckpoint(STUB_SESSION(installDir), 'test');
    persistApiKey('stale-api-key', installDir);

    expect(readApiKey(installDir)).toBe('stale-api-key');

    const result = selfHealStaleProjectState(installDir);

    expect(result.healed).toBe(true);
    expect(result.reason).toContain('likely git reset');
    expect(fs.existsSync(path.join(installDir, '.amplitude'))).toBe(false);
    expect(readApiKey(installDir)).toBeNull();

    // Checkpoint file should also be gone
    expect(
      result.artifactsRemoved.some((p) => p.endsWith('checkpoint.json')),
    ).toBe(true);
    expect(
      result.artifactsRemoved.some((p) =>
        p.includes('credentials.json[this install dir]'),
      ),
    ).toBe(true);
  });

  it('preserves stored API keys for OTHER install directories', () => {
    const otherInstall = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wizard-heal-other-'),
    );
    try {
      // Other project: has ampli.json, has its own API key.
      writeAmpliConfig(otherInstall, { OrgId: 'o2', ProjectId: 'p2' });
      persistApiKey('other-api-key', otherInstall);

      // This project: simulate git reset.
      fs.mkdirSync(path.join(installDir, '.amplitude'), { recursive: true });
      persistApiKey('this-api-key', installDir);

      selfHealStaleProjectState(installDir);

      // Other project's key must survive.
      expect(readApiKey(otherInstall)).toBe('other-api-key');
      expect(readApiKey(installDir)).toBeNull();
    } finally {
      clearApiKey(otherInstall);
      fs.rmSync(otherInstall, { recursive: true, force: true });
    }
  });

  it('removes legacy dotfile mirrors (.amplitude-events.json, .amplitude-dashboard.json)', () => {
    fs.writeFileSync(path.join(installDir, '.amplitude-events.json'), '[]');
    fs.writeFileSync(path.join(installDir, '.amplitude-dashboard.json'), '{}');

    const result = selfHealStaleProjectState(installDir);

    expect(result.healed).toBe(true);
    expect(fs.existsSync(path.join(installDir, '.amplitude-events.json'))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.join(installDir, '.amplitude-dashboard.json')),
    ).toBe(false);
  });

  it('does not touch ~/.ampli.json (user-level OAuth tokens)', () => {
    // The function never reads or writes ~/.ampli.json — it's user-level
    // state, not per-project. This test asserts the contract by checking
    // that running self-heal on a project doesn't reach into HOME.
    fs.mkdirSync(path.join(installDir, '.amplitude'), { recursive: true });
    const homeAmpliPath = path.join(os.homedir(), '.ampli.json');
    const existedBefore = fs.existsSync(homeAmpliPath);
    const contentBefore = existedBefore
      ? fs.readFileSync(homeAmpliPath, 'utf8')
      : null;

    selfHealStaleProjectState(installDir);

    const existsAfter = fs.existsSync(homeAmpliPath);
    expect(existsAfter).toBe(existedBefore);
    if (contentBefore !== null) {
      expect(fs.readFileSync(homeAmpliPath, 'utf8')).toBe(contentBefore);
    }
  });
});
