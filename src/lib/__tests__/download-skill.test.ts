/**
 * Regression tests for downloadSkill hardening:
 *   - URL allowlist (only github.com / githubusercontent.com / codeload.github.com over HTTPS)
 *   - Unguessable scratch tmpdir (no /tmp symlink races)
 *   - Cleanup on every code path
 *
 * Note: zip-slip extraction itself is exercised in integration tests; here
 * we focus on the surface-level invariants that don't require a real `curl`
 * + `unzip` round-trip in CI. The host-allowlist check fires BEFORE we
 * touch curl, so we can verify it without a network.
 */

import { describe, it, expect } from 'vitest';
import { downloadSkill, isAllowedSkillUrl } from '../wizard-tools';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('isAllowedSkillUrl', () => {
  it('accepts github.com over HTTPS', () => {
    expect(
      isAllowedSkillUrl(
        'https://github.com/amplitude/context-hub/releases/latest/download/skill.zip',
      ),
    ).toBe(true);
  });

  it('accepts objects.githubusercontent.com (GitHub release CDN)', () => {
    expect(
      isAllowedSkillUrl('https://objects.githubusercontent.com/foo/bar.zip'),
    ).toBe(true);
  });

  it('rejects http:// (must be HTTPS)', () => {
    expect(
      isAllowedSkillUrl('http://github.com/amplitude/context-hub/skill.zip'),
    ).toBe(false);
  });

  it('rejects file:// scheme', () => {
    expect(isAllowedSkillUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects evil hosts that just look like github', () => {
    expect(isAllowedSkillUrl('https://github.com.evil.example/skill.zip')).toBe(
      false,
    );
    expect(isAllowedSkillUrl('https://evilgithub.com/skill.zip')).toBe(false);
    expect(isAllowedSkillUrl('https://raw.githubusercontent.com/x.zip')).toBe(
      false,
    );
  });

  it('rejects garbage', () => {
    expect(isAllowedSkillUrl('not a url')).toBe(false);
    expect(isAllowedSkillUrl('')).toBe(false);
  });
});

describe('downloadSkill — host allowlist', () => {
  it('refuses an HTTP URL without touching the filesystem', () => {
    const installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'download-skill-test-'),
    );
    try {
      const result = downloadSkill(
        {
          id: 'malicious',
          name: 'Malicious Skill',
          downloadUrl: 'http://attacker.example/skill.zip',
        },
        installDir,
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not from an allowed host/);

      // Crucially: no .claude/skills/malicious/ directory was created.
      // (Pre-fix, downloadSkill would mkdir + curl before bailing.)
      expect(
        fs.existsSync(path.join(installDir, '.claude', 'skills', 'malicious')),
      ).toBe(false);
    } finally {
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  });

  it('refuses an arbitrary host', () => {
    const installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'download-skill-test-'),
    );
    try {
      const result = downloadSkill(
        {
          id: 'somewhere',
          name: 'Somewhere',
          downloadUrl: 'https://attacker.example/skill.zip',
        },
        installDir,
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not from an allowed host/);
    } finally {
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  });
});
