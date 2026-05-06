/**
 * Negative-control tests — proof that the suite catches the
 * regressions it was built to catch. Each test forks the existing
 * Next.js App Router golden into a tmpdir, applies a deliberate
 * regression, and asserts the full scorer stack reports the failure
 * shape we expect (hard fail, contract violation, or score drop).
 *
 * If a future scorer change makes one of these tests pass on a
 * still-broken integration, it's a regression in the SUITE, not in
 * the wizard. Run these in CI alongside the success-path runner
 * test — they're cheap and form the canary that the eval framework
 * itself is doing its job.
 */

import {
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runReplay } from '../../runner/invoke-wizard.js';
import { parseScenario } from '../../runner/scenario-schema.js';
import { score } from '../../runner/score.js';

const sourceDir = resolve(
  __dirname,
  '..',
  '..',
  'scenarios',
  'nextjs-app-router',
  'vanilla',
);

let scratchDir: string;

beforeEach(() => {
  scratchDir = join(
    tmpdir(),
    `evals-negative-control-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  );
  cpSync(sourceDir, scratchDir, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(scratchDir, { recursive: true });
  } catch {
    /* ignore */
  }
});

function runFullStack() {
  const scenario = parseScenario(
    JSON.parse(readFileSync(join(scratchDir, 'scenario.json'), 'utf8')),
  );
  const { artifact, workingDir } = runReplay({
    scenario,
    scenarioDir: scratchDir,
  });
  return score({ artifact, scenario, workingDir });
}

describe('negative controls — suite catches deliberate regressions', () => {
  it('hard-fails when @amplitude/unified is replaced with @amplitude/analytics-browser', () => {
    // Browser frameworks must use @amplitude/unified per the project
    // rule. Substituting the analytics-browser package is the
    // canonical "wrong family" regression — Layer 0 must catch it.
    const pkgPath = join(scratchDir, 'golden', 'working', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    delete pkg.dependencies['@amplitude/unified'];
    pkg.dependencies['@amplitude/analytics-browser'] = '^2.0.0';
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

    const report = runFullStack();
    expect(report.hardFailed).toBe(true);
    const offending = report.scores.find(
      (s) => s.scorerId === 'L0-correct-sdk-package',
    );
    expect(offending?.result.pass).toBe(false);
    expect(offending?.result.detail).toMatch(/analytics-browser/);
  });

  it('hard-fails when the API key is hardcoded in the entry file', () => {
    // Set an env-derived key so the L0-no-hardcoded-key scorer has
    // something to grep for, then plant the literal in the file.
    const originalKey = process.env.AMPLITUDE_EVAL_API_KEY;
    try {
      const fakeKey = 'eval-fixture-' + 'q'.repeat(20);
      process.env.AMPLITUDE_EVAL_API_KEY = fakeKey;

      const layoutPath = join(
        scratchDir,
        'golden',
        'working',
        'src',
        'app',
        'AmplitudeProvider.tsx',
      );
      const layout = readFileSync(layoutPath, 'utf8');
      writeFileSync(
        layoutPath,
        layout.replace(
          'const apiKey = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;',
          `const apiKey = '${fakeKey}';`,
        ),
      );

      const report = runFullStack();
      expect(report.hardFailed).toBe(true);
      const offending = report.scores.find(
        (s) => s.scorerId === 'L0-no-hardcoded-key',
      );
      expect(offending?.result.pass).toBe(false);
    } finally {
      if (originalKey === undefined) delete process.env.AMPLITUDE_EVAL_API_KEY;
      else process.env.AMPLITUDE_EVAL_API_KEY = originalKey;
    }
  });

  it('fails Layer 1 when a confirmed event has no track() call', () => {
    // The golden's run.ndjson confirms ['Page Viewed', 'Sign Up',
    // 'Sign In']. Strip 'Sign In' from the source files but keep it
    // in the proposed plan — L1-confirmed-events-tracked must catch.
    const homePath = join(
      scratchDir,
      'golden',
      'working',
      'src',
      'app',
      'page.tsx',
    );
    if (existsSync(homePath)) {
      const text = readFileSync(homePath, 'utf8');
      writeFileSync(
        homePath,
        text.replaceAll(/track\(['"]Sign In['"][^)]*\);?/g, ''),
      );
    }
    const examplePath = join(
      scratchDir,
      'golden',
      'working',
      'src',
      'app',
      'example',
      'page.tsx',
    );
    if (existsSync(examplePath)) {
      const text = readFileSync(examplePath, 'utf8');
      writeFileSync(
        examplePath,
        text.replaceAll(/track\(['"]Sign In['"][^)]*\);?/g, ''),
      );
    }

    const report = runFullStack();
    const offending = report.scores.find(
      (s) => s.scorerId === 'L1-confirmed-events-tracked',
    );
    expect(offending?.result.pass).toBe(false);
    expect(offending?.result.detail).toMatch(/Sign In/);
  });
});
