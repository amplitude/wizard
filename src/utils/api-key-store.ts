/**
 * api-key-store — Persist and retrieve the Amplitude project API key.
 *
 * Storage strategy (tried in order):
 *   1. Per-user cache file — `~/.amplitude/wizard/credentials.json`
 *      (see `credentials-file.ts` for the full why; mode `0o600`,
 *      keyed by hashed install dir, no OS keychain prompts).
 *   2. `.env.local` fallback — written to the project root and added
 *      to the project's `.gitignore` automatically. Used when (and
 *      only when) the per-user cache write fails (read-only home dir,
 *      EACCES on the cache root, etc.).
 *
 * Migration note for existing users: the previous implementation stored
 * keys in the macOS Keychain / Linux libsecret. Old entries are left in
 * place untouched (deleting them might re-prompt the user, the very
 * thing this refactor exists to eliminate). On the next launch the
 * standard credential resolution flow re-fetches the key from the
 * authenticated Amplitude API and writes it to the new cache file.
 * Net effect: a single silent "first launch after upgrade" with no
 * user-visible action required, and zero keychain prompts ever again.
 *
 * Why not the keychain? See the header of `credentials-file.ts` — short
 * version: the project API key is a public ingestion key shipped in
 * every client SDK bundle, so file-on-disk at `0o600` matches its true
 * sensitivity (same precedent as the OAuth tokens already living in
 * `~/.ampli.json`).
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { logToFile } from './debug.js';
import {
  readCredential,
  writeCredential,
  clearCredential,
} from './credentials-file.js';

// `.env.local` holds the project's Amplitude API key, which is treated as
// a secret. We constrain it to 0o600 (owner read/write only) on every
// write to defend against:
//   - Pre-existing files created at 0o644 by earlier wizard runs / other
//     tooling. `writeFileSync({ mode })` only applies on file CREATION,
//     so we always follow up with chmodSync.
//   - `appendFileSync({ mode })` ditto — only applies on creation.
//
// Windows note: `chmodSync` only honours the read-only bit on win32; mode
// `0o600` collapses to "writable" there. The risk on Windows is mitigated
// by the per-user profile directory's ACLs rather than POSIX modes.
const ENV_FILE_MODE = 0o600;

/** Tighten a file to {@link ENV_FILE_MODE} on POSIX. No-op on win32. */
function tightenEnvMode(envPath: string): void {
  try {
    chmodSync(envPath, ENV_FILE_MODE);
  } catch {
    // chmod can legitimately fail on Windows or weird filesystems — never
    // let a permissions tweak break the wizard.
  }
}

const ENV_KEY_NAME = 'AMPLITUDE_API_KEY';

// ── Test-only helpers ─────────────────────────────────────────────────
//
// These were used by the old keychain implementation to fake out binary
// discovery and headless-Linux detection. The current implementation
// has neither concept, so the helpers are kept as no-ops to avoid
// breaking unit tests that import them. Drop after one release once
// every test file has been updated.

/** @deprecated No-op since the keychain backend was removed. */
export function __setBinaryAvailableForTests(
  _name: string,
  _available: boolean | undefined,
): void {
  // Intentionally empty — preserved for test back-compat only.
}

/** @deprecated No-op since the keychain backend was removed. */
export function __resetHeadlessCacheForTests(): void {
  // Intentionally empty — preserved for test back-compat only.
}

// ── .env.local fallback ───────────────────────────────────────────────────────

function envRead(installDir: string): string | null {
  const envPath = join(installDir, '.env.local');
  if (!existsSync(envPath)) return null;
  const contents = readFileSync(envPath, 'utf8');
  const match = contents.match(/^AMPLITUDE_API_KEY=(.+)$/m);
  if (!match) return null;
  // Strip surrounding single/double quotes — dotenv-style files commonly
  // wrap values in quotes (`AMPLITUDE_API_KEY="abc"`), and submitting the
  // literal-quoted string to the API is rejected. Match dotenv's behavior.
  return match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
}

function envWrite(installDir: string, key: string): void {
  const envPath = join(installDir, '.env.local');

  if (existsSync(envPath)) {
    const contents = readFileSync(envPath, 'utf8');
    if (contents.includes(`${ENV_KEY_NAME}=`)) {
      // Replace existing entry. `mode` here only matters on the first
      // write; existing files keep their pre-existing mode unless we
      // chmod afterwards (which we do, below).
      writeFileSync(
        envPath,
        contents.replace(/^AMPLITUDE_API_KEY=.*$/m, `${ENV_KEY_NAME}=${key}`),
        { encoding: 'utf8', mode: ENV_FILE_MODE },
      );
    } else {
      appendFileSync(envPath, `\n${ENV_KEY_NAME}=${key}\n`, {
        encoding: 'utf8',
        mode: ENV_FILE_MODE,
      });
    }
  } else {
    writeFileSync(envPath, `${ENV_KEY_NAME}=${key}\n`, {
      encoding: 'utf8',
      mode: ENV_FILE_MODE,
    });
  }

  // Always re-assert 0o600 — see ENV_FILE_MODE comment for why this is
  // needed on POSIX even when we already passed `mode` to the writers.
  tightenEnvMode(envPath);

  // Ensure .gitignore covers .env.local
  ensureGitignored(installDir, '.env.local');
}

function envClear(installDir: string): void {
  const envPath = join(installDir, '.env.local');
  if (!existsSync(envPath)) return;
  const contents = readFileSync(envPath, 'utf8');
  if (!contents.includes(`${ENV_KEY_NAME}=`)) return;
  // Strip the key from .env.local without deleting the file — users may
  // have other env vars there.
  const stripped = contents
    .replace(new RegExp(`^${ENV_KEY_NAME}=.*\\r?\\n?`, 'm'), '')
    .replace(/\n{3,}/g, '\n\n');
  writeFileSync(envPath, stripped, { encoding: 'utf8', mode: ENV_FILE_MODE });
  tightenEnvMode(envPath);
}

function ensureGitignored(installDir: string, pattern: string): void {
  const gitignorePath = join(installDir, '.gitignore');
  if (existsSync(gitignorePath)) {
    const contents = readFileSync(gitignorePath, 'utf8');
    if (contents.includes(pattern)) return;
    appendFileSync(gitignorePath, `\n# Amplitude wizard\n${pattern}\n`, 'utf8');
  } else {
    writeFileSync(gitignorePath, `# Amplitude wizard\n${pattern}\n`, 'utf8');
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Source of a stored API key.
 *
 *   - `cache` — per-user `~/.amplitude/wizard/credentials.json`. The
 *     normal storage location; silent and shared across CLI invocations
 *     from the same install dir.
 *   - `env`   — project-local `.env.local`. Used only when the per-user
 *     cache write failed (read-only home, etc.) or when a previous
 *     wizard version persisted there.
 *
 * (Renamed from the legacy `'keychain'` value, which was a misnomer —
 * the wizard never actually stored anything in any OS keychain after
 * this refactor. Telemetry dashboards filtering on `'keychain'` should
 * be updated to `'cache'`.)
 */
export type ApiKeySource = 'cache' | 'env';

/**
 * Persist the Amplitude project API key for this project directory.
 * Tries the per-user cache file first, falls back to `.env.local`.
 */
export function persistApiKey(key: string, installDir: string): ApiKeySource {
  try {
    writeCredential(installDir, key);
    return 'cache';
  } catch (err) {
    // Most likely cause: read-only $HOME or EACCES on `~/.amplitude/`.
    // Fall back to project-local `.env.local` so the wizard still works
    // on locked-down hosts (CI runners, ephemeral containers, etc.).
    logToFile(
      `[api-key-store] cache write failed, falling back to .env.local: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    envWrite(installDir, key);
    return 'env';
  }
}

/**
 * Remove the stored API key for this project directory from BOTH the
 * per-user cache AND `.env.local`. Has no effect if no key is stored.
 *
 * Cleared from every backend because `readApiKeyWithSource` falls
 * through them in order — leaving one populated would silently re-use
 * the previous login's key on the next run.
 *
 * NOTE: Old keychain / secret-tool entries from the pre-refactor
 * implementation are intentionally NOT cleared here. Calling
 * `security delete-generic-password` may still trigger a Keychain
 * Services unlock prompt on macOS, which defeats the whole point of
 * removing the keychain backend. Orphaned entries are harmless (nothing
 * reads them anymore) and users can clean them up via Keychain Access
 * if they want. Drop after one release.
 */
export function clearApiKey(installDir: string): void {
  clearCredential(installDir);
  envClear(installDir);
}

/**
 * Read a previously persisted API key for this project directory.
 * Returns null if not found in any storage.
 */
export function readApiKey(installDir: string): string | null {
  return readApiKeyWithSource(installDir)?.key ?? null;
}

/**
 * Read a previously persisted API key, also returning which storage was used.
 * Returns null if not found in any storage.
 */
export function readApiKeyWithSource(
  installDir: string,
): { key: string; source: ApiKeySource } | null {
  const cacheKey = readCredential(installDir);
  if (cacheKey) return { key: cacheKey, source: 'cache' };

  // .env.local in the project directory (project-scoped, safe)
  const envKey = envRead(installDir);
  if (envKey) return { key: envKey, source: 'env' };

  // NOTE: We intentionally do NOT fall back to process.env.AMPLITUDE_API_KEY.
  // A shell-level env var would leak across projects — if a user sets it in
  // their .bashrc, every project on the machine would silently use it.
  // Users should use .env.local (project-scoped) or --api-key (explicit).

  return null;
}
