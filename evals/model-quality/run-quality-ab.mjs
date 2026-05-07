#!/usr/bin/env node
/**
 * Quality A/B harness — Haiku vs. Sonnet on wizard one-shot LLM call sites.
 *
 * Reads a fixture (`fixtures/<name>.json`), runs every prompt N times
 * against both Haiku and Sonnet via the same `streamText` +
 * `createAnthropic` setup the wizard uses, and emits an NDJSON
 * results file under `results/`. Score with
 * `score-quality.mjs --results <file>`.
 *
 * Usage:
 *   WIZARD_OAUTH_TOKEN=... node evals/model-quality/run-quality-ab.mjs \
 *     --fixture console-query --runs 5
 *
 * Auth resolution (same contract as the wizard CI path):
 *   1. WIZARD_OAUTH_TOKEN  -> routed through the Amplitude LLM gateway
 *   2. ANTHROPIC_API_KEY   -> direct to Anthropic (skips the gateway)
 *
 * The harness intentionally does NOT pull
 * `createWizardAiSdkAnthropic` from the wizard runtime — it uses
 * `@ai-sdk/anthropic` directly so the eval is self-contained and
 * insulated from concurrent wizard refactors. The model strings,
 * auth resolution, and request shape mirror
 * `src/lib/agent/ai-sdk-gateway-probe.ts` and
 * `src/lib/console-query.ts`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  runPrompt,
  resolveHarnessAuth,
  authToRunnerShape,
} from './lib/run-prompt.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { fixture: null, runs: 5, outDir: null, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--fixture') out.fixture = argv[++i];
    else if (a === '--runs') out.runs = Number(argv[++i]);
    else if (a === '--out-dir') out.outDir = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
  }
  if (!out.fixture) {
    printUsage();
    process.exit(2);
  }
  if (!Number.isFinite(out.runs) || out.runs < 1) {
    console.error(`Invalid --runs: ${out.runs}`);
    process.exit(2);
  }
  return out;
}

function printUsage() {
  process.stdout.write(
    [
      'Usage: node evals/model-quality/run-quality-ab.mjs --fixture <name> [--runs N]',
      '',
      'Options:',
      '  --fixture <name>   Fixture stem under fixtures/<name>.json (required)',
      '  --runs <N>         Runs per (model, prompt) pair (default: 5)',
      '  --out-dir <path>   Override results dir (default: evals/model-quality/results)',
      '  --dry-run          Resolve auth + load fixture, but do not call the API',
      '',
      'Auth: set WIZARD_OAUTH_TOKEN (preferred) or ANTHROPIC_API_KEY.',
      '',
    ].join('\n'),
  );
}

// `streamText` exposes several lazy promises (`text`, `finishReason`,
// `usage`). When a stream rejects (e.g. retry-exhausted 429) and the
// caller only awaits `textStream`, the others become unhandled
// rejections that kill Node before we can write the results file.
// Log them so a flake doesn't lose a multi-minute harness run.
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error(`# unhandled rejection (suppressed): ${msg.slice(0, 240)}`);
});

async function main() {
  const args = parseArgs(process.argv);
  const fixturePath = pathResolve(
    HERE,
    'fixtures',
    `${args.fixture}.json`,
  );
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

  const auth = resolveHarnessAuth();
  if (!auth && !args.dryRun) {
    console.error(
      'No auth available. Set WIZARD_OAUTH_TOKEN (gateway) or ANTHROPIC_API_KEY (direct).',
    );
    process.exit(3);
  }

  const runId = `${fixture.callSite}-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const outDir = args.outDir ? pathResolve(args.outDir) : join(HERE, 'results');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${runId}.jsonl`);

  console.error(`# fixture: ${fixturePath}`);
  console.error(`# auth:    ${auth ? auth.kind : '(dry-run, none)'}`);
  console.error(`# runs:    ${args.runs} per (model, prompt)`);
  console.error(`# results: ${outPath}`);
  console.error(`# rubric:  ${fixture.rubricVersion}`);

  if (args.dryRun) {
    process.stdout.write(`${outPath}\n`);
    return;
  }

  // Dynamic-import the AI SDK so a missing dep can be diagnosed
  // before we touch the network. Mirrors the production call sites'
  // dynamic-import pattern.
  const [{ streamText }, { createAnthropic }] = await Promise.all([
    import('ai'),
    import('@ai-sdk/anthropic'),
  ]);
  const deps = { streamText, createAnthropic };
  const authForRunner = authToRunnerShape(auth);

  const lines = [];
  // Header line so consumers can verify rubric version + run config
  // before parsing per-row data.
  lines.push(
    JSON.stringify({
      type: 'header',
      runId,
      fixture: fixture.callSite,
      rubricVersion: fixture.rubricVersion,
      runs: args.runs,
      authKind: auth.kind,
      startedAt: new Date().toISOString(),
    }),
  );

  let firstCall = true;
  for (const prompt of fixture.prompts) {
    for (const modelRole of ['haiku', 'sonnet']) {
      for (let attempt = 1; attempt <= args.runs; attempt += 1) {
        const row = await runPrompt({
          modelRole,
          userMessage: prompt.userMessage,
          system: fixture.system ?? null,
          maxOutputTokens: fixture.maxOutputTokens,
          auth: authForRunner,
          deps,
        });
        lines.push(
          JSON.stringify({
            type: 'row',
            runId,
            promptId: prompt.id,
            attempt,
            ...row,
          }),
        );
        const status = row.error ? `ERR ${row.error.slice(0, 60)}` : 'ok';
        console.error(
          `  ${prompt.id} :: ${modelRole} #${attempt} :: ${status} ` +
            `(ttft=${fmtMs(row.ttftMs)} total=${fmtMs(row.totalMs)})`,
        );
        // Fail-loud smoke check: if the very first call 404s, the
        // gateway baseURL is almost certainly wrong (the AI SDK
        // appends `/messages`, the gateway expects `/v1/messages`).
        // Bailing on the first row keeps a misconfigured run from
        // burning through every prompt × model × attempt before the
        // operator notices.
        if (firstCall && row.error && /404|Not Found/i.test(row.error)) {
          throw new Error(
            `First harness call returned 404. The Vercel AI SDK posts to ` +
              `\`\${baseURL}/messages\`; the Amplitude gateway expects ` +
              `\`/v1/messages\`. Resolved baseURL was ` +
              `${authForRunner.baseURL ?? '(none)'}. ` +
              `Original error: ${row.error}`,
          );
        }
        firstCall = false;
      }
    }
  }

  lines.push(
    JSON.stringify({
      type: 'footer',
      runId,
      finishedAt: new Date().toISOString(),
    }),
  );
  writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  process.stdout.write(`${outPath}\n`);
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return 'n/a';
  return `${Math.round(ms)}ms`;
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack ? err.stack : err);
  process.exit(10);
});
