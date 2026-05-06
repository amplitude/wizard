/**
 * `pnpm eval` entry point.
 *
 * Usage:
 *   pnpm eval --ring=1 --layers=0,1,2,3
 *   pnpm eval --scenario=nextjs-app-router-vanilla
 *   pnpm eval --scenario=nextjs-app-router-vanilla --layers=0,1 --seed=7
 *
 * Flag handling stays intentionally minimal — yargs-style parsers are
 * overkill for an internal tool and pull a heavy import. Promote to yargs
 * (which the wizard already depends on) once the flag surface grows past
 * five flags.
 */
import { runScenario } from '../runner/index.js';
import { ALL_SCENARIOS } from '../scenarios/index.js';
import type { LayerId, Ring, Scenario } from '../runner/types.js';

interface ParsedArgs {
  ring?: Ring;
  scenario?: string;
  layers: LayerId[];
  seed: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { layers: [0, 1, 2, 3], seed: 1 };
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith('--')) continue;
    const [key, value] = raw.slice(2).split('=', 2);
    switch (key) {
      case 'ring':
        out.ring = Number(value) as Ring;
        break;
      case 'scenario':
        out.scenario = value;
        break;
      case 'layers':
        out.layers = value
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => !Number.isNaN(n)) as LayerId[];
        break;
      case 'seed':
        out.seed = Number(value);
        break;
      default:
        process.stderr.write(`unknown flag: --${key}\n`);
        process.exit(2);
    }
  }
  return out;
}

function pickScenarios(args: ParsedArgs): Scenario[] {
  if (args.scenario) {
    const match = ALL_SCENARIOS.find((s) => s.name === args.scenario);
    if (!match) {
      throw new Error(`no scenario named ${args.scenario}`);
    }
    return [match];
  }
  if (args.ring) {
    return ALL_SCENARIOS.filter((s) => s.ring === args.ring);
  }
  throw new Error('one of --ring or --scenario is required');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const scenarios = pickScenarios(args);

  const apiKey = process.env.AMPLITUDE_EVAL_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      'AMPLITUDE_EVAL_API_KEY is required (use the eval-only project key)\n',
    );
    process.exit(2);
  }

  let anyFailed = false;
  for (const scenario of scenarios) {
    process.stderr.write(`▶ ${scenario.name} (ring ${scenario.ring})\n`);
    const summary = await runScenario({
      scenario,
      layers: args.layers,
      seed: args.seed,
      apiKey,
    });
    const status = summary.passed ? 'PASS' : 'FAIL';
    process.stderr.write(
      `  ${status}  score=${summary.totalScore}/${summary.maxScore}  hardFail=${summary.hardFail}  runId=${summary.runId}\n`,
    );
    if (!summary.passed) anyFailed = true;
  }
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(
    `eval runner failed: ${
      err instanceof Error ? err.stack ?? err.message : String(err)
    }\n`,
  );
  process.exit(1);
});
