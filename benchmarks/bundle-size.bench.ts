/**
 * Bundle-size benchmark.
 *
 * Runs `pnpm pack --pack-destination <tmp>` against the current repo and,
 * if available, against a baseline / "before" repo (e.g. a sibling
 * checkout of the legacy wizard or a previous tag). Reports exact tarball
 * bytes and the reduction ratio.
 *
 * Reality check: when no baseline repo is checked out alongside, the
 * benchmark records the current tarball size and emits `skipped` for the
 * delta. CI won't have a sibling, so we expect the comparison to be
 * exercised locally — set `WIZARD_BENCH_V1_DIR` to point at the
 * comparison repo.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { BenchmarkResult } from './types.js';

interface PackResult {
  ok: boolean;
  tarballBytes?: number;
  reason?: string;
}

function packRepo(repoDir: string): PackResult {
  if (!fs.existsSync(path.join(repoDir, 'package.json'))) {
    return { ok: false, reason: `no package.json at ${repoDir}` };
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-bench-pack-'));
  try {
    // pnpm pack does not support `--dry-run`; instead we pack to a temp
    // dir, stat the tarball, and clean up.
    const r = spawnSync('pnpm', ['pack', '--pack-destination', tmp], {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r.status !== 0) {
      return {
        ok: false,
        reason: `pnpm pack exited ${r.status}: ${(r.stderr || '').slice(
          0,
          200,
        )}`,
      };
    }
    const files = fs.readdirSync(tmp).filter((f) => f.endsWith('.tgz'));
    if (files.length === 0) {
      return { ok: false, reason: 'pnpm pack produced no .tgz' };
    }
    const tarballName = files[0]!;
    const tarball = path.join(tmp, tarballName);
    const stats = fs.statSync(tarball);
    return { ok: true, tarballBytes: stats.size };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export interface BundleSizeOptions {
  /** Absolute path to the "after" (current) repo root. */
  v2Dir: string;
  /**
   * Absolute path to the "before" / baseline repo. When undefined, the
   * benchmark looks at common locations and `WIZARD_BENCH_V1_DIR`.
   */
  v1Dir?: string;
}

function defaultV1Candidates(): string[] {
  const home = os.homedir();
  const fromEnv = process.env['WIZARD_BENCH_V1_DIR'];
  const candidates: string[] = [];
  if (fromEnv) candidates.push(fromEnv);
  candidates.push(
    path.join(home, 'worktree-repos', 'wizard-baseline'),
    path.join(home, 'src', 'wizard-baseline'),
    path.join(home, 'code', 'wizard-baseline'),
  );
  return candidates;
}

export function runBundleSizeBenchmark(
  opts: BundleSizeOptions,
): BenchmarkResult {
  const v2 = packRepo(opts.v2Dir);
  if (!v2.ok || v2.tarballBytes === undefined) {
    return {
      id: 'bundle-size',
      label: 'Bundle size (npm tarball)',
      unit: 'bytes',
      status: 'skipped',
      note: `current pack failed: ${v2.reason ?? 'unknown'}`,
    };
  }

  const v1Path =
    opts.v1Dir ?? defaultV1Candidates().find((c) => fs.existsSync(c));
  if (!v1Path) {
    return {
      id: 'bundle-size',
      label: 'Bundle size (npm tarball)',
      unit: 'bytes',
      after: v2.tarballBytes,
      status: 'skipped',
      note: 'baseline repo not found alongside; set WIZARD_BENCH_V1_DIR to compare.',
      details: { currentTarballBytes: v2.tarballBytes },
    };
  }

  const v1 = packRepo(v1Path);
  if (!v1.ok || v1.tarballBytes === undefined) {
    return {
      id: 'bundle-size',
      label: 'Bundle size (npm tarball)',
      unit: 'bytes',
      after: v2.tarballBytes,
      status: 'skipped',
      note: `baseline pack failed: ${v1.reason ?? 'unknown'}`,
      details: { currentTarballBytes: v2.tarballBytes, v1Path },
    };
  }

  const reductionPct =
    v1.tarballBytes === 0
      ? 0
      : Math.round((1 - v2.tarballBytes / v1.tarballBytes) * 100);

  return {
    id: 'bundle-size',
    label: 'Bundle size (npm tarball)',
    before: v1.tarballBytes,
    after: v2.tarballBytes,
    unit: 'bytes',
    delta: `${reductionPct >= 0 ? '-' : '+'}${Math.abs(reductionPct)}%`,
    status: 'ok',
    note: `baseline: ${formatBytes(v1.tarballBytes)} → current: ${formatBytes(
      v2.tarballBytes,
    )}`,
    details: {
      v1Path,
      v2Path: opts.v2Dir,
      v1TarballBytes: v1.tarballBytes,
      v2TarballBytes: v2.tarballBytes,
      reductionPct,
    },
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
