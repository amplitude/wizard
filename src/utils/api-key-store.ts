/**
 * api-key-store — Persist and retrieve the Amplitude project API key.
 *
 * Storage strategy (tried in order):
 *   1. macOS Keychain  — `security` CLI, no extra deps
 *   2. Linux keyring   — `secret-tool` CLI (gnome-keyring / KWallet)
 *   3. .env.local file — fallback; file is added to .gitignore automatically
 *
 * The key is scoped to the project directory so that different projects
 * can have different API keys on the same machine.
 */

import { execSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const KEYCHAIN_SERVICE = 'amplitude-wizard';
const ENV_KEY_NAME = 'AMPLITUDE_API_KEY';

/** A short stable identifier for the project directory (used as keychain account). */
function projectHandle(installDir: string): string {
  return createHash('sha1').update(installDir).digest('hex').slice(0, 12);
}

// ── macOS Keychain ────────────────────────────────────────────────────────────

function keychainRead(account: string): string | null {
  try {
    return execSync(
      `security find-generic-password -a "${account}" -s "${KEYCHAIN_SERVICE}" -w 2>/dev/null`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return null;
  }
}

function keychainWrite(account: string, key: string): boolean {
  try {
    execSync(
      `security add-generic-password -U -a "${account}" -s "${KEYCHAIN_SERVICE}" -w "${key}"`,
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

// ── Linux secret-tool ─────────────────────────────────────────────────────────

function secretToolRead(account: string): string | null {
  try {
    return execSync(
      `secret-tool lookup service "${KEYCHAIN_SERVICE}" account "${account}" 2>/dev/null`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return null;
  }
}

function secretToolWrite(account: string, key: string): boolean {
  try {
    // secret-tool requires stdin for the password
    execSync(
      `printf '%s' "${key}" | secret-tool store --label="Amplitude API Key" service "${KEYCHAIN_SERVICE}" account "${account}"`,
      { stdio: ['pipe', 'ignore', 'ignore'] },
    );
    return true;
  } catch {
    return false;
  }
}

// ── .env.local fallback ───────────────────────────────────────────────────────

function envRead(installDir: string): string | null {
  const envPath = join(installDir, '.env.local');
  if (!existsSync(envPath)) return null;
  const contents = readFileSync(envPath, 'utf8');
  const match = contents.match(/^AMPLITUDE_API_KEY=(.+)$/m);
  return match ? match[1].trim() : null;
}

function envWrite(installDir: string, key: string): void {
  const envPath = join(installDir, '.env.local');

  if (existsSync(envPath)) {
    const contents = readFileSync(envPath, 'utf8');
    if (contents.includes(`${ENV_KEY_NAME}=`)) {
      // Replace existing entry
      writeFileSync(
        envPath,
        contents.replace(/^AMPLITUDE_API_KEY=.*$/m, `${ENV_KEY_NAME}=${key}`),
        'utf8',
      );
    } else {
      appendFileSync(envPath, `\n${ENV_KEY_NAME}=${key}\n`, 'utf8');
    }
  } else {
    writeFileSync(envPath, `${ENV_KEY_NAME}=${key}\n`, 'utf8');
  }

  // Ensure .gitignore covers .env.local
  ensureGitignored(installDir, '.env.local');
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
 * Persist the Amplitude project API key for this project directory.
 * Tries keychain first, falls back to .env.local.
 * Returns which storage was used: 'keychain' | 'env'
 */
export function persistApiKey(
  key: string,
  installDir: string,
): 'keychain' | 'env' {
  const account = projectHandle(installDir);

  if (process.platform === 'darwin' && keychainWrite(account, key)) {
    return 'keychain';
  }

  if (process.platform === 'linux' && secretToolWrite(account, key)) {
    return 'keychain';
  }

  envWrite(installDir, key);
  return 'env';
}

/**
 * Remove the stored API key for this project directory from the system
 * keychain (macOS / Linux). Has no effect if no key is stored.
 */
export function clearApiKey(installDir: string): void {
  const account = projectHandle(installDir);

  if (process.platform === 'darwin') {
    try {
      execSync(
        `security delete-generic-password -a "${account}" -s "${KEYCHAIN_SERVICE}" 2>/dev/null`,
        { stdio: 'ignore' },
      );
    } catch {
      // Key wasn't in keychain — ignore
    }
  }

  if (process.platform === 'linux') {
    try {
      execSync(
        `secret-tool clear service "${KEYCHAIN_SERVICE}" account "${account}" 2>/dev/null`,
        { stdio: 'ignore' },
      );
    } catch {
      // Key wasn't in keyring — ignore
    }
  }
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
): { key: string; source: 'keychain' | 'env' } | null {
  const account = projectHandle(installDir);

  if (process.platform === 'darwin') {
    const key = keychainRead(account);
    if (key) return { key, source: 'keychain' };
  }

  if (process.platform === 'linux') {
    const key = secretToolRead(account);
    if (key) return { key, source: 'keychain' };
  }

  // .env.local in the project directory (project-scoped, safe)
  const envKey = envRead(installDir);
  if (envKey) return { key: envKey, source: 'env' };

  // NOTE: We intentionally do NOT fall back to process.env.AMPLITUDE_API_KEY.
  // A shell-level env var would leak across projects — if a user sets it in
  // their .bashrc, every project on the machine would silently use it.
  // Users should use .env.local (project-scoped) or --api-key (explicit).

  return null;
}
