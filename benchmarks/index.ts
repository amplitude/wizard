/**
 * Wizard performance benchmark orchestrator.
 *
 *   pnpm bench           — runs offline benchmarks, prints a markdown
 *                          table, writes benchmarks/results.json.
 *   pnpm bench --live    — also runs the live-gateway benchmarks
 *                          (cache-hits, first-token-latency). Requires
 *                          WIZARD_LIVE_BENCHMARK=1 and OAuth.
 *   pnpm bench --json    — emit results.json contents on stdout instead
 *                          of the markdown table.
 *
 * The harness is intentionally honest about what it can and can't
 * measure on the current wizard main: rows for benchmarks blocked on
 * an unmerged feature are emitted with status `skipped` and a TODO
 * marker. Once the relevant feature lands the row activates
 * automatically — no harness change needed.
 *
 * NB: this is the OFFLINE bench harness (`benchmarks/`). It is distinct
 * from the runtime per-turn telemetry trackers under
 * `src/lib/middleware/benchmarks/`, which capture observability data
 * during real wizard runs.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { runBundleSizeBenchmark } from './bundle-size.bench.js';
import { runCacheHitsBenchmark } from './cache-hits.bench.js';
import { runFirstTokenLatencyBenchmark } from './first-token-latency.bench.js';
import { runPrefixSizeBenchmark } from './prefix-size.bench.js';
import { runToolExecBenchmark } from './tool-exec-time.bench.js';
import type { BenchmarkResult, BenchmarkRun } from './types.js';

const REPO_ROOT = path.resolve(__dirname, '..');

interface CliOptions {
  live: boolean;
  jsonOnly: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  return {
    live: argv.includes('--live'),
    jsonOnly: argv.includes('--json'),
  };
}

function readGitSha(): string | undefined {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return undefined;
  }
}

function statusIcon(s: BenchmarkResult['status']): string {
  switch (s) {
    case 'ok':
      return 'OK';
    case 'improved':
      return 'IMPROVED';
    case 'warn':
      return 'WARN';
    case 'regressed':
      return 'REGRESSED';
    case 'skipped':
      return 'SKIPPED';
  }
}

function fmtNumber(n: number | undefined, unit: string): string {
  if (n === undefined) return '-';
  if (unit === 'bytes') {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }
  if (unit === 'ms') return `${n} ms`;
  if (unit === 'tokens') return `${n.toLocaleString()} tok`;
  return `${n}`;
}

function renderMarkdown(run: BenchmarkRun): string {
  const lines: string[] = [];
  lines.push(`# wizard benchmarks — ${run.ts}`);
  if (run.commit)
    lines.push(
      `Commit: \`${run.commit}\` · Node ${run.node}${
        run.live ? ' · live=true' : ''
      }`,
    );
  lines.push('');
  lines.push('| Benchmark | Before | After | Delta | Status | Note |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of run.results) {
    lines.push(
      `| ${r.label} | ${fmtNumber(r.before, r.unit)} | ${fmtNumber(
        r.after,
        r.unit,
      )} | ${r.delta ?? '-'} | ${statusIcon(r.status)} | ${(
        r.note ?? ''
      ).replace(/\|/g, '\\|')} |`,
    );
  }
  // Tool exec table — break out p50/p95 since the umbrella row hides it.
  const toolRow = run.results.find((r) => r.id === 'tool-exec-time');
  if (
    toolRow &&
    toolRow.details &&
    Array.isArray((toolRow.details as { tools: unknown[] }).tools)
  ) {
    lines.push('');
    lines.push('## Per-tool execution time');
    lines.push('');
    lines.push('| Tool | Median | p95 | Max | Iter | Note |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    const tools = (toolRow.details as { tools: Array<Record<string, unknown>> })
      .tools;
    for (const t of tools) {
      if (t['ok']) {
        lines.push(
          `| ${t['tool']} | ${t['medianMs']} ms | ${t['p95Ms']} ms | ${t['maxMs']} ms | ${t['iterations']} | - |`,
        );
      } else {
        lines.push(
          `| ${t['tool']} | - | - | - | 0 | ${t['reason'] ?? 'skipped'} |`,
        );
      }
    }
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const results: BenchmarkResult[] = [];

  // ---- Offline benchmarks ---------------------------------------------------
  results.push(runPrefixSizeBenchmark(REPO_ROOT));
  results.push(runBundleSizeBenchmark({ v2Dir: REPO_ROOT }));
  results.push(await runToolExecBenchmark());

  // ---- Live benchmarks (gated) ---------------------------------------------
  results.push(await runCacheHitsBenchmark({ live: opts.live }));
  results.push(await runFirstTokenLatencyBenchmark({ live: opts.live }));

  const run: BenchmarkRun = {
    ts: new Date().toISOString(),
    commit: readGitSha(),
    node: process.version,
    live: opts.live || process.env['WIZARD_LIVE_BENCHMARK'] === '1',
    results,
  };

  // ---- Output --------------------------------------------------------------
  const outPath = path.join(REPO_ROOT, 'benchmarks', 'results.json');
  fs.writeFileSync(outPath, JSON.stringify(run, null, 2) + '\n');

  if (opts.jsonOnly) {
    process.stdout.write(JSON.stringify(run, null, 2) + '\n');
    return;
  }

  process.stdout.write(renderMarkdown(run) + '\n');
  process.stderr.write(`\n[bench] wrote ${outPath}\n`);
}

main().catch((e) => {
  process.stderr.write(`[bench] fatal: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
