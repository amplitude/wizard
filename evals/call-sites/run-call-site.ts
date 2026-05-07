/**
 * `runCallSite` — third invocation mode alongside `runLive` /
 * `runReplay` from `evals/runner/invoke-wizard.ts`.
 *
 * Per MIGRATION_PLAN.md §7.4, call-site evals share the runner with
 * end-to-end scenarios. The two modes diverge only in *how* the
 * `Artifact`-shaped envelope is produced:
 *
 *   - `runLive` / `runReplay` (PR #560)   — spawn the wizard or
 *      load a pre-recorded scenario. Whole-wizard granularity.
 *   - `runCallSite` (this module)         — execute or replay one
 *      LLM call. Per-call-site granularity.
 *
 * **Live LLM calls live behind a flag.** This module never imports
 * `@anthropic-ai/sdk` or the Amplitude gateway client. Live capture
 * for streaming sites is documented in `evals/call-sites/README.md`
 * and runs out-of-band (it requires `WIZARD_OAUTH_TOKEN` and is
 * gated to internal-branch CI per §7.5). The unit-test path uses
 * `runCallSite` with a mock invoker — the scorer judges artifacts,
 * not models.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CallSite } from './registry.js';
import { resolveCallSitePath } from './registry.js';
import type { CallSiteArtifact, CallSiteFixture } from './types.js';

function newRunId(): string {
  return `cs-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * Source modes for a call-site run, mirroring `Artifact.source`.
 *
 *   - `golden` — load `recordedOutput` from the fixture (or
 *     `golden.ndjson` next door for streaming sites).
 *   - `mock`   — the caller supplied an in-memory invoker (used by
 *     unit tests; the "no live LLM in unit-test path" rule).
 *   - `live`   — invoke the LLM gateway. NEVER reachable from the
 *     unit-test path; the caller must supply a `liveInvoker` fn and
 *     the runner will refuse to run live without `WIZARD_OAUTH_TOKEN`.
 */
export type CallSiteSource = 'golden' | 'mock' | 'live';

export interface RunCallSiteOptions {
  callSite: CallSite;
  /**
   * Override the fixture path (resolves relative to repo root).
   * Defaults to `callSite.fixture` from the registry.
   */
  fixturePathOverride?: string;
  /** Repo root for path resolution. Auto-detected when omitted. */
  repoRoot?: string;
  source: CallSiteSource;
  /**
   * Required when `source === 'mock'`. Returns the model output the
   * scorer will judge. Synchronous only — keep the unit-test path
   * deterministic.
   */
  mockInvoker?: (fixture: CallSiteFixture) => unknown;
  /**
   * Required when `source === 'live'`. Wrappers around live LLM
   * calls live in caller-side code so this module never imports the
   * gateway client. The runner refuses to run live without a token.
   */
  liveInvoker?: (fixture: CallSiteFixture) => Promise<unknown>;
}

/**
 * Read + parse a fixture from disk. Throws when the file is missing
 * or the JSON shape is wrong — better than handing a malformed
 * fixture to a scorer and getting a confused failure.
 */
export function loadFixture(
  callSite: CallSite,
  options: { fixturePathOverride?: string; repoRoot?: string } = {},
): CallSiteFixture {
  const repoRoot =
    options.repoRoot ??
    resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
  const path = options.fixturePathOverride
    ? resolve(repoRoot, options.fixturePathOverride)
    : resolveCallSitePath(callSite.fixture, repoRoot);
  if (!existsSync(path)) {
    throw new Error(`call-site fixture missing: ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as CallSiteFixture;
  if (!raw.id || !raw.callSiteId || !raw.kind) {
    throw new Error(
      `call-site fixture malformed (missing id/callSiteId/kind): ${path}`,
    );
  }
  if (raw.callSiteId !== callSite.id) {
    throw new Error(
      `call-site fixture mismatch: registry id=${callSite.id} but fixture targets ${raw.callSiteId}`,
    );
  }
  return raw;
}

/**
 * Load the golden NDJSON next to a streaming-site fixture and parse
 * it as a sequence of objects. Returns an empty array when the file
 * is absent — the scorer can decide whether absence is a fail.
 */
export function loadGoldenNdjson(
  callSite: CallSite,
  repoRoot?: string,
): unknown[] {
  if (!callSite.golden) return [];
  const path = resolveCallSitePath(callSite.golden, repoRoot);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, idx) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (err) {
        throw new Error(
          `golden.ndjson line ${idx + 1} is not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
          { cause: err },
        );
      }
    });
}

/**
 * Build a `CallSiteArtifact` from a fixture + invocation outcome.
 * Pure with respect to filesystem; all I/O is the caller's job (so
 * the unit-test path stays mock-only).
 */
export async function runCallSite(
  options: RunCallSiteOptions,
): Promise<CallSiteArtifact> {
  const fixture = loadFixture(options.callSite, {
    fixturePathOverride: options.fixturePathOverride,
    repoRoot: options.repoRoot,
  });

  let output: unknown;
  switch (options.source) {
    case 'golden': {
      // Streaming sites pull from golden.ndjson; structured sites
      // pull from the fixture's recordedOutput.
      if (fixture.kind === 'streaming') {
        output = loadGoldenNdjson(options.callSite, options.repoRoot);
      } else {
        if (fixture.recordedOutput === undefined) {
          throw new Error(
            `golden replay requested but fixture ${fixture.id} has no recordedOutput`,
          );
        }
        output = fixture.recordedOutput;
      }
      break;
    }
    case 'mock': {
      if (!options.mockInvoker) {
        throw new Error(`mock source requires mockInvoker`);
      }
      output = options.mockInvoker(fixture);
      break;
    }
    case 'live': {
      // Live mode requires gateway auth per §7.5 / `evals/README.md`.
      // We refuse to silently fall back; the caller must opt in.
      if (!process.env.WIZARD_OAUTH_TOKEN) {
        throw new Error(
          'runCallSite live mode requires WIZARD_OAUTH_TOKEN. See evals/call-sites/README.md.',
        );
      }
      if (!options.liveInvoker) {
        throw new Error(`live source requires liveInvoker`);
      }
      output = await options.liveInvoker(fixture);
      break;
    }
    default: {
      throw new Error(`unknown source: ${options.source as string}`);
    }
  }

  return {
    runId: newRunId(),
    fixtureId: fixture.id,
    callSiteId: fixture.callSiteId,
    finishedAt: new Date().toISOString(),
    source: options.source,
    output,
  };
}
