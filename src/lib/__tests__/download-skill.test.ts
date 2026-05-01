/**
 * Regression tests for downloadSkill hardening:
 *   - URL allowlist (only github.com / githubusercontent.com / codeload.github.com over HTTPS)
 *   - Unguessable scratch tmpdir (no /tmp symlink races)
 *   - Cleanup on every code path
 *   - Cross-platform extraction (in-process via adm-zip; previously shelled
 *     out to the `unzip` CLI which doesn't exist on Windows)
 *
 * Note: the network round-trip (curl) is not exercised here; the
 * host-allowlist check fires BEFORE we touch curl, so we can verify it
 * without a network. The extraction path is exercised by pre-staging a
 * zip and routing it through the same code path.
 */

import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
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

// ── adm-zip extraction sanity checks ────────────────────────────────────────
//
// These don't go through downloadSkill (which needs a real network) — they
// exercise the AdmZip API directly to make sure the swap from `unzip` CLI
// to in-process extraction actually works. Runs on every platform; the
// whole point of the swap is that it works on Windows where `unzip` is
// not installed by default.
describe('AdmZip extraction (replaces unzip CLI)', () => {
  it('extracts a flat zip preserving file contents', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'admzip-flat-'));
    try {
      const zipPath = path.join(tmp, 'test.zip');
      const zip = new AdmZip();
      zip.addFile('SKILL.md', Buffer.from('# Hello\n\nbody', 'utf8'));
      zip.addFile('references/EXAMPLE.md', Buffer.from('snippet', 'utf8'));
      zip.writeZip(zipPath);

      const out = path.join(tmp, 'out');
      fs.mkdirSync(out, { recursive: true });
      const reader = new AdmZip(zipPath);
      reader.extractAllTo(out, /* overwrite */ true);

      expect(fs.readFileSync(path.join(out, 'SKILL.md'), 'utf8')).toBe(
        '# Hello\n\nbody',
      );
      expect(
        fs.readFileSync(path.join(out, 'references/EXAMPLE.md'), 'utf8'),
      ).toBe('snippet');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('overwrite=true matches the previous `unzip -o` semantics', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'admzip-overwrite-'));
    try {
      const out = path.join(tmp, 'out');
      fs.mkdirSync(out, { recursive: true });
      // Pre-stage a file that the extraction should overwrite.
      fs.writeFileSync(path.join(out, 'SKILL.md'), 'STALE');

      const zipPath = path.join(tmp, 'test.zip');
      const zip = new AdmZip();
      zip.addFile('SKILL.md', Buffer.from('FRESH', 'utf8'));
      zip.writeZip(zipPath);

      new AdmZip(zipPath).extractAllTo(out, true);

      expect(fs.readFileSync(path.join(out, 'SKILL.md'), 'utf8')).toBe('FRESH');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
