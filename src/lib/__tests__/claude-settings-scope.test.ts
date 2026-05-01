/**
 * Tests for claude-settings-scope.
 *
 * These pin down the user-facing invariants:
 *
 *   1. The user's checked-in `.claude/settings.json` is NEVER read or
 *      written by this module — only `.claude/settings.local.json`.
 *   2. If `.claude/settings.local.json` did not exist, `restore()` deletes
 *      what we wrote. If `.claude/` did not exist either, we leave it
 *      alone if the agent populated it (e.g. wrote skills) and remove it
 *      otherwise.
 *   3. If `.claude/settings.local.json` DID exist (with arbitrary user
 *      content), `restore()` puts it back to the original RAW bytes,
 *      preserving formatting / non-standard fields / comments-via-JSON5
 *      we didn't understand.
 *   4. When prior content already has an `env` block, the user's keys are
 *      preserved; we only overwrite the specific keys we manage.
 *   5. When there's no env to scope (gateway env vars unset), we no-op.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import path from 'path';
import { applyScopedSettings } from '../claude-settings-scope.js';

const SCOPED_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
] as const;

/** Snapshot + clear the scoped env, return a restore fn. */
function snapshotEnv(): () => void {
  const snap: Record<string, string | undefined> = {};
  for (const k of SCOPED_KEYS) {
    snap[k] = process.env[k];
    delete process.env[k];
  }
  return () => {
    for (const k of SCOPED_KEYS) {
      if (snap[k] === undefined) delete process.env[k];
      else process.env[k] = snap[k];
    }
  };
}

describe('applyScopedSettings', () => {
  let workdir: string;
  let restoreEnv: () => void;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-scope-test-'));
    restoreEnv = snapshotEnv();
  });

  afterEach(() => {
    restoreEnv();
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it('returns null when no gateway env is set', () => {
    expect(applyScopedSettings(workdir)).toBeNull();
    // No `.claude/` directory should be created in the no-op path.
    expect(fs.existsSync(path.join(workdir, '.claude'))).toBe(false);
  });

  it('writes settings.local.json with scoped env when env is set', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com';
    process.env.ANTHROPIC_AUTH_TOKEN = 'wizard-token';

    const handle = applyScopedSettings(workdir);
    expect(handle).not.toBeNull();
    expect(handle!.filePath).toBe(
      path.join(workdir, '.claude', 'settings.local.json'),
    );

    const written = JSON.parse(fs.readFileSync(handle!.filePath, 'utf-8'));
    expect(written.env.ANTHROPIC_BASE_URL).toBe('https://gateway.example.com');
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe('wizard-token');
  });

  it("NEVER touches the user's checked-in settings.json", () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com';

    // Plant a user-owned settings.json with their proxy config.
    const userSettings = path.join(workdir, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(userSettings), { recursive: true });
    const userContent = JSON.stringify(
      { env: { ANTHROPIC_BASE_URL: 'https://my-proxy.example.com' } },
      null,
      2,
    );
    fs.writeFileSync(userSettings, userContent);
    const userMtime = fs.statSync(userSettings).mtimeMs;

    const handle = applyScopedSettings(workdir);
    expect(handle).not.toBeNull();

    // Original user file is byte-identical AND its mtime hasn't budged.
    expect(fs.readFileSync(userSettings, 'utf-8')).toBe(userContent);
    expect(fs.statSync(userSettings).mtimeMs).toBe(userMtime);

    handle!.restore();
    // Still untouched after restore.
    expect(fs.readFileSync(userSettings, 'utf-8')).toBe(userContent);
  });

  it('restore() deletes the file we created when no prior file existed', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com';

    const handle = applyScopedSettings(workdir);
    expect(fs.existsSync(handle!.filePath)).toBe(true);

    handle!.restore();
    expect(fs.existsSync(handle!.filePath)).toBe(false);
  });

  it('restore() removes .claude/ if we created it and it is empty', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com';

    const handle = applyScopedSettings(workdir);
    handle!.restore();
    expect(fs.existsSync(path.join(workdir, '.claude'))).toBe(false);
  });

  it('restore() preserves .claude/ if the agent wrote skills into it', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com';

    const handle = applyScopedSettings(workdir);
    // Simulate the agent installing a skill mid-run.
    const skillDir = path.join(workdir, '.claude', 'skills', 'demo');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'demo skill');

    handle!.restore();

    expect(fs.existsSync(path.join(workdir, '.claude'))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(handle!.filePath)).toBe(false);
  });

  it('restore() rewrites prior file BYTES when it pre-existed', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com';

    // Pre-existing local file with idiosyncratic formatting + extra fields
    // we don't manage.
    const localPath = path.join(workdir, '.claude', 'settings.local.json');
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    const prior = `{\n  "env": {\n    "USER_VAR": "keep me"\n  },\n  "model": "sonnet"\n}\n`;
    fs.writeFileSync(localPath, prior);

    const handle = applyScopedSettings(workdir);

    // Mid-run: file should have our env merged with theirs.
    const merged = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
    expect(merged.env.USER_VAR).toBe('keep me');
    expect(merged.env.ANTHROPIC_BASE_URL).toBe('https://gateway.example.com');
    expect(merged.model).toBe('sonnet');

    handle!.restore();

    // Post-run: byte-identical to original.
    expect(fs.readFileSync(localPath, 'utf-8')).toBe(prior);
  });

  it('restore() is idempotent', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com';

    const handle = applyScopedSettings(workdir);
    handle!.restore();
    // Calling restore() a second time must not throw and must not revive
    // a deleted file.
    expect(() => handle!.restore()).not.toThrow();
    expect(fs.existsSync(handle!.filePath)).toBe(false);
  });

  it('only writes the keys we manage; ignores unrelated process.env', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com';
    // A noise key that should NOT make it into the local settings file.
    process.env.SOME_UNRELATED_VAR = 'nope';

    const handle = applyScopedSettings(workdir);
    const written = JSON.parse(fs.readFileSync(handle!.filePath, 'utf-8'));

    expect(Object.keys(written.env).sort()).toEqual(['ANTHROPIC_BASE_URL']);
    expect(written.env).not.toHaveProperty('SOME_UNRELATED_VAR');

    delete process.env.SOME_UNRELATED_VAR;
  });

  it('treats invalid JSON in the prior local file as empty for merging, but restores raw on exit', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com';

    const localPath = path.join(workdir, '.claude', 'settings.local.json');
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    const garbage = 'not valid json {{{';
    fs.writeFileSync(localPath, garbage);

    const handle = applyScopedSettings(workdir);

    // We overwrote the garbage with something parseable.
    const written = JSON.parse(fs.readFileSync(handle!.filePath, 'utf-8'));
    expect(written.env.ANTHROPIC_BASE_URL).toBe('https://gateway.example.com');

    handle!.restore();

    // Garbage is restored byte-for-byte. We don't try to "fix" the user's
    // file just because we couldn't parse it.
    expect(fs.readFileSync(localPath, 'utf-8')).toBe(garbage);
  });
});
