/**
 * Remote skill menu fetch + zip download (context-hub / GitHub Releases).
 * Split from `wizard-tools.ts` for maintainability (Phase E).
 */
import path from 'path';
import fs from 'fs';
import os from 'os';
import AdmZip from 'adm-zip';

import { logToFile } from '../../utils/debug.js';

// Allow-listed hosts for remote skill downloads. The wizard ships skills
// from amplitude/context-hub via GitHub Releases; nothing else should ever
// be a download source. Any host not on this list — including raw IPs and
// HTTP URLs — is rejected before we touch the filesystem.
const ALLOWED_SKILL_HOSTS = new Set<string>([
  'github.com',
  'objects.githubusercontent.com',
  'codeload.github.com',
]);

export function isAllowedSkillUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_SKILL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Skill types
// ---------------------------------------------------------------------------

export type SkillEntry = { id: string; name: string; downloadUrl: string };

export interface SkillMenu {
  categories: Record<string, SkillEntry[]>;
}

// ---------------------------------------------------------------------------
// Remote skill helpers — for future use with amplitude/context-hub releases.
// Currently unused; skills are bundled locally. Enable by setting SKILLS_URL
// env var (e.g. https://github.com/amplitude/context-hub/releases/latest/download).
// ---------------------------------------------------------------------------

/**
 * Bound on the remote skill-menu fetch. The wizard waits on this call before
 * the agent can run, so an unbounded fetch on a stuck CDN connection would
 * stall the entire setup. 15s comfortably covers a worst-case GitHub Releases
 * fetch but ensures we fall back to bundled skills instead of hanging.
 */
const SKILL_MENU_FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch the skill menu from a remote skills server (GitHub Releases).
 * Returns parsed data on success, `null` on failure (including timeout —
 * the caller falls back to bundled skills, so silently swallowing a slow
 * network is the correct behavior).
 */
export async function fetchSkillMenu(
  skillsBaseUrl: string,
): Promise<SkillMenu | null> {
  const menuUrl = `${skillsBaseUrl}/skill-menu.json`;
  logToFile(`fetchSkillMenu: fetching from ${menuUrl}`);

  // Bound the request with an AbortController so a hung CDN connection
  // doesn't stall agent startup. Timer is always cleared in `finally`.
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    SKILL_MENU_FETCH_TIMEOUT_MS,
  );
  try {
    const resp = await fetch(menuUrl, { signal: controller.signal });
    if (resp.ok) {
      const data = (await resp.json()) as SkillMenu;
      logToFile(
        `fetchSkillMenu: loaded (${
          Object.keys(data.categories).length
        } categories)`,
      );
      return data;
    }
    logToFile(`fetchSkillMenu: failed with HTTP ${resp.status}`);
    return null;
  } catch (err) {
    const isAbort =
      err instanceof Error &&
      (err.name === 'AbortError' ||
        (err as Error & { code?: string }).code === 'ABORT_ERR');
    logToFile(
      isAbort
        ? `fetchSkillMenu: timed out after ${SKILL_MENU_FETCH_TIMEOUT_MS}ms`
        : `fetchSkillMenu: error: ${
            err instanceof Error ? err.message : String(err)
          }`,
    );
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Download and extract a skill from a remote URL.
 * Installs to `<installDir>/.claude/skills/<id>/`.
 *
 * Hardened against three classes of local-attacker exploit:
 *
 * 1. **Symlink race** — the previous version wrote to a hardcoded path
 *    `/tmp/amplitude-skill-<id>.zip`. A local user could pre-create that
 *    path as a symlink to e.g. `~/.ampli.json`, and `curl -o` would follow
 *    the link and overwrite the OAuth tokens. We now use `mkdtempSync` to
 *    get a unique, mode-0700, unguessable temp directory.
 * 2. **Untrusted host** — the previous version downloaded from any URL the
 *    skill manifest contained. Skills are only ever published by
 *    amplitude/context-hub via GitHub Releases, so we allowlist the
 *    GitHub-owned hosts and reject anything else.
 * 3. **Zip-slip** — naive zip extractors will follow `../../../etc/passwd`
 *    entries straight out of the target dir. We extract into the scratch
 *    tmp dir first, then walk the result and reject any entry whose
 *    resolved real path escapes the scratch root.
 *
 * Cross-platform note: extraction goes through `adm-zip` rather than the
 * `unzip` CLI so this works on Windows (which has no `unzip` by default).
 * `adm-zip`'s API is sync, matching the rest of this function.
 */
export function downloadSkill(
  skillEntry: SkillEntry,
  installDir: string,
): { success: boolean; error?: string } {
  const { execFileSync } =
    require('child_process') as typeof import('child_process');
  const skillDir = path.join(installDir, '.claude', 'skills', skillEntry.id);

  if (!isAllowedSkillUrl(skillEntry.downloadUrl)) {
    const msg = `downloadSkill: refused untrusted URL: ${skillEntry.downloadUrl}`;
    logToFile(msg);
    return {
      success: false,
      error: 'Skill download URL is not from an allowed host',
    };
  }

  // Unique unguessable scratch dir (mode 0700) — defeats /tmp symlink races.
  // (Uses os.tmpdir() so this works on Windows too — PR 333.)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amplitude-skill-'));
  const tmpFile = path.join(tmpDir, 'skill.zip');
  const extractDir = path.join(tmpDir, 'extract');

  try {
    fs.mkdirSync(extractDir, { recursive: true });

    execFileSync('curl', [
      '-sSfL', // -f: fail on HTTP errors; -S: show errors; -L: follow redirects
      '--proto',
      '=https',
      '--max-time',
      '30',
      skillEntry.downloadUrl,
      '-o',
      tmpFile,
    ]);

    // Extract into the scratch dir, NOT directly into the target. This way
    // any zip-slip entry lands somewhere inside `extractDir` (or fails the
    // realpath check below), never inside the user's project.
    //
    // We use `adm-zip` instead of shelling out to the `unzip` CLI because
    // Windows has no `unzip` binary by default, and the previous shell-out
    // ENOENT'd for every Windows user. `adm-zip` is pure JS, sync, and
    // does its own internal zip-slip filtering — but the realpath walker
    // below remains as defense-in-depth (different code, different bugs).
    const zip = new AdmZip(tmpFile);
    // `maintainEntryPath = true` preserves directory structure;
    // `overwrite = true` matches the previous `unzip -o` semantics.
    zip.extractAllTo(extractDir, /* overwrite */ true);

    // Defense-in-depth zip-slip check: walk every extracted entry and make
    // sure its real path stays inside extractDir. `unzip` is supposed to
    // refuse `../` paths since 6.0, but we don't trust that — version skew
    // and symlink entries (which `unzip` happily creates by default) make
    // it cheap to verify.
    const extractRealRoot = fs.realpathSync(extractDir);
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        // Use lstat so we catch symlinks pointing outside without following
        // them.
        const stat = fs.lstatSync(full);
        if (stat.isSymbolicLink()) {
          // Resolve the link target relative to the link's own directory.
          const resolved = path.resolve(dir, fs.readlinkSync(full));
          if (
            resolved !== extractRealRoot &&
            !resolved.startsWith(extractRealRoot + path.sep)
          ) {
            throw new Error(
              `Zip-slip detected: symlink ${full} -> ${resolved} escapes ${extractRealRoot}`,
            );
          }
        } else {
          const real = fs.realpathSync(full);
          if (
            real !== extractRealRoot &&
            !real.startsWith(extractRealRoot + path.sep)
          ) {
            throw new Error(
              `Zip-slip detected: ${full} resolves to ${real}, outside ${extractRealRoot}`,
            );
          }
          if (entry.isDirectory()) walk(full);
        }
      }
    };
    walk(extractDir);

    // Move into the final location only after we've validated the contents.
    fs.mkdirSync(skillDir, { recursive: true });
    for (const entry of fs.readdirSync(extractDir)) {
      const src = path.join(extractDir, entry);
      const dest = path.join(skillDir, entry);
      // Remove any pre-existing file at dest so renameSync succeeds across
      // file types (matches old `unzip -o` overwrite semantics).
      try {
        fs.rmSync(dest, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      fs.renameSync(src, dest);
    }

    logToFile(
      `downloadSkill: installed ${skillEntry.id} from ${skillEntry.downloadUrl}`,
    );
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(`downloadSkill: error: ${msg}`);
    return { success: false, error: msg };
  } finally {
    // Always clean up the scratch directory — never leave half-extracted
    // attacker-controlled bytes lying around in /tmp.
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }
}
