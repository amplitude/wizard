/**
 * Layer 1, criterion 9 — env var prefix matches the framework.
 *
 * Medium (5 pts). Reads `setup_complete.envVars` from the run log
 * (canonical source) and falls back to scanning .env / .env.local in
 * the diff. Asserts every Amplitude-related env var name uses the
 * framework's expected prefix (e.g. `NEXT_PUBLIC_AMPLITUDE_API_KEY`).
 *
 * Why both sources: the wizard emits `setup_complete.envVars` as the
 * authoritative list, but for golden replays where envVars wasn't
 * recorded we want a fallback so the scorer still produces signal.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SetupCompleteData } from '../../../src/lib/agent-events.js';
import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.production'];
const ENV_KEY_LINE = /^([A-Z0-9_]+)\s*=/;

function extractEnvVarsFromSetupComplete(artifact: Artifact): string[] {
  const out: string[] = [];
  for (const env of artifact.runLog) {
    const data = env.data as SetupCompleteData | undefined;
    if (data?.event === 'setup_complete') {
      out.push(...(data.envVars?.added ?? []));
      out.push(...(data.envVars?.modified ?? []));
    }
  }
  return out;
}

function extractEnvVarsFromDotEnv(artifact: Artifact, root: string): string[] {
  const out: string[] = [];
  const candidates = [
    ...artifact.fsSnapshot.diff.added,
    ...artifact.fsSnapshot.diff.modified,
  ].filter((p) => ENV_FILES.some((env) => p === env || p.endsWith(`/${env}`)));
  for (const path of candidates) {
    let text: string;
    try {
      text = readFileSync(join(root, path), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(ENV_KEY_LINE);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

export const scorer: Scorer = {
  id: 'L1-env-var-prefix',
  layer: 1,
  criterion: 9,
  description: 'Amplitude env vars must use the framework-correct prefix.',
  evaluate(artifact: Artifact, scenario: Scenario) {
    const root = process.env.EVALS_WORKING_DIR ?? '';

    let names = extractEnvVarsFromSetupComplete(artifact);
    if (names.length === 0 && root) {
      names = extractEnvVarsFromDotEnv(artifact, root);
    }
    // Filter to env var names that look Amplitude-related — anything
    // mentioning AMPLITUDE in the name. Avoids false-flagging the
    // user's other env vars.
    const amplitudeVars = names.filter((n) => /AMPLITUDE/i.test(n));
    if (amplitudeVars.length === 0) {
      return {
        pass: false,
        weight: 5,
        detail: 'no Amplitude env var found in setup_complete or .env files',
      };
    }
    const wrong = amplitudeVars.filter(
      (n) => !n.startsWith(scenario.expectedEnvPrefix),
    );
    if (wrong.length === 0) {
      return { pass: true, weight: 5 };
    }
    return {
      pass: false,
      weight: 5,
      detail: `env vars missing required prefix ${
        scenario.expectedEnvPrefix
      }: ${wrong.join(', ')}`,
    };
  },
};
