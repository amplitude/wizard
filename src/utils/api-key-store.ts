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

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  chmodSync,
  accessSync,
  constants as fsConstants,
} from 'node:fs';
import { join, delimiter } from 'node:path';
import { createHash } from 'node:crypto';
import { logToFile } from './debug.js';

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

const KEYCHAIN_SERVICE = 'amplitude-wizard';
const ENV_KEY_NAME = 'AMPLITUDE_API_KEY';

/** A short stable identifier for the project directory (used as keychain account). */
function projectHandle(installDir: string): string {
  return createHash('sha1').update(installDir).digest('hex').slice(0, 12);
}

// ── binary discovery ──────────────────────────────────────────────────────────
//
// We avoid shelling out to a binary that doesn't exist — the resulting
// ENOENT noise pollutes logs and slows the read path on platforms where
// the user just doesn't have a credential helper installed (common on
// minimal Linux containers and bare-metal Windows). Cached per-process
// because PATH doesn't change underneath us.

const binCache = new Map<string, boolean>();

/**
 * Test-only: seed or reset the binary discovery cache. Lets unit tests
 * exercise the keychain code paths without needing the native binaries
 * (`security`, `secret-tool`) installed on the test host.
 */
export function __setBinaryAvailableForTests(
  name: string,
  available: boolean | undefined,
): void {
  if (available === undefined) binCache.delete(name);
  else binCache.set(name, available);
}

function hasBinary(name: string): boolean {
  const cached = binCache.get(name);
  if (cached !== undefined) return cached;

  // macOS ships `security` at a SIP-protected path; PATH lookup is unnecessary
  // and breaks when callers (npx, GUI-launched terminals, claude-code shells)
  // sanitize PATH down to a Homebrew-only string. Fast-path the known location.
  if (process.platform === 'darwin' && name === 'security') {
    const found = existsSync('/usr/bin/security');
    binCache.set(name, found);
    return found;
  }

  // PATH may legitimately be unset under cron / raw systemd units.
  const pathEnv =
    process.env.PATH ??
    (process.platform === 'win32' ? '' : '/usr/local/bin:/usr/bin:/bin');
  const exts =
    process.platform === 'win32'
      ? // Bare name first so callers can pass `claude` to find `claude.cmd`
        // without the `.cmd` suffix; PATHEXT after.
        ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')]
      : [''];

  const found = pathEnv.split(delimiter).some((rawDir) => {
    if (!rawDir) return false;
    // Windows PATH segments are sometimes quoted (registry-expanded paths
    // with spaces). Strip surrounding quotes before joining.
    const dir = rawDir.replace(/^"(.*)"$/, '$1');
    return exts.some((ext) => {
      const candidate = join(dir, name + ext);
      if (!existsSync(candidate)) return false;
      // POSIX: a non-executable file at the path doesn't count.
      // Windows: skip the X_OK check — execute bit is meaningless on NTFS
      // and `accessSync` returns true on regular files anyway.
      if (process.platform !== 'win32') {
        try {
          accessSync(candidate, fsConstants.X_OK);
        } catch {
          return false;
        }
      }
      return true;
    });
  });

  binCache.set(name, found);
  return found;
}

// ── headless-environment short-circuit (Linux) ────────────────────────────────
//
// `secret-tool` requires a D-Bus session to talk to gnome-keyring/kwallet.
// In Docker, CI runners, SSH-into-server, and most cloud shells there's no
// D-Bus session and `secret-tool` returns
//     "Cannot autolaunch D-Bus without X11 $DISPLAY"
// on every invocation. Detecting upfront skips a fork+exec per read AND
// stops the log from filling with the same error message on every API key
// lookup.

let cachedHeadlessLinux: boolean | undefined;

function isHeadlessLinux(): boolean {
  if (process.platform !== 'linux') return false;
  if (cachedHeadlessLinux !== undefined) return cachedHeadlessLinux;
  const hasDbus = Boolean(process.env.DBUS_SESSION_BUS_ADDRESS);
  const hasDisplay = Boolean(
    process.env.DISPLAY || process.env.WAYLAND_DISPLAY,
  );
  cachedHeadlessLinux = !hasDbus && !hasDisplay;
  return cachedHeadlessLinux;
}

/** Test-only: reset the headless-Linux verdict between cases. */
export function __resetHeadlessCacheForTests(): void {
  cachedHeadlessLinux = undefined;
}

/**
 * Extract the stderr/message from an exec error so we can log *what*
 * failed without leaking the password (which would only ever be in argv,
 * not stderr). Returns a short, single-line summary.
 */
function summarizeExecError(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const e = err as {
    stderr?: Buffer | string;
    message?: string;
    code?: string | number;
    status?: number;
  };
  const stderr =
    typeof e.stderr === 'string'
      ? e.stderr
      : Buffer.isBuffer(e.stderr)
      ? e.stderr.toString('utf8')
      : '';
  const summary = (stderr || e.message || '').trim().split('\n')[0] ?? '';
  const code = e.code ?? e.status;
  return code ? `[${code}] ${summary}` : summary;
}

// ── macOS Keychain ────────────────────────────────────────────────────────────

const LOGIN_KEYCHAIN = `${
  process.env.HOME ?? ''
}/Library/Keychains/login.keychain-db`;

/** macOS `errSecItemNotFound` — the expected "no key stored yet" outcome. */
const ERR_SEC_ITEM_NOT_FOUND = 44;

/**
 * macOS prints `keychain "&lt;path or UUID&gt;" cannot be found` when the search
 * list contains a stale reference (common after FileVault rotations,
 * Keychain Access "reset", or per-volume dynamic keychains being deleted).
 * One bad entry poisons every read because `security` walks the full list.
 */
const KEYCHAIN_PATH_MISSING = /keychain ["'].*["'] cannot be found/i;

function isItemNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; stderr?: Buffer | string };
  if (e.status === ERR_SEC_ITEM_NOT_FOUND) return true;
  // Locale fallback: english stderr text. Match both "could not" and "cannot
  // be found" since macOS uses both phrasings across versions.
  const stderr =
    typeof e.stderr === 'string'
      ? e.stderr
      : Buffer.isBuffer(e.stderr)
      ? e.stderr.toString('utf8')
      : '';
  return /(could not|cannot) be found in (the )?keychain/i.test(stderr);
}

function runSecurityFind(account: string, explicitKeychain?: string): string {
  const args = [
    'find-generic-password',
    '-a',
    account,
    '-s',
    KEYCHAIN_SERVICE,
    '-w',
  ];
  if (explicitKeychain) args.push(explicitKeychain);
  return execFileSync('security', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function keychainRead(account: string): string | null {
  if (!hasBinary('security')) {
    logToFile('[api-key-store] macOS `security` binary not available');
    return null;
  }
  try {
    return runSecurityFind(account);
  } catch (err) {
    if (isItemNotFound(err)) return null;

    const summary = summarizeExecError(err);

    // Stale entry in the keychain search list — retry against the login
    // keychain explicitly. This recovers from the user's "uuid cannot be
    // found" error without requiring them to repair `security list-keychains`.
    if (KEYCHAIN_PATH_MISSING.test(summary) && existsSync(LOGIN_KEYCHAIN)) {
      logToFile(
        `[api-key-store] stale keychain in search list, retrying against login.keychain-db: ${summary}`,
      );
      try {
        return runSecurityFind(account, LOGIN_KEYCHAIN);
      } catch (retryErr) {
        if (isItemNotFound(retryErr)) return null;
        logToFile(
          `[api-key-store] keychain retry failed: ${summarizeExecError(
            retryErr,
          )}`,
        );
        return null;
      }
    }

    logToFile(`[api-key-store] keychain read failed: ${summary}`);
    return null;
  }
}

function keychainWrite(account: string, key: string): boolean {
  if (!hasBinary('security')) {
    logToFile('[api-key-store] macOS `security` binary not available');
    return false;
  }
  try {
    // NOTE: The key is passed as a command-line argument to `-w`. This means it
    // is briefly visible in `ps` output. macOS `security` does not support
    // reading the password from stdin, so there is no way to avoid this with
    // the current CLI interface. Using `execFileSync` (not a shell) prevents
    // shell-history and metacharacter issues but does not hide the argument
    // from the process table.
    //
    // `-T ''` sets an empty trusted-application list. Without it, the ACL
    // would be tied to the writing binary's path — and `npx` cache paths
    // (`~/.npm/_npx/<sha>/.../node`) change every release, which would
    // re-prompt "amplitude-wizard wants to access keychain" on every run.
    // Empty ACL → only the user's own processes can read, which matches our
    // existing security model (the entry is keyed by hashed install-dir).
    //
    // We pin to the login keychain explicitly so a stale search list (the
    // "keychain uuid cannot be found" failure mode) doesn't break writes.
    const args = [
      'add-generic-password',
      '-U',
      '-a',
      account,
      '-s',
      KEYCHAIN_SERVICE,
      '-T',
      '',
      '-w',
      key,
    ];
    if (existsSync(LOGIN_KEYCHAIN)) args.push(LOGIN_KEYCHAIN);

    execFileSync('security', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    return true;
  } catch (err) {
    logToFile(
      `[api-key-store] keychain write failed: ${summarizeExecError(err)}`,
    );
    return false;
  }
}

// ── Linux secret-tool ─────────────────────────────────────────────────────────

/**
 * `secret-tool lookup` returns exit 1 on a miss. Stderr is usually empty
 * but some libsecret builds print "No matching results." — both are the
 * "no key stored yet" path. Any *other* stderr text (e.g. D-Bus errors)
 * is a real failure worth logging.
 */
function isSecretToolMiss(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; stderr?: Buffer | string };
  if (e.status !== 1) return false;
  const stderr =
    typeof e.stderr === 'string'
      ? e.stderr
      : Buffer.isBuffer(e.stderr)
      ? e.stderr.toString('utf8')
      : '';
  const text = stderr.trim();
  return text === '' || /no matching results/i.test(text);
}

function secretToolRead(account: string): string | null {
  if (isHeadlessLinux()) return null; // no D-Bus, no point
  if (!hasBinary('secret-tool')) {
    logToFile(
      '[api-key-store] Linux `secret-tool` not installed (libsecret-tools)',
    );
    return null;
  }
  try {
    return execFileSync(
      'secret-tool',
      ['lookup', 'service', KEYCHAIN_SERVICE, 'account', account],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  } catch (err) {
    if (isSecretToolMiss(err)) return null;
    logToFile(
      `[api-key-store] secret-tool read failed: ${summarizeExecError(err)}`,
    );
    return null;
  }
}

function secretToolWrite(account: string, key: string): boolean {
  if (isHeadlessLinux()) return false;
  if (!hasBinary('secret-tool')) {
    logToFile(
      '[api-key-store] Linux `secret-tool` not installed (libsecret-tools)',
    );
    return false;
  }
  try {
    // secret-tool reads the password from stdin. Pipe the key via `input`
    // rather than building a shell pipeline — that way we can't hit shell
    // metacharacter issues if the key contains quotes, backticks, etc.
    execFileSync(
      'secret-tool',
      [
        'store',
        '--label=Amplitude API Key',
        'service',
        KEYCHAIN_SERVICE,
        'account',
        account,
      ],
      { input: key, stdio: ['pipe', 'ignore', 'pipe'] },
    );
    return true;
  } catch (err) {
    logToFile(
      `[api-key-store] secret-tool write failed: ${summarizeExecError(err)}`,
    );
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
 * keychain (macOS / Linux) AND from .env.local. Has no effect if no key
 * is stored. Clears every storage backend because readApiKeyWithSource
 * falls through them in order — leaving one populated would silently
 * re-use the previous login's key on the next run.
 */
export function clearApiKey(installDir: string): void {
  const account = projectHandle(installDir);

  if (process.platform === 'darwin' && hasBinary('security')) {
    try {
      execFileSync(
        'security',
        ['delete-generic-password', '-a', account, '-s', KEYCHAIN_SERVICE],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
    } catch (err) {
      const summary = summarizeExecError(err);
      if (!/could not be found/i.test(summary)) {
        logToFile(`[api-key-store] keychain delete failed: ${summary}`);
      }
    }
  }

  if (
    process.platform === 'linux' &&
    !isHeadlessLinux() &&
    hasBinary('secret-tool')
  ) {
    try {
      execFileSync(
        'secret-tool',
        ['clear', 'service', KEYCHAIN_SERVICE, 'account', account],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
    } catch (err) {
      // `secret-tool clear` is silent on success and on miss — only log
      // genuine errors (D-Bus issues won't reach here thanks to the
      // headless short-circuit above).
      logToFile(
        `[api-key-store] secret-tool clear failed: ${summarizeExecError(err)}`,
      );
    }
  }

  // Strip the key from .env.local without deleting the file — users may
  // have other env vars there.
  const envPath = join(installDir, '.env.local');
  if (!existsSync(envPath)) return;
  const contents = readFileSync(envPath, 'utf8');
  if (!contents.includes(`${ENV_KEY_NAME}=`)) return;
  const stripped = contents
    .replace(new RegExp(`^${ENV_KEY_NAME}=.*\\r?\\n?`, 'm'), '')
    .replace(/\n{3,}/g, '\n\n');
  writeFileSync(envPath, stripped, { encoding: 'utf8', mode: ENV_FILE_MODE });
  tightenEnvMode(envPath);
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
