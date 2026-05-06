/**
 * Layer 0 — criterion 8: API key must come from an env var, never a literal.
 *
 * Hard fail. The scorer greps the diffed files for both the full eval API
 * key and a 16-char prefix. A hit short-circuits all downstream scoring.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Artifact, Scorer } from '../../runner/types.js';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const scorer: Scorer = {
  id: 'L0-no-hardcoded-key',
  layer: 0,
  criterion: 8,
  evaluate(artifact: Artifact) {
    const fragment = artifact.apiKey.slice(0, 16);
    const candidates = [
      ...artifact.fsSnapshot.diff.added,
      ...artifact.fsSnapshot.diff.modified,
    ].filter((p) => isTextLike(p));

    const workingRoot = join(
      REPO_ROOT,
      'evals',
      'fixtures',
      artifact.scenarioDef.fixture,
      'working',
    );

    for (const rel of candidates) {
      let text: string;
      try {
        text = readFileSync(join(workingRoot, rel), 'utf8');
      } catch {
        continue;
      }
      if (text.includes(artifact.apiKey)) {
        return {
          id: 'L0-no-hardcoded-key',
          criterion: 8,
          pass: false,
          hardFail: true,
          detail: `${rel} contains the API key literal`,
          evidence: { path: rel },
        };
      }
      if (fragment.length >= 16 && text.includes(fragment)) {
        return {
          id: 'L0-no-hardcoded-key',
          criterion: 8,
          pass: false,
          hardFail: true,
          detail: `${rel} contains a 16-char prefix of the API key`,
          evidence: { path: rel },
        };
      }
    }

    return { id: 'L0-no-hardcoded-key', criterion: 8, pass: true };
  },
};

function isTextLike(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|json|env|envrc|md|html|css|swift|kt|java|py|rb|go|toml|yaml|yml)$/i.test(
    path,
  );
}

export default scorer;
