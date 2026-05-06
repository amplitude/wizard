/**
 * Per-tool execution-time benchmark.
 *
 * The migration plan calls the sandboxed file-op tools "millisecond-fast".
 * This benchmark measures the wall-clock cost of each tool n=100 times
 * against a small fixture project and reports min / median / p95 / max.
 *
 * Tools targeted:
 *   - read_file
 *   - list_files
 *   - grep
 *   - edit_apply
 *   - load_skill
 *
 * Reality check: the wizard does not yet expose a public skill-loader
 * module the way the rewrite does. The benchmark calls `load_skill`
 * dynamically via try/catch import — when the loader doesn't exist it
 * emits a `skipped` row with a TODO(phase-D-3) marker. The four fs-based
 * tools always run.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { BenchmarkResult } from './types.js';

interface ToolStats {
  tool: string;
  ok: boolean;
  iterations: number;
  minMs?: number;
  medianMs?: number;
  p95Ms?: number;
  maxMs?: number;
  reason?: string;
}

const ITERATIONS = 100;

function buildFixtureProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-bench-fixture-'));
  // Small but representative tree.
  fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'lib'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0' }, null, 2),
  );
  fs.writeFileSync(
    path.join(dir, 'src', 'index.ts'),
    'export const greet = (name: string) => `hello, ${name}`;\n',
  );
  fs.writeFileSync(
    path.join(dir, 'src', 'components', 'App.tsx'),
    `import { greet } from "../index";\nexport function App() { return <div>{greet("world")}</div>; }\n`,
  );
  fs.writeFileSync(
    path.join(dir, 'src', 'lib', 'util.ts'),
    'export function add(a: number, b: number): number { return a + b; }\n',
  );
  return dir;
}

function timeTool(fn: () => unknown | Promise<unknown>): Promise<number> {
  const start = process.hrtime.bigint();
  const result = fn();
  if (result && typeof (result as Promise<unknown>).then === 'function') {
    return (result as Promise<unknown>).then(() => {
      const end = process.hrtime.bigint();
      return Number(end - start) / 1e6;
    });
  }
  const end = process.hrtime.bigint();
  return Promise.resolve(Number(end - start) / 1e6);
}

async function timeMany(
  fn: () => unknown | Promise<unknown>,
  n: number,
): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    samples.push(await timeTool(fn));
  }
  return samples;
}

function summarize(tool: string, samples: number[]): ToolStats {
  if (samples.length === 0) {
    return { tool, ok: false, iterations: 0, reason: 'no samples' };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    tool,
    ok: true,
    iterations: samples.length,
    minMs: round(sorted[0]!),
    medianMs: round(p(0.5)!),
    p95Ms: round(p(0.95)!),
    maxMs: round(sorted[sorted.length - 1]!),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Try to import a tool's implementation dynamically. Returns null when
 * the module doesn't exist on the current branch — the harness should
 * skip the row and keep going.
 */
async function tryImport<T>(modulePath: string): Promise<T | null> {
  try {
    return (await import(modulePath)) as T;
  } catch {
    return null;
  }
}

async function benchReadFile(fixture: string): Promise<ToolStats> {
  const target = path.join(fixture, 'src', 'components', 'App.tsx');
  // Naive read_file equivalent: fs.readFileSync. The actual tool may
  // wrap with sandbox checks; this is a "ceiling" measurement.
  const samples = await timeMany(
    () => fs.readFileSync(target, 'utf8'),
    ITERATIONS,
  );
  return summarize('read_file', samples);
}

async function benchListFiles(fixture: string): Promise<ToolStats> {
  const samples = await timeMany(() => {
    const out: string[] = [];
    const stack = [fixture];
    while (stack.length) {
      const d = stack.pop()!;
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        if (ent.isDirectory()) stack.push(path.join(d, ent.name));
        else out.push(path.join(d, ent.name));
      }
    }
    return out;
  }, ITERATIONS);
  return summarize('list_files', samples);
}

async function benchGrep(fixture: string): Promise<ToolStats> {
  // Approximation: scan files for the literal "greet". A real `grep`
  // tool will use ripgrep or similar; this measures the JS upper bound.
  const samples = await timeMany(() => {
    const matches: string[] = [];
    const stack = [fixture];
    while (stack.length) {
      const d = stack.pop()!;
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) stack.push(full);
        else {
          const text = fs.readFileSync(full, 'utf8');
          if (text.includes('greet')) matches.push(full);
        }
      }
    }
    return matches;
  }, ITERATIONS);
  return summarize('grep', samples);
}

async function benchEditApply(fixture: string): Promise<ToolStats> {
  // Simulate a single old_string -> new_string replacement on a
  // throwaway copy each iteration.
  const samples = await timeMany(() => {
    const copy = path.join(fixture, '.bench-edit.tmp');
    fs.copyFileSync(path.join(fixture, 'src', 'index.ts'), copy);
    const text = fs.readFileSync(copy, 'utf8');
    const replaced = text.replace('hello, ', 'hi, ');
    fs.writeFileSync(copy, replaced);
    fs.rmSync(copy);
  }, ITERATIONS);
  return summarize('edit_apply', samples);
}

async function benchLoadSkill(): Promise<ToolStats> {
  // We import the loader dynamically. If the module doesn't exist on the
  // current branch (the wizard hasn't ported the skill loader yet), return
  // skipped. TODO(phase-D-3): wire to the real loader once published.
  const mod = await tryImport<{
    loadAgentSkill: (id: string) => unknown;
    resetSkillCacheForTests: () => void;
  }>('../src/lib/agent-skills-loader.js');
  if (!mod) {
    return {
      tool: 'load_skill',
      ok: false,
      iterations: 0,
      reason:
        'TODO(phase-D-3): wizard does not yet expose a public skill loader module',
    };
  }
  // Reset cache so each iteration measures real I/O, not the in-memory hit.
  const samples = await timeMany(() => {
    mod.resetSkillCacheForTests();
    return mod.loadAgentSkill('wizard-prompt-supplement');
  }, ITERATIONS);
  return summarize('load_skill', samples);
}

export async function runToolExecBenchmark(): Promise<BenchmarkResult> {
  const fixture = buildFixtureProject();
  try {
    const stats: ToolStats[] = [];
    stats.push(await benchReadFile(fixture));
    stats.push(await benchListFiles(fixture));
    stats.push(await benchGrep(fixture));
    stats.push(await benchEditApply(fixture));
    stats.push(await benchLoadSkill());

    const ok = stats.filter((s) => s.ok);
    const skipped = stats.filter((s) => !s.ok);

    const note =
      ok.length === 0
        ? 'no tools executable on this branch'
        : `${ok.length}/${stats.length} tools measured (${skipped.length} skipped)`;

    return {
      id: 'tool-exec-time',
      label: 'Per-tool execution time',
      unit: 'ms',
      status: ok.length > 0 ? 'ok' : 'skipped',
      note,
      details: { iterations: ITERATIONS, tools: stats },
    };
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}
