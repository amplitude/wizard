#!/usr/bin/env node
/**
 * Score a results JSONL file produced by `run-quality-ab.mjs`.
 *
 * Reads the rubric version from the header row and the matching
 * fixture under `fixtures/`, applies the structural scorers
 * deterministically to every output, then for each (prompt, attempt)
 * pair pits Haiku's output against Sonnet's via an LLM-judge
 * (Sonnet 4.6) and aggregates the verdicts into a keep-or-revert
 * recommendation.
 *
 * Usage:
 *   node evals/model-quality/score-quality.mjs \
 *     --results evals/model-quality/results/<run-id>.jsonl
 *
 * Options:
 *   --no-judge       Skip the LLM judge (structural-only).
 *   --judge-model    Override judge alias (default: claude-sonnet-4-6).
 *
 * The judge always uses Sonnet — judging Haiku with Haiku would
 * underweight the very gap we're trying to measure.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  scoreStructural,
  buildJudgePrompt,
  parseJudgeVerdict,
  summariseResults,
  gatewayModelString,
  median,
} from './lib/scorers.mjs';
import {
  resolveHarnessAuth,
  authToRunnerShape,
} from './lib/run-prompt.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {
    results: null,
    noJudge: false,
    judgeModel: 'claude-sonnet-4-6',
    outPath: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--results') out.results = argv[++i];
    else if (a === '--no-judge') out.noJudge = true;
    else if (a === '--judge-model') out.judgeModel = argv[++i];
    else if (a === '--out') out.outPath = argv[++i];
    else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
  }
  if (!out.results) {
    printUsage();
    process.exit(2);
  }
  return out;
}

function printUsage() {
  process.stdout.write(
    [
      'Usage: node evals/model-quality/score-quality.mjs --results <path> [opts]',
      '',
      'Options:',
      '  --results <path>   JSONL file produced by run-quality-ab.mjs (required)',
      '  --no-judge         Skip LLM-judge step (structural-only report)',
      '  --judge-model <m>  Override judge model alias (default: claude-sonnet-4-6)',
      '  --out <path>       Write JSON report to this path (default: alongside results)',
      '',
    ].join('\n'),
  );
}

function readJsonl(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  return lines.map((l) => JSON.parse(l));
}

function loadFixture(callSite) {
  const path = pathResolve(HERE, 'fixtures', `${callSite}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function judge({
  userMessage,
  haikuText,
  sonnetText,
  judgeModelGateway,
  auth,
  deps,
}) {
  // Anonymise positional bias by random A/B assignment.
  const haikuIsA = Math.random() < 0.5;
  const outputA = haikuIsA ? haikuText : sonnetText;
  const outputB = haikuIsA ? sonnetText : haikuText;
  const prompt = buildJudgePrompt({ userMessage, outputA, outputB });

  const provider = deps.createAnthropic({
    ...(auth.baseURL ? { baseURL: auth.baseURL } : {}),
    ...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
    ...(auth.authToken ? { authToken: auth.authToken } : {}),
  });

  const result = deps.streamText({
    model: provider(judgeModelGateway),
    messages: [{ role: 'user', content: prompt }],
    maxOutputTokens: 256,
  });

  let raw = '';
  for await (const part of result.textStream) raw += part;

  const verdict = parseJudgeVerdict(raw);
  const haikuScore = haikuIsA ? verdict.scoreA : verdict.scoreB;
  const sonnetScore = haikuIsA ? verdict.scoreB : verdict.scoreA;
  let winner;
  if (verdict.winner === 'tie') winner = 'tie';
  else if ((verdict.winner === 'a') === haikuIsA) winner = 'haiku';
  else winner = 'sonnet';

  return {
    haikuScore,
    sonnetScore,
    winner,
    reason: verdict.reason,
    haikuPosition: haikuIsA ? 'A' : 'B',
    rawJudgeText: raw,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const resultsPath = pathResolve(args.results);
  const records = readJsonl(resultsPath);
  const header = records.find((r) => r.type === 'header');
  if (!header) {
    console.error(`No header row in ${resultsPath}`);
    process.exit(2);
  }
  const rows = records.filter((r) => r.type === 'row');
  const fixture = loadFixture(header.fixture);

  if (header.rubricVersion !== fixture.rubricVersion) {
    console.error(
      `Rubric version mismatch: results=${header.rubricVersion} fixture=${fixture.rubricVersion}. ` +
        `Re-run the harness against the current fixture before scoring.`,
    );
    process.exit(2);
  }

  // Build prompt-id -> structural-checks map.
  const checksByPromptId = new Map(
    fixture.prompts.map((p) => [p.id, p.structuralChecks]),
  );
  const userMessageByPromptId = new Map(
    fixture.prompts.map((p) => [p.id, p.userMessage]),
  );

  // Score structural for every row.
  const scored = rows.map((row) => {
    const checks = checksByPromptId.get(row.promptId);
    if (!checks) {
      return { ...row, structural: { pass: false, failures: ['unknown promptId'] } };
    }
    const structural = scoreStructural(row.text, checks);
    return { ...row, structural };
  });

  // Group rows by (promptId, attempt) so we can pair Haiku-vs-Sonnet
  // for the judge and pit equivalent attempts against each other.
  const byPair = new Map();
  for (const row of scored) {
    const key = `${row.promptId}::${row.attempt}`;
    const bucket = byPair.get(key) ?? {};
    bucket[row.modelRole] = row;
    byPair.set(key, bucket);
  }

  let auth = null;
  let deps = null;
  if (!args.noJudge) {
    auth = resolveHarnessAuth();
    if (!auth) {
      console.error(
        'LLM judge requires WIZARD_OAUTH_TOKEN or ANTHROPIC_API_KEY. Re-run with --no-judge for structural-only.',
      );
      process.exit(3);
    }
    const [{ streamText }, { createAnthropic }] = await Promise.all([
      import('ai'),
      import('@ai-sdk/anthropic'),
    ]);
    deps = { streamText, createAnthropic };
  }

  const useDirectApiKey = auth?.kind === 'api-key' && !auth.baseURL;
  const judgeGatewayModel = gatewayModelString(args.judgeModel, useDirectApiKey);
  const authForRunner = authToRunnerShape(auth);

  const judgedRows = [];
  for (const [key, bucket] of byPair) {
    const haiku = bucket.haiku;
    const sonnet = bucket.sonnet;
    if (!haiku || !sonnet) {
      // Missing pair — record the half we have without a judge.
      if (haiku) judgedRows.push({ ...haiku, judge: null });
      if (sonnet) judgedRows.push({ ...sonnet, judge: null });
      continue;
    }

    let verdict = null;
    if (
      !args.noJudge &&
      !haiku.error &&
      !sonnet.error &&
      haiku.text &&
      sonnet.text
    ) {
      try {
        verdict = await judge({
          userMessage: userMessageByPromptId.get(haiku.promptId),
          haikuText: haiku.text,
          sonnetText: sonnet.text,
          judgeModelGateway: judgeGatewayModel,
          auth: authForRunner,
          deps,
        });
        console.error(
          `  judge ${key} -> haiku=${verdict.haikuScore} sonnet=${verdict.sonnetScore} winner=${verdict.winner}`,
        );
      } catch (err) {
        console.error(`  judge ${key} FAILED: ${err.message}`);
      }
    }

    judgedRows.push({
      ...haiku,
      judge: verdict ? { score: verdict.haikuScore, winner: verdict.winner } : null,
    });
    judgedRows.push({
      ...sonnet,
      judge: verdict ? { score: verdict.sonnetScore, winner: verdict.winner } : null,
    });
  }

  const summary = summariseResults(
    judgedRows.map((r) => ({
      model: r.modelRole,
      promptId: r.promptId,
      structural: r.structural,
      judge: r.judge,
    })),
  );

  const latency = aggregateLatency(judgedRows);

  const report = {
    runId: header.runId,
    fixture: header.fixture,
    rubricVersion: header.rubricVersion,
    judgeModel: args.noJudge ? null : args.judgeModel,
    summary,
    latency,
    rows: judgedRows.map((r) => ({
      promptId: r.promptId,
      attempt: r.attempt,
      modelRole: r.modelRole,
      modelAlias: r.modelAlias,
      structural: r.structural,
      judge: r.judge,
      ttftMs: r.ttftMs,
      totalMs: r.totalMs,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      error: r.error,
    })),
  };

  let outPath = args.outPath ?? resultsPath.replace(/\.jsonl$/, '.report.json');
  if (outPath === resultsPath) {
    outPath = resultsPath + '.report.json';
  }
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  printSummary(report);
  process.stdout.write(`${outPath}\n`);
}

function aggregateLatency(rows) {
  const buckets = { haiku: [], sonnet: [] };
  const ttft = { haiku: [], sonnet: [] };
  for (const r of rows) {
    if (r.error) continue;
    if (r.modelRole === 'haiku' || r.modelRole === 'sonnet') {
      if (Number.isFinite(r.totalMs)) buckets[r.modelRole].push(r.totalMs);
      if (Number.isFinite(r.ttftMs)) ttft[r.modelRole].push(r.ttftMs);
    }
  }
  return {
    haikuMedianTotalMs: median(buckets.haiku),
    sonnetMedianTotalMs: median(buckets.sonnet),
    haikuMedianTtftMs: median(ttft.haiku),
    sonnetMedianTtftMs: median(ttft.sonnet),
  };
}

function printSummary(report) {
  const s = report.summary;
  const l = report.latency;
  process.stderr.write(
    [
      '',
      `=== ${report.fixture} (rubric ${report.rubricVersion}) ===`,
      `Recommendation: ${s.recommendation.toUpperCase()}`,
      `Reasons: ${s.reasons.join('; ') || '(none)'}`,
      `Haiku  structural: ${s.haikuStructuralPass} pass / ${s.haikuStructuralFail} fail   ` +
        `judge median: ${s.haikuMedianJudgeScore ?? 'n/a'}   ` +
        `total p50: ${fmt(l.haikuMedianTotalMs)}ms ttft p50: ${fmt(l.haikuMedianTtftMs)}ms`,
      `Sonnet structural: ${s.sonnetStructuralPass} pass / ${s.sonnetStructuralFail} fail   ` +
        `judge median: ${s.sonnetMedianJudgeScore ?? 'n/a'}   ` +
        `total p50: ${fmt(l.sonnetMedianTotalMs)}ms ttft p50: ${fmt(l.sonnetMedianTtftMs)}ms`,
      '',
    ].join('\n'),
  );
}

function fmt(ms) {
  return ms === null || ms === undefined ? 'n/a' : Math.round(ms).toString();
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack ? err.stack : err);
  process.exit(10);
});
