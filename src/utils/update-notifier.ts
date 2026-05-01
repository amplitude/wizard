/**
 * Lightweight update notifier (audit G1).
 *
 * Fires a non-blocking background fetch for the latest published version of
 * the CLI from the npm registry and prints a one-line notice to stderr when
 * a newer version is available. Cached on disk to avoid hammering the
 * registry on every run.
 *
 * Silent failure — we never block the wizard or break if the network is
 * unreachable. Opts out automatically when:
 *   - stderr is not a TTY (piped / ci modes)
 *   - AMPLITUDE_WIZARD_AGENT=1 (agent mode)
 *   - NO_UPDATE_NOTIFIER is set (any non-empty value), CI=1, or DO_NOT_TRACK=1
 *   - AMPLITUDE_WIZARD_NO_UPDATE_CHECK=1
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import semver from 'semver';
import { atomicWriteJSON } from './atomic-write.js';
import { ensureDir, getUpdateCheckFile } from './storage-paths.js';

const CHECK_INTERVAL_MS = 1000 * 60 * 60 * 24; // once per 24h

interface Cache {
  lastCheckedAt: number;
  latestVersion: string | null;
}

function cachePath(): string {
  return getUpdateCheckFile();
}

async function readCache(): Promise<Cache | null> {
  try {
    const raw = await fs.readFile(cachePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Cache;
    if (
      typeof parsed.lastCheckedAt === 'number' &&
      (parsed.latestVersion === null ||
        typeof parsed.latestVersion === 'string')
    ) {
      return parsed;
    }
  } catch {
    // missing or malformed — treat as no cache
  }
  return null;
}

function writeCache(cache: Cache): void {
  try {
    // Ensure the cache root exists before writing — first run on a fresh
    // machine has no `~/.amplitude/wizard/` yet.
    ensureDir(dirname(cachePath()));
    atomicWriteJSON(cachePath(), cache, 0o600);
  } catch {
    // silently ignore — best-effort
  }
}

/**
 * Build the npm registry URL for a package name. Scoped packages require the
 * literal `@` in the URL path; only the `/` must be escaped.
 * `encodeURIComponent('@amplitude/wizard')` would produce
 * `%40amplitude%2Fwizard`, which the registry 404s.
 * See: https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md
 *
 * Exported for unit tests — don't call directly from non-test code.
 */
export function buildRegistryUrl(pkgName: string): string {
  return `https://registry.npmjs.org/${pkgName.replace('/', '%2f')}`;
}

async function fetchLatestVersion(
  pkgName: string,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();
    try {
      // `application/vnd.npm.install-v1+json` returns a slim response that
      // excludes per-version metadata — just enough to get `dist-tags.latest`.
      const res = await fetch(buildRegistryUrl(pkgName), {
        headers: { accept: 'application/vnd.npm.install-v1+json' },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        'dist-tags'?: { latest?: string };
      };
      const latest = body['dist-tags']?.latest;
      return typeof latest === 'string' ? latest : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export function shouldCheckForUpdates(): boolean {
  if (process.env.AMPLITUDE_WIZARD_NO_UPDATE_CHECK === '1') return false;
  if (process.env.NO_UPDATE_NOTIFIER) return false;
  if (process.env.DO_NOT_TRACK === '1') return false;
  if (process.env.CI === '1' || process.env.CI === 'true') return false;
  if (process.env.AMPLITUDE_WIZARD_AGENT === '1') return false;
  if (!process.stderr.isTTY) return false;
  return true;
}

export interface UpdateCheckResult {
  current: string;
  latest: string;
  available: boolean;
}

/**
 * Fire-and-forget update check. Writes a notice to stderr if an update is
 * available. Safe to call multiple times — short-circuits on the 24h cache.
 *
 * @returns The detected result (for tests), or null if skipped.
 */
export async function checkForUpdate(
  pkgName: string,
  currentVersion: string,
  options: { timeoutMs?: number; force?: boolean } = {},
): Promise<UpdateCheckResult | null> {
  if (!options.force && !shouldCheckForUpdates()) return null;

  const cache = await readCache();
  const now = Date.now();
  let latest: string | null;

  if (
    !options.force &&
    cache &&
    now - cache.lastCheckedAt < CHECK_INTERVAL_MS &&
    cache.latestVersion
  ) {
    latest = cache.latestVersion;
  } else {
    latest = await fetchLatestVersion(pkgName, options.timeoutMs ?? 1500);
    writeCache({
      lastCheckedAt: now,
      latestVersion: latest ?? cache?.latestVersion ?? null,
    });
  }

  if (!latest) return null;

  // Defensive: ignore invalid versions
  try {
    if (!semver.valid(currentVersion) || !semver.valid(latest)) {
      return null;
    }
  } catch {
    return null;
  }

  const available = semver.gt(latest, currentVersion);
  return { current: currentVersion, latest, available };
}

// Buffered notice that will be flushed on process exit. Kept at module scope
// so the process.on('exit') hook installed below can close over it without
// fighting React/Ink teardown timing.
let pendingNotice: string | null = null;
let exitHookInstalled = false;

function formatNotice(
  pkgName: string,
  current: string,
  latest: string,
): string {
  return `\nA new version of ${pkgName} is available: ${current} → ${latest}\n  Run \`npm i -g ${pkgName}\` or use \`npx ${pkgName}@latest\` to update.\n`;
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // `exit` fires after Ink has unmounted and released the alt-screen, so a
  // direct stderr write lands in the user's normal scrollback. Writing
  // during TUI runtime would have been clobbered by Ink's next frame render.
  process.on('exit', () => {
    if (!pendingNotice) return;
    try {
      process.stderr.write(pendingNotice);
    } catch {
      // broken pipe — non-fatal
    }
  });
}

/**
 * Kicks off the background version check and buffers an upgrade notice for
 * display on process exit (after Ink's alt-screen has been released).
 *
 * Why defer to exit? Writing directly to stderr during a TUI session fights
 * Ink's full-screen renderer — the notice either gets overwritten by the
 * next frame or corrupts the layout. Deferring is the simplest reliable way
 * to surface it without routing through the UI abstraction.
 *
 * Non-blocking: awaits the background fetch but catches all errors so the
 * caller can fire this off without try/catch.
 *
 * Exported for tests.
 */
export function scheduleUpdateCheck(
  pkgName: string,
  currentVersion: string,
): Promise<void> {
  installExitHook();
  return checkForUpdate(pkgName, currentVersion)
    .then((result) => {
      if (!result || !result.available) return;
      pendingNotice = formatNotice(pkgName, result.current, result.latest);
    })
    .catch(() => {
      // swallow
    });
}

/** Test helper — drains the buffered notice without waiting for exit. */
export function _drainPendingNoticeForTest(): string | null {
  const n = pendingNotice;
  pendingNotice = null;
  return n;
}
