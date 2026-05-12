#!/usr/bin/env -S node --import=tsx
/**
 * Build a per-scenario variance summary across multi-seed nightly runs.
 *
 * Reads every `report.json` under the directory passed on argv (CI
 * passes the artifact-download root). Groups reports by scenario name,
 * computes the seed-to-seed score delta, and emits a JSON summary
 * highlighting any scenario whose seeds disagree by more than 10
 * points (the spec's threshold for "non-deterministic; tighten the
 * prompt or skill").
 *
 * Output goes to `variance-summary.json` in cwd by default; the path
 * can be overridden with `--out <path>`. The CI nightly workflow
 * uploads it as a separate artifact for triage.
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface MinimalReport {
  scenario: string;
  totalScore: number;
  maxScore: number;
  hardFailed: boolean;
  artifact?: { seed?: number };
}

interface ScenarioVariance {
  scenario: string;
  scores: Array<{
    seed: number;
    totalScore: number;
    maxScore: number;
    hardFailed: boolean;
  }>;
  /** Difference between max and min totalScore across seeds. */
  scoreSpread: number;
  /** Set when scoreSpread > 10 — the spec's non-determinism threshold. */
  flagged: boolean;
}

const SCORE_SPREAD_THRESHOLD = 10;

function findReportFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) walk(full);
      else if (name === 'report.json') out.push(full);
    }
  }
  walk(root);
  return out;
}

function loadReport(path: string): MinimalReport | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as MinimalReport;
  } catch {
    return null;
  }
}

interface CliArgs {
  root: string;
  out: string;
}

function parseArgs(argv: string[]): CliArgs {
  let out = 'variance-summary.json';
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') {
      out = argv[++i];
    } else {
      rest.push(argv[i]);
    }
  }
  if (rest.length !== 1) {
    throw new Error(
      'usage: tsx evals/bin/variance-summary.ts <reports-root> [--out <path>]',
    );
  }
  return { root: resolve(rest[0]), out: resolve(out) };
}

function buildSummary(reports: MinimalReport[]): ScenarioVariance[] {
  const byScenario = new Map<string, MinimalReport[]>();
  for (const r of reports) {
    const list = byScenario.get(r.scenario) ?? [];
    list.push(r);
    byScenario.set(r.scenario, list);
  }
  const out: ScenarioVariance[] = [];
  for (const [scenario, runs] of byScenario.entries()) {
    const scores = runs.map((r) => ({
      seed: r.artifact?.seed ?? 0,
      totalScore: r.totalScore,
      maxScore: r.maxScore,
      hardFailed: r.hardFailed,
    }));
    const totals = scores.map((s) => s.totalScore);
    const spread =
      totals.length === 0 ? 0 : Math.max(...totals) - Math.min(...totals);
    out.push({
      scenario,
      scores,
      scoreSpread: spread,
      flagged: spread > SCORE_SPREAD_THRESHOLD,
    });
  }
  out.sort((a, b) => b.scoreSpread - a.scoreSpread);
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = findReportFiles(args.root);
  const reports: MinimalReport[] = [];
  for (const path of files) {
    const r = loadReport(path);
    if (r) reports.push(r);
  }
  const summary = buildSummary(reports);
  const flagged = summary.filter((s) => s.flagged);

  const output = {
    generatedAt: new Date().toISOString(),
    reportsScanned: reports.length,
    threshold: SCORE_SPREAD_THRESHOLD,
    flaggedCount: flagged.length,
    scenarios: summary,
  };
  writeFileSync(args.out, JSON.stringify(output, null, 2));
  console.log(
    JSON.stringify(
      {
        scenarios: summary.length,
        flagged: flagged.length,
        path: args.out,
      },
      null,
      2,
    ),
  );
  // Exit non-zero when any scenario is flagged so the nightly workflow
  // surfaces the issue in its job conclusion.
  if (flagged.length > 0) process.exit(1);
}

main();
