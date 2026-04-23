/**
 * Call-site-drift guard for zone resolution.
 *
 * The original "all three production call sites agree" test was
 * tautological: every caller reduces to `resolveZone(session, fallback)`,
 * and the test invoked the helper three times with identical args. It
 * would happily pass if someone reintroduced a bespoke
 * `session.region ?? 'us'` chain at a call site, because the test never
 * imported the call sites themselves.
 *
 * This test replaces it with a grep-based contract:
 *
 *   1. No zone-fallback chains against `session.region` (e.g.
 *      `session.region ?? 'us'`, `session.region ?? DEFAULT_AMPLITUDE_ZONE`)
 *      outside the one legitimate Tier 1 read inside resolveZone itself.
 *   2. No `pendingAuthCloudRegion ?? session.region ?? …` patterns — that
 *      was the pre-refactor chain the PR removed.
 *   3. Direct `session.region` reads only appear in an allowlist of files
 *      covering: the field declaration, resolveZone's Tier 1 read, the
 *      RegionSelect gate, checkpoint persistence (we persist intent, not
 *      resolved zone), and display/debug output.
 *
 * All other code must go through `resolveZone(session, fallback)` from
 * src/lib/zone-resolution.ts. See the write/read invariants on the
 * `region` field in src/lib/wizard-session.ts for the full contract.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import fastGlob from 'fast-glob';

const ROOT = path.resolve(__dirname, '../../..');

/** Files permitted to read `session.region` directly. */
const ALLOWED_DIRECT_READS = new Set<string>([
  // Field declaration + docstring — not a runtime read.
  'src/lib/wizard-session.ts',
  // Tier 1 of resolveZone — the one legitimate read.
  'src/lib/zone-resolution.ts',
  // Display / debug output showing the user's current selection.
  'src/ui/tui/console-commands.ts',
  'src/ui/tui/utils/diagnostics.ts',
  'src/ui/tui/screens/RegionSelectScreen.tsx',
  'src/lib/console-query.ts',
  // Intent persistence — checkpoint stores raw user intent, not the
  // resolved effective zone. Restore must round-trip intent exactly.
  'src/lib/session-checkpoint.ts',
  // AuthScreen: effect dep array only (body uses resolveZone). A follow-up
  // may replace this with a computed zone dep; for now it's benign because
  // resolveZone's other inputs are stable within a process lifetime.
  'src/ui/tui/screens/AuthScreen.tsx',
  // SlackScreen: useMemo dep array only (body uses the memoized result
  // of resolveZone). Same rationale as AuthScreen — a direct session.region
  // read here is safe because resolveZone's other inputs (installDir,
  // ampli.json Zone, stored user zone) are stable for this screen's
  // lifetime after RegionSelect / auth have run.
  'src/ui/tui/screens/SlackScreen.tsx',
  // Prose comments reference `session.region`; no actual reads.
  'src/lib/credential-resolution.ts',
  // bin.ts: pre-OAuth RegionSelect gate checks + a verbose-log display.
  'bin.ts',
]);

/** Zone-fallback against session.region — e.g. `session.region ?? 'us'`. */
const ZONE_FALLBACK_RE =
  /\bsession\.region\s*\?\?\s*(?:['"](?:us|eu)['"]|DEFAULT_AMPLITUDE_ZONE\b)/;

/** The pre-refactor OAuth-zone fallback chain. */
const PENDING_AUTH_CHAIN_RE =
  /\bpendingAuthCloudRegion\s*\?\?\s*session\.region/;

const DIRECT_READ_RE = /\bsession\.region\b/;

async function loadSources(): Promise<
  Array<{ file: string; content: string }>
> {
  const files = await fastGlob(['src/**/*.{ts,tsx}', 'bin.ts'], {
    cwd: ROOT,
    ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
  });
  return files.map((file) => ({
    file,
    content: readFileSync(path.join(ROOT, file), 'utf8'),
  }));
}

describe('zone-resolution — call-site drift guard', () => {
  it('no `session.region ?? <zone>` fallback chains outside resolveZone', async () => {
    const sources = await loadSources();
    const violations: string[] = [];
    for (const { file, content } of sources) {
      if (file === 'src/lib/zone-resolution.ts') continue;
      const match = ZONE_FALLBACK_RE.exec(content);
      if (match) {
        violations.push(`${file}: \`${match[0].trim()}\``);
      }
    }
    expect(
      violations,
      'Use `resolveZone(session, fallback)` instead of rebuilding the fallback chain',
    ).toEqual([]);
  });

  it('no `pendingAuthCloudRegion ?? session.region` chains', async () => {
    const sources = await loadSources();
    const violations: string[] = [];
    for (const { file, content } of sources) {
      const match = PENDING_AUTH_CHAIN_RE.exec(content);
      if (match) {
        violations.push(`${file}: \`${match[0].trim()}\``);
      }
    }
    expect(
      violations,
      'OAuth-derived zone should flow through resolveZone, not a raw fallback',
    ).toEqual([]);
  });

  it('direct `session.region` reads only appear in allowlisted files', async () => {
    const sources = await loadSources();
    const unexpected: string[] = [];
    for (const { file, content } of sources) {
      if (ALLOWED_DIRECT_READS.has(file)) continue;
      if (DIRECT_READ_RE.test(content)) {
        unexpected.push(file);
      }
    }
    expect(
      unexpected,
      'Call `resolveZone(session, fallback)` instead of reading `session.region` directly',
    ).toEqual([]);
  });
});
