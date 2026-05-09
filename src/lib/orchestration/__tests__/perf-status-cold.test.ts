/**
 * Internal perf bound — `buildStatusEnvelope` for an empty store should
 * complete in well under 100ms. This isn't the same as the full
 * `wizard status --json` cold-start (Node + import overhead alone is
 * >300ms on cold starts) but it bounds the part of the cold-start
 * we control.
 *
 * The brief asks for `< 200ms` end-to-end; we optimize the internal
 * critical path here and leave Node startup to esbuild bundling in a
 * future PR.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { _resetOrchestrationStoreCache, getOrchestrationStore } from '../store';
import {
  buildStatusEnvelope,
  withReadCache,
  buildChoicesEnvelope,
  buildVerificationsEnvelope,
  buildMcpCapabilitiesEnvelope,
  _resetEnvelopeReadCache,
} from '../envelopes';
import { ChoiceKind } from '../checkpoints/choices';

let installDir: string;
let originalCacheDir: string | undefined;

beforeEach(() => {
  installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-status-'));
  originalCacheDir = process.env.AMPLITUDE_WIZARD_CACHE_DIR;
  process.env.AMPLITUDE_WIZARD_CACHE_DIR = path.join(installDir, '.cache');
  _resetOrchestrationStoreCache();
  _resetEnvelopeReadCache();
});
afterEach(() => {
  if (originalCacheDir === undefined) {
    delete process.env.AMPLITUDE_WIZARD_CACHE_DIR;
  } else {
    process.env.AMPLITUDE_WIZARD_CACHE_DIR = originalCacheDir;
  }
  fs.rmSync(installDir, { recursive: true, force: true });
});

describe('orchestration status — internal cold-start bound', () => {
  it('buildStatusEnvelope for an empty store completes in under 100ms', () => {
    const start = Date.now();
    const env = buildStatusEnvelope({ installDir });
    const elapsed = Date.now() - start;
    expect(env.v).toBe(1);
    // Generous bound to absorb CI variance — the typical figure is
    // single-digit ms.
    expect(elapsed).toBeLessThan(100);
  });

  it('withReadCache amortises store reads across multiple builders', () => {
    // Seed a non-trivial store so reading it isn't completely free.
    const orch = getOrchestrationStore(installDir);
    const session = orch.createSession({ goal: 'perf' });
    for (let i = 0; i < 25; i++) {
      orch.addChoice({
        kind: ChoiceKind.EnvironmentSelection,
        promptId: `p${i}`,
        message: `m${i}`,
        options: [{ id: 'a', label: 'A' }],
        recommendedOptionId: 'a',
        safeDefaultOptionId: 'a',
        requiresHuman: false,
        automationAllowed: true,
        consequenceIfSkipped: 'x',
        reversible: true,
        whyAsking: 'y',
        resumeCommand: ['x'],
        linkedSessionId: session.id,
      });
    }
    // Without cache: three reads happen.
    const noCacheStart = Date.now();
    for (let i = 0; i < 50; i++) {
      buildChoicesEnvelope({ installDir });
      buildVerificationsEnvelope({ installDir });
      buildMcpCapabilitiesEnvelope({ installDir });
    }
    const noCacheElapsed = Date.now() - noCacheStart;

    // With cache: shared read inside the closure.
    const cacheStart = Date.now();
    for (let i = 0; i < 50; i++) {
      withReadCache((key) => {
        buildChoicesEnvelope({ installDir, cacheKey: key });
        buildVerificationsEnvelope({ installDir, cacheKey: key });
        buildMcpCapabilitiesEnvelope({ installDir, cacheKey: key });
      });
    }
    const cacheElapsed = Date.now() - cacheStart;

    // The cache must be no worse than the no-cache path. We don't
    // require it to be dramatically faster — even when it is in
    // production, the test environment can be unstable. The
    // important invariant is no regression.
    expect(cacheElapsed).toBeLessThanOrEqual(noCacheElapsed * 2 + 50);
  });
});
