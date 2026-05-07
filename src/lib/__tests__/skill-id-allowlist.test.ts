/**
 * Focused unit tests for `isSafeSkillId` — the basename-safety gate used
 * everywhere a skill id flows into a `path.join` against the bundled
 * skills root.
 *
 * Originally the regex was `/^[a-z0-9][a-z0-9_-]*$/`, which rejected
 * version-suffix style ids like `integration-nuxt-3.6`. The bundled
 * skill folder existed and `loadBundledSkillMenu` happily surfaced it
 * to the agent, but `bundledSkillExists` / `readBundledSkillBody`
 * rejected the id, causing a runtime failure when the agent tried to
 * load the skill via the `load_skill` MCP tool. The fix relaxes the
 * character class to allow dots and adds an explicit path-traversal
 * guard so dots can't be abused to escape the skills root.
 */
import { describe, it, expect } from 'vitest';
import {
  isSafeSkillId,
  bundledSkillExists,
  readBundledSkillBody,
  loadBundledSkillMenu,
} from '../wizard-tools/bundled-skills';

describe('isSafeSkillId', () => {
  describe('accepts legitimate ids', () => {
    it.each([
      'integration-nuxt-3.6',
      'integration-nuxt-4',
      'integration-nextjs-app-router',
      'integration-react-react-router-7-framework',
      'integration-javascript_web',
      'amplitude-quickstart-taxonomy-agent',
      'a',
      'a1',
      '1abc',
      'skill-1.0.0',
    ])('accepts %s', (id) => {
      expect(isSafeSkillId(id)).toBe(true);
    });
  });

  describe('rejects path traversal attempts', () => {
    it.each([
      '../etc/passwd',
      '..',
      '../foo',
      'skill/../other',
      'skill\\..\\other',
      '/absolute/path',
      'a/b',
      'a\\b',
      'foo..bar',
      'a..b',
    ])('rejects %s', (id) => {
      expect(isSafeSkillId(id)).toBe(false);
    });
  });

  describe('rejects malformed ids', () => {
    it.each([
      // leading dot or dash — first char-class disallows
      '.skill',
      '-skill',
      '.hidden',
      // trailing dot or dash — explicit guard
      'skill.',
      'skill-',
      'skill.foo.',
      // uppercase — character class is lowercase only
      'Skill',
      'SKILL',
      'integration-Foo',
      // empty / whitespace
      '',
      ' ',
      'foo bar',
      'foo\tbar',
      // null bytes / control chars
      'foo\x00bar',
      // other shell-significant characters
      'foo;rm',
      'foo$bar',
      'foo*bar',
      'foo?bar',
    ])('rejects %s', (id) => {
      expect(isSafeSkillId(id)).toBe(false);
    });

    it('rejects non-string input', () => {
      // Defense in depth: callers should always pass strings, but the
      // helper must not throw on bad input.
      expect(isSafeSkillId(null as unknown as string)).toBe(false);
      expect(isSafeSkillId(undefined as unknown as string)).toBe(false);
      expect(isSafeSkillId(123 as unknown as string)).toBe(false);
    });
  });

  describe('round-trip with bundled skills', () => {
    // The original bug: `integration-nuxt-3.6` is on disk in skills/integration/
    // but the old regex rejected it, so load_skill returned null. Lock the
    // contract: the dotted id passes the gate AND resolves on disk.
    it('integration-nuxt-3.6 is accepted by the gate', () => {
      expect(isSafeSkillId('integration-nuxt-3.6')).toBe(true);
    });

    it('integration-nuxt-3.6 resolves to a real bundled skill', () => {
      // bundledSkillExists / readBundledSkillBody are the two callers
      // that gated the regex — both must now succeed.
      expect(bundledSkillExists('integration-nuxt-3.6')).toBe(true);
      const body = readBundledSkillBody('integration-nuxt-3.6');
      expect(body).toBeTruthy();
      expect(typeof body).toBe('string');
      expect((body as string).length).toBeGreaterThan(0);
    });

    /**
     * Drift detector: every id surfaced by `loadBundledSkillMenu` MUST
     * pass `isSafeSkillId` and resolve via `readBundledSkillBody`.
     *
     * Before this fix, `integration-nuxt-3.6` showed up here as a single
     * known mismatch (the menu lists it but the regex rejected it). The
     * fix relaxes the regex to accept dots, so the count must now stay
     * at zero. If a future bundle adds an id with another rejected
     * character (uppercase, whitespace, etc.) this test fails loudly so
     * we either rename the skill folder or extend the allowlist
     * deliberately — never silently lose an id.
     */
    it('every menu-listed bundled skill id round-trips through isSafeSkillId + readBundledSkillBody (stays at zero mismatches)', () => {
      const menu = loadBundledSkillMenu();
      const mismatches: string[] = [];
      let checked = 0;
      for (const entries of Object.values(menu.categories)) {
        for (const entry of entries) {
          if (!isSafeSkillId(entry.id) || !readBundledSkillBody(entry.id)) {
            mismatches.push(entry.id);
            continue;
          }
          checked++;
        }
      }

      // Sanity guard: if a regex tightening ever wiped out the menu we
      // want this to fail rather than silently degrade to a no-op.
      expect(checked).toBeGreaterThan(5);
      expect(mismatches).toEqual([]);
    });
  });
});
