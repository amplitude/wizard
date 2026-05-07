import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { selfHealStaleProjectState } from '../self-heal.js';
import { writeAmpliConfig } from '../ampli-config.js';
import {
  CACHE_ROOT_OVERRIDE_ENV,
  getProjectBindingFile,
  getProjectMetaDir,
} from '../../utils/storage-paths.js';
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

function writeProjectBinding(installDir: string): void {
  const bindingFile = getProjectBindingFile(installDir);
  fs.mkdirSync(path.dirname(bindingFile), { recursive: true });
  fs.writeFileSync(bindingFile, JSON.stringify({ orgId: 'o', projectId: 'p' }));
}

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

  it('no-ops on a healthy project (legacy ampli.json present)', () => {
    writeAmpliConfig(installDir, { OrgId: 'o', ProjectId: 'p' });
    fs.mkdirSync(path.join(installDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(path.join(installDir, '.amplitude', 'events.json'), '[]');

    const result = selfHealStaleProjectState(installDir);

    expect(result.healed).toBe(false);
    expect(result.reason).toContain('caches are consistent');
    expect(result.artifactsRemoved).toEqual([]);
    expect(
      fs.existsSync(path.join(installDir, '.amplitude', 'events.json')),
    ).toBe(true);
  });

  it('no-ops on a healthy post-G1 project (project-binding.json present, no ampli.json)', () => {
    writeProjectBinding(installDir);
    fs.writeFileSync(path.join(installDir, '.amplitude', 'events.json'), '[]');
    persistApiKey('healthy-key', installDir);

    const result = selfHealStaleProjectState(installDir);

    expect(result.healed).toBe(false);
    expect(result.reason).toContain('caches are consistent');
    expect(result.artifactsRemoved).toEqual([]);
    expect(
      fs.existsSync(path.join(installDir, '.amplitude', 'events.json')),
    ).toBe(true);
    expect(readApiKey(installDir)).toBe('healthy-key');
  });

  it('no-ops on a fresh project (no ampli.json, no caches, no API key)', () => {
    const result = selfHealStaleProjectState(installDir);

    expect(result.healed).toBe(false);
    expect(result.reason).toContain('fresh / post-G1 project');
    expect(result.artifactsRemoved).toEqual([]);
  });

  it('no-ops on post-G1 cold start: ampli.json absent, no API key, but checkpoint + events present', () => {
    // Critical regression case: the user fresh-clones a project that was
    // previously instrumented but the `.amplitude/` dir was committed (or
    // they restored it from another machine). They have NO stored API key
    // for this install dir yet, so this is a normal post-G1 cold start —
    // self-heal must NOT nuke their events.json.
    fs.mkdirSync(path.join(installDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      path.join(installDir, '.amplitude', 'events.json'),
      '[{"event":"resume me"}]',
    );
    fs.writeFileSync(
      path.join(installDir, '.amplitude', 'dashboard.json'),
      '{"url":"https://resume"}',
    );
    saveCheckpoint(STUB_SESSION(installDir), 'test');

    const result = selfHealStaleProjectState(installDir);

    expect(result.healed).toBe(false);
    expect(result.reason).toContain('fresh / post-G1 project');
    // .amplitude/events.json must survive — that's the user's resumable plan.
    expect(
      fs.existsSync(path.join(installDir, '.amplitude', 'events.json')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(installDir, '.amplitude', 'dashboard.json')),
    ).toBe(true);
  });

  it('clears orphan credential after git reset (API key + no binding) and PRESERVES events.json', () => {
    // Real `git reset` symptom: stored API key but no binding source.
    // Self-heal should clear the credential ONLY — preserving the events
    // plan so the user can resume the aborted run after re-authenticating.
    fs.mkdirSync(path.join(installDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      path.join(installDir, '.amplitude', 'events.json'),
      '[{"event":"resume me"}]',
    );
    fs.writeFileSync(
      path.join(installDir, '.amplitude', 'dashboard.json'),
      '{"url":"https://resume"}',
    );
    saveCheckpoint(STUB_SESSION(installDir), 'test');
    persistApiKey('stale-api-key', installDir);

    expect(readApiKey(installDir)).toBe('stale-api-key');

    const result = selfHealStaleProjectState(installDir);

    expect(result.healed).toBe(true);
    expect(result.reason).toContain('orphan credential');
    expect(readApiKey(installDir)).toBeNull();
    expect(
      result.artifactsRemoved.some((p) =>
        p.includes('credentials.json[this install dir]'),
      ),
    ).toBe(true);

    // CRITICAL: per-project events / dashboard / checkpoint must survive.
    expect(
      fs.existsSync(path.join(installDir, '.amplitude', 'events.json')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(installDir, '.amplitude', 'dashboard.json')),
    ).toBe(true);
    expect(fs.existsSync(getProjectMetaDir(installDir))).toBe(true);
  });

  it('preserves stored API keys for OTHER install directories', () => {
    const otherInstall = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wizard-heal-other-'),
    );
    try {
      // Other project: has ampli.json, has its own API key.
      writeAmpliConfig(otherInstall, { OrgId: 'o2', ProjectId: 'p2' });
      persistApiKey('other-api-key', otherInstall);

      // This project: simulate git reset — orphan credential, no binding.
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

  it('removes legacy dotfile mirrors when paired with a stale credential', () => {
    // Pre-`.amplitude/` layout artifacts paired with an orphan API key.
    fs.writeFileSync(path.join(installDir, '.amplitude-events.json'), '[]');
    fs.writeFileSync(path.join(installDir, '.amplitude-dashboard.json'), '{}');
    persistApiKey('stale-api-key', installDir);

    const result = selfHealStaleProjectState(installDir);

    expect(result.healed).toBe(true);
    expect(fs.existsSync(path.join(installDir, '.amplitude-events.json'))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.join(installDir, '.amplitude-dashboard.json')),
    ).toBe(false);
    expect(readApiKey(installDir)).toBeNull();
  });

  it('does NOT remove legacy dotfile mirrors when no stored API key is present', () => {
    // Without a stale credential there is no clear contradiction. The
    // legacy dotfiles could just be leftover files the user committed in
    // the pre-`.amplitude/` era — leave them alone.
    fs.writeFileSync(path.join(installDir, '.amplitude-events.json'), '[]');
    fs.writeFileSync(path.join(installDir, '.amplitude-dashboard.json'), '{}');

    const result = selfHealStaleProjectState(installDir);

    expect(result.healed).toBe(false);
    expect(fs.existsSync(path.join(installDir, '.amplitude-events.json'))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(installDir, '.amplitude-dashboard.json')),
    ).toBe(true);
  });

  it('does not touch ~/.ampli.json (user-level OAuth tokens)', () => {
    // The function never reads or writes ~/.ampli.json — it's user-level
    // state, not per-project. This test asserts the contract by checking
    // that running self-heal on a project doesn't reach into HOME.
    persistApiKey('stale-api-key', installDir);
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
