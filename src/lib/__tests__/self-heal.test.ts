import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { selfHealStaleProjectState } from '../self-heal.js';
import { writeAmpliConfig } from '../ampli-config.js';
import {
  CACHE_ROOT_OVERRIDE_ENV,
  getCheckpointFile,
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
import { createTempDir } from '../../utils/__tests__/helpers/temp-dir.js';

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
  let cleanupInstall: () => void;
  let cleanupCache: () => void;

  beforeEach(() => {
    ({ dir: installDir, cleanup: cleanupInstall } =
      createTempDir('wizard-heal-proj-'));
    ({ dir: cacheRoot, cleanup: cleanupCache } =
      createTempDir('wizard-heal-cache-'));
    process.env[CACHE_ROOT_OVERRIDE_ENV] = cacheRoot;
  });

  afterEach(() => {
    delete process.env[CACHE_ROOT_OVERRIDE_ENV];
    try {
      cleanupInstall();
    } catch {
      /* best-effort */
    }
    try {
      cleanupCache();
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
    const { dir: otherInstall, cleanup: cleanupOther } =
      createTempDir('wizard-heal-other-');
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
      cleanupOther();
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

  it('preserves credential when binding file exists on disk (activation poll false-negative regression)', () => {
    // Audit regression: an activation-status poll returning
    // `hasAnyEvents=false` must NEVER cause self-heal to nuke a valid
    // stored credential. The only authoritative signal is disk presence
    // of `project-binding.json`. This test pins the invariant: when the
    // binding file is genuinely on disk, the stored API key is preserved
    // even if the caller invokes self-heal during/after a polling check.
    writeProjectBinding(installDir);
    persistApiKey('valid-key', installDir);
    fs.mkdirSync(path.join(installDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      path.join(installDir, '.amplitude', 'events.json'),
      '[{"event":"resume me"}]',
    );

    const result = selfHealStaleProjectState(installDir);

    expect(result.healed).toBe(false);
    expect(result.reason).toContain('caches are consistent');
    // CRITICAL: credential is preserved — disk presence of the binding
    // file dominates any other signal.
    expect(readApiKey(installDir)).toBe('valid-key');
    // Per-project artifacts also survive.
    expect(
      fs.existsSync(path.join(installDir, '.amplitude', 'events.json')),
    ).toBe(true);
    expect(fs.existsSync(getProjectBindingFile(installDir))).toBe(true);
  });

  it('clears credential ONLY when binding file is genuinely absent on disk', () => {
    // Companion to the test above: when the binding file is genuinely
    // gone (real `git reset`), the cred-clear path executes. This pins
    // the symmetric half of the disk-presence-dominates invariant so a
    // future refactor can't quietly turn the gate into a no-op.
    persistApiKey('orphan-key', installDir);
    expect(fs.existsSync(getProjectBindingFile(installDir))).toBe(false);

    const result = selfHealStaleProjectState(installDir);

    expect(result.healed).toBe(true);
    expect(result.reason).toContain('orphan credential');
    expect(readApiKey(installDir)).toBeNull();
  });

  // ── "Start fresh" signal: wipe stale checkpoint when user nukes .amplitude/ ──
  // Regression case for the Excalidraw run where deleting `<installDir>/.amplitude/`
  // still auto-picked the prior org/project on next launch because the per-user
  // checkpoint at `~/.amplitude/wizard/runs/<hash>/checkpoint.json` survived.
  describe('"start fresh" signal — .amplitude/ wiped + checkpoint pointing at prior project', () => {
    it('wipes the checkpoint when .amplitude/ is missing and checkpoint has a selectedProjectId', () => {
      // No `.amplitude/` dir at all, but a checkpoint records a prior selection.
      saveCheckpoint(STUB_SESSION(installDir), 'test');
      expect(fs.existsSync(getCheckpointFile(installDir))).toBe(true);

      const result = selfHealStaleProjectState(installDir);

      expect(result.healed).toBe(true);
      expect(result.reason).toContain('start fresh');
      expect(fs.existsSync(getCheckpointFile(installDir))).toBe(false);
      expect(result.artifactsRemoved).toEqual(
        expect.arrayContaining([getCheckpointFile(installDir)]),
      );
    });

    it('no-ops on a fresh project with no checkpoint at all', () => {
      // Truly cold start — no `.amplitude/`, no checkpoint, no API key.
      const result = selfHealStaleProjectState(installDir);

      expect(result.healed).toBe(false);
      expect(result.artifactsRemoved).toEqual([]);
    });

    it('no-ops when .amplitude/ is missing but the checkpoint is empty / default', () => {
      // Don't churn benign state. Manually write a checkpoint that has no
      // selected project / org, no detection, intro not concluded — the
      // shape `saveCheckpoint` would produce on a brand-new run that
      // saved before the user picked anything.
      const cp = {
        savedAt: new Date().toISOString(),
        installDir,
        region: null,
        selectedOrgId: null,
        selectedOrgName: null,
        selectedProjectId: null,
        selectedProjectName: null,
        selectedEnvName: null,
        integration: null,
        detectedFrameworkLabel: null,
        detectionComplete: false,
        frameworkContext: {},
        frameworkContextAnswerOrder: [],
        introConcluded: false,
      };
      fs.mkdirSync(path.dirname(getCheckpointFile(installDir)), {
        recursive: true,
      });
      fs.writeFileSync(getCheckpointFile(installDir), JSON.stringify(cp));

      const result = selfHealStaleProjectState(installDir);

      expect(result.healed).toBe(false);
      // The empty checkpoint is preserved.
      expect(fs.existsSync(getCheckpointFile(installDir))).toBe(true);
    });

    it('does NOT wipe the checkpoint when .amplitude/ exists (state is consistent)', () => {
      // User did NOT wipe `.amplitude/` — leave the checkpoint alone. This
      // is the resume path that PR #615 is specifically protecting.
      fs.mkdirSync(path.join(installDir, '.amplitude'), { recursive: true });
      fs.writeFileSync(
        path.join(installDir, '.amplitude', 'events.json'),
        '[]',
      );
      saveCheckpoint(STUB_SESSION(installDir), 'test');
      expect(fs.existsSync(getCheckpointFile(installDir))).toBe(true);

      const result = selfHealStaleProjectState(installDir);

      // Whatever else self-heal decides, the checkpoint stays put.
      expect(fs.existsSync(getCheckpointFile(installDir))).toBe(true);
      // Some prior tests' invariants — events.json must also survive.
      expect(
        fs.existsSync(path.join(installDir, '.amplitude', 'events.json')),
      ).toBe(true);
      // The reason should NOT be the "start fresh" wipe path.
      expect(result.reason).not.toContain('start fresh');
    });

    it('clears checkpoint AND credential when .amplitude/ wiped and a stale API key exists', () => {
      // Both the checkpoint signal AND the orphan-credential signal fire.
      // Heal both — credentials.json entry + checkpoint go away.
      saveCheckpoint(STUB_SESSION(installDir), 'test');
      persistApiKey('stale-api-key', installDir);

      const result = selfHealStaleProjectState(installDir);

      expect(result.healed).toBe(true);
      expect(readApiKey(installDir)).toBeNull();
      expect(fs.existsSync(getCheckpointFile(installDir))).toBe(false);
      expect(
        result.artifactsRemoved.some((p) => p.includes('checkpoint.json')),
      ).toBe(true);
      expect(
        result.artifactsRemoved.some((p) =>
          p.includes('credentials.json[this install dir]'),
        ),
      ).toBe(true);
    });
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
