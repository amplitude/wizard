/**
 * credentials-file — Per-user JSON store for Amplitude project API keys.
 *
 * Lives at `~/.amplitude/wizard/credentials.json` (override the cache root
 * via `AMPLITUDE_WIZARD_CACHE_DIR`). Mode `0o600`. Keyed by a stable hash
 * of the project's install directory so multiple projects on one machine
 * stay isolated.
 *
 * ── Why not the OS keychain? ───────────────────────────────────────────
 * The previous implementation used `security` (macOS) and `secret-tool`
 * (Linux). It was written with `-T ''` (empty trusted-application list),
 * intending to suppress prompts. In practice an empty ACL means "no app
 * is on the allow-list," so every read triggered a "wizard wants to use
 * your keychain" dialog. Users are prompted on EVERY launch because
 * `credential-resolution.ts` reads the API key during startup.
 *
 * The Amplitude project API key is not a confidential credential — it
 * is a public ingestion key embedded in every Amplitude-instrumented
 * client SDK bundle (web JS, mobile binaries). The OAuth tokens already
 * sit in `~/.ampli.json` as a plain `0o600` file, and they are strictly
 * more sensitive than this. So a per-user file at `0o600` is the right
 * sensitivity match and aligns with how `gh`, `aws`, `vercel`, `doppler`,
 * `supabase` store their secrets.
 *
 * ── Schema ─────────────────────────────────────────────────────────────
 * {
 *   "version": 1,
 *   "projects": {
 *     "<sha256(installDir).slice(0,12)>": {
 *       "apiKey": "<amplitude api key>",
 *       "updatedAt": "<ISO 8601 timestamp>"
 *     }
 *   }
 * }
 *
 * Forward-compat: unknown top-level keys and unknown keys inside a project
 * entry are preserved on write so a future wizard version can add fields
 * without older versions stomping them.
 */

import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { atomicWriteJSON } from './atomic-write.js';
import {
  getCredentialsFile,
  getCacheRoot,
  ensureDir,
  projectHash,
} from './storage-paths.js';
import { logToFile } from './debug.js';

/** Mode for the credentials file. Owner read/write only. */
const CREDENTIALS_FILE_MODE = 0o600;

/** Current schema version. Bump on breaking changes. */
const SCHEMA_VERSION = 1;

/**
 * Permissive schema: validates the shape we care about while letting
 * unrecognized keys pass through (`.passthrough()`). That way a newer
 * wizard can add fields without an older wizard erroring on load.
 */
const ProjectEntrySchema = z
  .object({
    apiKey: z.string(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

const CredentialsFileSchema = z
  .object({
    version: z.number().int().positive().optional(),
    projects: z.record(z.string(), ProjectEntrySchema).optional(),
  })
  .passthrough();

type CredentialsFile = z.infer<typeof CredentialsFileSchema>;

/**
 * Read and parse the credentials file. Returns an empty shell on miss
 * or corruption — never throws, because a corrupt credentials file
 * should never break the wizard's startup path. A corrupt file gets
 * overwritten on the next `writeCredential` call.
 */
function readFile(): CredentialsFile {
  const path = getCredentialsFile();
  if (!existsSync(path)) {
    return { version: SCHEMA_VERSION, projects: {} };
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const result = CredentialsFileSchema.safeParse(parsed);
    if (!result.success) {
      logToFile(
        `[credentials-file] schema mismatch in ${path}, ignoring: ${result.error.message}`,
      );
      return { version: SCHEMA_VERSION, projects: {} };
    }
    return result.data;
  } catch (err) {
    // JSON parse errors, EACCES, etc. — treat as "no credentials yet"
    // and let the next write recreate cleanly.
    logToFile(
      `[credentials-file] failed to read ${path}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { version: SCHEMA_VERSION, projects: {} };
  }
}

/** Read the API key for an install directory. Returns null on miss. */
export function readCredential(installDir: string): string | null {
  const data = readFile();
  const entry = data.projects?.[projectHash(installDir)];
  if (!entry) return null;
  const trimmed = entry.apiKey.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Persist the API key for an install directory. Creates the cache root
 * directory if needed. Throws on write failure — callers should catch
 * and fall back to `.env.local`.
 */
export function writeCredential(installDir: string, apiKey: string): void {
  // Ensure the cache root exists; `ensureDir` is mode 0o700 so the file's
  // 0o600 isn't undermined by a world-readable parent dir.
  ensureDir(getCacheRoot());

  const data = readFile();
  const projects = { ...(data.projects ?? {}) };
  const hash = projectHash(installDir);
  const existing = projects[hash] ?? {};

  projects[hash] = {
    ...existing,
    apiKey,
    updatedAt: new Date().toISOString(),
  };

  const next: CredentialsFile = {
    ...data,
    version: data.version ?? SCHEMA_VERSION,
    projects,
  };

  atomicWriteJSON(getCredentialsFile(), next, { mode: CREDENTIALS_FILE_MODE });
}

/**
 * Remove the entry for an install directory. No-op if the file or entry
 * doesn't exist. Never throws — logout should always succeed even if
 * the credentials file is corrupted or unwritable.
 */
export function clearCredential(installDir: string): void {
  const path = getCredentialsFile();
  if (!existsSync(path)) return;

  const data = readFile();
  const hash = projectHash(installDir);
  if (!data.projects?.[hash]) return;

  const projects = { ...data.projects };
  delete projects[hash];

  const next: CredentialsFile = {
    ...data,
    version: data.version ?? SCHEMA_VERSION,
    projects,
  };

  try {
    atomicWriteJSON(path, next, { mode: CREDENTIALS_FILE_MODE });
  } catch (err) {
    logToFile(
      `[credentials-file] failed to clear ${path}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
