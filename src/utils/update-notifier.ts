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
 *   - NO_UPDATE_NOTIFIER=1, CI=1, or DO_NOT_TRACK=1
 *   - AMPLITUDE_WIZARD_NO_UPDATE_CHECK=1
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import semver from 'semver';

const CHECK_INTERVAL_MS = 1000 * 60 * 60 * 24; // once per 24h
const CACHE_FILENAME = 'amplitude-wizard-update-check.json';

interface Cache {
  lastCheckedAt: number;
  latestVersion: string | null;
}

function cachePath(): string {
  return join(tmpdir(), CACHE_FILENAME);
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

async function writeCache(cache: Cache): Promise<void> {
  try {
    await fs.writeFile(cachePath(), JSON.stringify(cache), { mode: 0o600 });
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
  if (process.env.NO_UPDATE_NOTIFIER === '1') return false;
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
    if (latest !== null) {
      await writeCache({ lastCheckedAt: now, latestVersion: latest });
    }
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

/**
 * Prints a one-line upgrade notice to stderr when a newer version is
 * available. Non-blocking: awaits the background check but catches all
 * errors so the caller can kick it off without try/catch.
 */
export function scheduleUpdateCheck(
  pkgName: string,
  currentVersion: string,
): Promise<void> {
  return checkForUpdate(pkgName, currentVersion)
    .then((result) => {
      if (!result || !result.available) return;
      const msg = `\nA new version of ${pkgName} is available: ${result.current} → ${result.latest}\n  Run \`npm i -g ${pkgName}\` or use \`npx ${pkgName}@latest\` to update.\n`;
      try {
        process.stderr.write(msg);
      } catch {
        // ignore — broken pipe
      }
    })
    .catch(() => {
      // swallow
    });
}
