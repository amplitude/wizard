/**
 * Failure-mode tests for the Layer 2 static scorers.
 *
 * The runner.test.ts integration test validates the success path
 * against the existing golden. Here we synthesize artifacts that
 * trip each scorer to confirm the negative path actually fires.
 *
 * Fixtures live under `evals/scorers/__tests__/__fixtures__/` so
 * scorers can stat real files via EVALS_WORKING_DIR. Tests set
 * EVALS_WORKING_DIR per assertion and tear down in `afterEach`.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Write a file and mkdir its parent if missing. */
function writeFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scorer as serverClientBoundary } from '../layer2-static/server-client-boundary.js';
import { scorer as serverSdkUsage } from '../layer2-static/server-sdk-usage.js';
import { scorer as initOptionsCommented } from '../layer2-static/init-options-commented.js';
import { scorer as versionRange } from '../layer2-static/version-range.js';
import { scorer as noVendorAdditions } from '../layer2-static/no-vendor-additions.js';
import { scorer as propertyKeyNaming } from '../layer2-static/property-key-naming.js';
import type { Artifact, Scenario } from '../../runner/types.js';

const NEXTJS_SCENARIO: Scenario = {
  name: 'test/nextjs',
  ring: 1,
  integrationHint: 'nextjs',
  buildCommand: ['pnpm', 'build'],
  expectedEnvPrefix: 'NEXT_PUBLIC_',
  expectedInitFile: 'src/app/AmplitudeProvider.tsx',
  expectedEvents: ['Page Viewed'],
  forbiddenPaths: [],
};

const baseArtifact: Omit<Artifact, 'fsSnapshot'> = {
  runId: 'run-test',
  scenario: 'test',
  ring: 1,
  startedAt: '2026-05-06T12:00:00Z',
  finishedAt: '2026-05-06T12:00:01Z',
  exitCode: 0,
  runLog: [],
  stderr: '',
  source: 'live',
};

function artifactWithDiff(added: string[], modified: string[] = []): Artifact {
  return {
    ...baseArtifact,
    fsSnapshot: { files: {}, diff: { added, modified, deleted: [] } },
  };
}

let workingDir: string;
let pristineDir: string;

beforeEach(() => {
  const root = join(
    tmpdir(),
    `evals-l2-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(root, { recursive: true });
  // Place pristine alongside `working/` so the `findPristine` helper
  // in no-vendor-additions can locate it.
  pristineDir = join(root, 'pristine');
  workingDir = join(root, 'working');
  mkdirSync(pristineDir, { recursive: true });
  mkdirSync(workingDir, { recursive: true });
  process.env.EVALS_WORKING_DIR = workingDir;
});

afterEach(() => {
  delete process.env.EVALS_WORKING_DIR;
  // Best-effort cleanup of the test scratch dir.
  try {
    rmSync(workingDir, { recursive: true });
    rmSync(pristineDir, { recursive: true });
  } catch {
    /* ignore */
  }
});

describe('L2 server-client-boundary', () => {
  it('hard-fails when a Server Component imports the browser SDK', () => {
    const path = 'app/posts/page.tsx';
    mkdirSync(join(workingDir, 'app/posts'), { recursive: true });
    // No 'use client' directive → Server Component by default.
    writeFile(
      join(workingDir, path),
      `import { track } from '@amplitude/unified';\nexport default function Page() { track('Page Viewed'); return null; }\n`,
    );
    const r = serverClientBoundary.evaluate(
      artifactWithDiff([path]),
      NEXTJS_SCENARIO,
    );
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/server-only/);
  });

  it('passes when the same import is in a `use client` file', () => {
    const path = 'app/posts/page.tsx';
    mkdirSync(join(workingDir, 'app/posts'), { recursive: true });
    writeFile(
      join(workingDir, path),
      `'use client';\nimport { track } from '@amplitude/unified';\nexport default function Page() { return null; }\n`,
    );
    const r = serverClientBoundary.evaluate(
      artifactWithDiff([path]),
      NEXTJS_SCENARIO,
    );
    expect(r.pass).toBe(true);
  });

  it('passes the heavy weight as no-op for non-App-Router scenarios', () => {
    const r = serverClientBoundary.evaluate(artifactWithDiff([]), {
      ...NEXTJS_SCENARIO,
      integrationHint: 'vue',
    });
    expect(r.pass).toBe(true);
    expect(r.weight).toBe(10);
  });
});

describe('L2 server-sdk-usage', () => {
  it('fails when an api route uses the browser SDK only', () => {
    const path = 'app/api/track/route.ts';
    mkdirSync(join(workingDir, 'app/api/track'), { recursive: true });
    writeFile(
      join(workingDir, path),
      `import { track } from '@amplitude/unified';\nexport async function POST() { track('hi'); return new Response(); }\n`,
    );
    const r = serverSdkUsage.evaluate(
      artifactWithDiff([path]),
      NEXTJS_SCENARIO,
    );
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/analytics-node/);
  });

  it('passes when an api route uses the node SDK', () => {
    const path = 'app/api/track/route.ts';
    mkdirSync(join(workingDir, 'app/api/track'), { recursive: true });
    writeFile(
      join(workingDir, path),
      `import { track } from '@amplitude/analytics-node';\nexport async function POST() { track('hi'); return new Response(); }\n`,
    );
    const r = serverSdkUsage.evaluate(
      artifactWithDiff([path]),
      NEXTJS_SCENARIO,
    );
    expect(r.pass).toBe(true);
  });
});

describe('L2 init-options-commented', () => {
  it('fails when init options have no comments', () => {
    const path = 'src/app/AmplitudeProvider.tsx';
    mkdirSync(join(workingDir, 'src/app'), { recursive: true });
    writeFile(
      join(workingDir, path),
      `import { init } from '@amplitude/unified';\nexport function go() { init('k', { autocapture: true, defaultTracking: false }); }\n`,
    );
    const r = initOptionsCommented.evaluate(
      artifactWithDiff([path]),
      NEXTJS_SCENARIO,
    );
    expect(r.pass).toBe(false);
  });

  it('passes when at least one option has a leading comment', () => {
    const path = 'src/app/AmplitudeProvider.tsx';
    writeFile(
      join(workingDir, path),
      [
        `import { init } from '@amplitude/unified';`,
        `export function go() {`,
        `  init('k', {`,
        `    // auto-capture page views`,
        `    autocapture: true,`,
        `  });`,
        `}`,
      ].join('\n'),
    );
    const r = initOptionsCommented.evaluate(
      artifactWithDiff([path]),
      NEXTJS_SCENARIO,
    );
    expect(r.pass).toBe(true);
  });
});

describe('L2 version-range', () => {
  it('fails on a wildcard major', () => {
    writeFile(
      join(workingDir, 'package.json'),
      JSON.stringify({
        dependencies: { '@amplitude/unified': '*' },
      }),
    );
    const r = versionRange.evaluate(artifactWithDiff([]), NEXTJS_SCENARIO);
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/wildcard/);
  });

  it('fails on a pre-release tag', () => {
    writeFile(
      join(workingDir, 'package.json'),
      JSON.stringify({
        dependencies: { '@amplitude/unified': '1.2.3-beta.0' },
      }),
    );
    const r = versionRange.evaluate(artifactWithDiff([]), NEXTJS_SCENARIO);
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/pre-release/);
  });

  it('passes on a caret-pinned version', () => {
    writeFile(
      join(workingDir, 'package.json'),
      JSON.stringify({
        dependencies: { '@amplitude/unified': '^1.0.0' },
      }),
    );
    const r = versionRange.evaluate(artifactWithDiff([]), NEXTJS_SCENARIO);
    expect(r.pass).toBe(true);
  });
});

describe('L2 no-vendor-additions', () => {
  it('fails when a non-vendor dep was added', () => {
    writeFile(
      join(pristineDir, 'package.json'),
      JSON.stringify({
        dependencies: { next: '15.0.0', react: '18.0.0' },
      }),
    );
    writeFile(
      join(workingDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          next: '15.0.0',
          react: '18.0.0',
          uuid: '^9.0.0',
        },
      }),
    );
    const r = noVendorAdditions.evaluate(artifactWithDiff([]), NEXTJS_SCENARIO);
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/uuid/);
  });

  it('passes when only Amplitude vendor was added', () => {
    writeFile(
      join(pristineDir, 'package.json'),
      JSON.stringify({
        dependencies: { next: '15.0.0' },
      }),
    );
    writeFile(
      join(workingDir, 'package.json'),
      JSON.stringify({
        dependencies: { next: '15.0.0', '@amplitude/unified': '^1.0.0' },
      }),
    );
    const r = noVendorAdditions.evaluate(artifactWithDiff([]), NEXTJS_SCENARIO);
    expect(r.pass).toBe(true);
  });
});

describe('L2 property-key-naming', () => {
  it('warns when keys are camelCase', () => {
    const path = 'src/track-helper.ts';
    writeFile(
      join(workingDir, path),
      `import { track } from '@amplitude/unified';\ntrack('Page Viewed', { pageName: '/', userId: 'x' });\n`,
    );
    const r = propertyKeyNaming.evaluate(
      artifactWithDiff([path]),
      NEXTJS_SCENARIO,
    );
    // Soft warn — pass is true regardless, but detail is populated.
    expect(r.pass).toBe(true);
    expect(r.detail).toMatch(/pageName|userId/);
  });

  it('passes silently when keys follow the convention', () => {
    const path = 'src/track-helper.ts';
    writeFile(
      join(workingDir, path),
      `import { track } from '@amplitude/unified';\ntrack('Page Viewed', { 'page name': '/', 'user id': 'x' });\n`,
    );
    const r = propertyKeyNaming.evaluate(
      artifactWithDiff([path]),
      NEXTJS_SCENARIO,
    );
    expect(r.pass).toBe(true);
    expect(r.detail).toBeUndefined();
  });
});
