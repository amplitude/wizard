import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const MARKER = '# Amplitude Wizard shell completions';
const BLOCK =
  /\n?# Amplitude Wizard shell completions\s*\neval "\$\(amplitude-wizard completion\)"\s*\n?/g;

/** Cache-root override env var (mirrors `storage-paths.ts`). */
const CACHE_ROOT_OVERRIDE_ENV = 'AMPLITUDE_WIZARD_CACHE_DIR';

/**
 * Resolve the per-user cache root without taking a hard dep on
 * `storage-paths` (it imports more than we need on the cold-start hot
 * path). Honors the same `AMPLITUDE_WIZARD_CACHE_DIR` override the rest
 * of the wizard uses for test isolation.
 */
function getCacheRoot(): string {
  const override = process.env[CACHE_ROOT_OVERRIDE_ENV];
  if (override && override.length > 0) return override;
  try {
    return path.join(os.homedir(), '.amplitude', 'wizard');
  } catch {
    return '';
  }
}

const SENTINEL_NAME = '.shell-rc-cleaned';

/**
 * Earlier versions silently appended a completion eval to the user's shell rc.
 * The `completion` subcommand has since been removed, so sourcing the rc now
 * errors with `command not found: amplitude-wizard`. Remove only the exact
 * block we added so users aren't stuck with a broken shell config.
 *
 * After the first successful pass, drop a sentinel file next to the cache
 * root so subsequent invocations short-circuit. The original cleanup pass
 * read three rc files unconditionally on every run — a tax that compounded
 * with the rest of the cold-start chain. The sentinel keeps the one-shot
 * cleanup intact while making it actually one-shot.
 */
export function cleanupShellCompletionLine(): void {
  const cacheRoot = getCacheRoot();
  const sentinelPath = cacheRoot ? path.join(cacheRoot, SENTINEL_NAME) : '';

  // Fast path — already cleaned. The sentinel is best-effort: if it
  // can't be read (perm error, transient FS hiccup) we re-run the
  // cleanup, which is idempotent.
  if (sentinelPath) {
    try {
      if (fs.existsSync(sentinelPath)) return;
    } catch {
      // Fall through to do the work.
    }
  }

  let home: string;
  try {
    home = os.homedir();
  } catch {
    return;
  }

  const candidates = [
    path.join(home, '.zshrc'),
    path.join(home, '.bashrc'),
    path.join(home, '.bash_profile'),
  ];

  // Try each file independently so a failure on one (e.g. read-only
  // permissions on .zshrc) doesn't skip cleanup of the others.
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const contents = fs.readFileSync(file, 'utf-8');
      if (!contents.includes(MARKER)) continue;
      const cleaned = contents.replace(BLOCK, '\n');
      if (cleaned !== contents) {
        fs.writeFileSync(file, cleaned, 'utf-8');
      }
    } catch {
      // Best-effort cleanup; never surface errors.
    }
  }

  // Drop the sentinel so future invocations skip the rc walk. Done last
  // so a partial failure in the loop above leaves the sentinel absent —
  // the next run retries automatically. Best-effort: if the cache dir
  // can't be created (locked-down volume, weird home directory), accept
  // the small per-run cost rather than crashing.
  if (sentinelPath) {
    try {
      fs.mkdirSync(cacheRoot, { recursive: true });
      fs.writeFileSync(sentinelPath, '', 'utf-8');
    } catch {
      // Sentinel write failed — next run re-walks the rc files. No-op.
    }
  }
}
