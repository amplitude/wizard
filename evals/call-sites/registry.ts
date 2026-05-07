/**
 * Per-call-site eval registry (MIGRATION_PLAN.md §7.4).
 *
 * Every LLM call in the wizard ships with a fixture, scorer, and
 * (where applicable) golden response. The registry maps a stable
 * call-site ID to those three artifacts plus a pointer back to the
 * source-code location of the call. CI uses the registry to decide
 * which call-site fixture suites to run when a PR touches LLM code.
 *
 * Design alignment with PR #560:
 *   - Registry entries name fixture/golden/scorer paths only.
 *   - `evals/runner/score.ts` keeps a single Scorer interface — this
 *     module never invents a parallel scorer shape.
 *   - The artifact source path is `runCallSite` in
 *     `evals/runner/invoke-wizard.ts`; both end-to-end scenarios and
 *     per-call-site fixtures feed the same `score()` function.
 *
 * Adding a call site:
 *   1. Drop the three artifacts under `evals/call-sites/<id>/`.
 *   2. Append a `CallSite` to `CALL_SITES` below.
 *   3. Add the source-file path to `CALL_SITE_SOURCE_GLOBS` so the CI
 *      gating workflow runs the suite when the file changes.
 *   4. List the call-site ID in the PR description (the PR template
 *      enforces this for changes that touch LLM call sites).
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Model tiering — mirrors `selectModel` mode in the agent runner.
 *
 *   - `oneshot`  — a single structured-output call (`generateObject`
 *                  or a one-shot `generateText`). Mock-only evaluation
 *                  is sufficient because the input + schema fully
 *                  determine the output shape.
 *   - `standard` — the streaming inner-loop (`streamText`). Live golden
 *                  capture needs `WIZARD_OAUTH_TOKEN`; mock-only test
 *                  paths replay a pre-recorded NDJSON slice.
 */
export type CallSiteModelTier = 'oneshot' | 'standard';

/**
 * Registry entry. Paths are repo-root-relative to keep the registry
 * portable; helpers below resolve them against the repo root.
 */
export interface CallSite {
  /**
   * Stable identifier, e.g. `propose_event_plan`. Used as the
   * directory name under `evals/call-sites/<id>/` and surfaced in CI
   * logs / PR comments.
   */
  id: string;
  /**
   * `file:line` pointing at the call. Updated when the call moves —
   * keeps blame trail short for triagers.
   */
  sourceLocation: string;
  /**
   * Which model tier the call uses. Determines whether the runner can
   * exercise it offline (`oneshot`) or whether a live capture is
   * needed (`standard`).
   */
  model: CallSiteModelTier;
  /** Path to fixture.json (repo-relative). */
  fixture: string;
  /** Path to scorer.ts (repo-relative). Default export is a `Scorer`. */
  scorer: string;
  /**
   * Path to golden.ndjson (repo-relative). Optional for
   * structured-output sites where the scorer asserts shape rather
   * than wire-equality.
   */
  golden?: string;
  /** Free-form note for triagers. */
  notes?: string;
}

/**
 * Glob patterns over repo files that, when changed, should trigger a
 * given call-site's eval suite. Used by `evals-pr.yml` to decide which
 * suites to run on a PR. Keep the patterns conservative — overly
 * narrow paths leak regressions, overly wide paths burn CI minutes.
 */
export const CALL_SITE_SOURCE_GLOBS: Record<string, string[]> = {
  propose_event_plan: [
    'src/lib/wizard-tools.ts',
    'src/lib/wizard-tools/**',
    'src/lib/commandments.ts',
    'skills/instrumentation/**',
    'skills/taxonomy/**',
  ],
  select_skill: [
    'src/lib/agent/skill-tier-prompt.ts',
    'src/lib/wizard-tools/bundled-skills.ts',
    'skills/integration/**/SKILL.md',
    'skills/instrumentation/**/SKILL.md',
    'skills/taxonomy/**/SKILL.md',
  ],
  'inner-loop-streamtext': [
    'src/lib/agent-runner.ts',
    'src/lib/agent-interface.ts',
    'src/lib/agent/**',
    'src/lib/commandments.ts',
  ],
};

/**
 * The registry. Three call sites covered as proof per §7.4 bootstrap:
 *
 *   1. `propose_event_plan` (#553's wizard-tools surface; structured
 *       output, no golden NDJSON — scorer asserts shape).
 *   2. `select_skill`       (Tier-2 `load_skill` decision; structured
 *       choice from the menu).
 *   3. `inner-loop-streamtext` (the main agent loop, post-D-3; layered
 *       L0/L1 scorers on the NDJSON slice).
 */
export const CALL_SITES: CallSite[] = [
  {
    id: 'propose_event_plan',
    sourceLocation: 'src/lib/wizard-tools.ts:1558',
    model: 'oneshot',
    fixture: 'evals/call-sites/propose-event-plan/fixture.json',
    scorer: 'evals/call-sites/propose-event-plan/scorer.ts',
    notes:
      'Structured output. Scorer asserts ≤ 25 events, all snake_case names, no obviously hallucinated names (no "click", "trigger", "do_thing").',
  },
  {
    id: 'select_skill',
    sourceLocation: 'src/lib/agent/skill-tier-prompt.ts:1',
    model: 'oneshot',
    fixture: 'evals/call-sites/select-skill/fixture.json',
    scorer: 'evals/call-sites/select-skill/scorer.ts',
    notes:
      'Tier-2 load_skill decision. Scorer asserts the chosen skill ID is in the menu (or that no skill was chosen when none applies).',
  },
  {
    id: 'inner-loop-streamtext',
    sourceLocation: 'src/lib/agent-runner.ts:1',
    model: 'standard',
    fixture: 'evals/call-sites/inner-loop-streamtext/fixture.json',
    scorer: 'evals/call-sites/inner-loop-streamtext/scorer.ts',
    golden: 'evals/call-sites/inner-loop-streamtext/golden.ndjson',
    notes:
      'Streaming site. Live golden capture requires WIZARD_OAUTH_TOKEN; the bundled golden is a minimal smoke artifact. Re-record once §7.5 wizard-side OAuth wiring lands.',
  },
];

/**
 * Look up a call site by ID. Throws when the ID is unknown so callers
 * can't silently skip a regression-prevention suite.
 */
export function getCallSite(id: string): CallSite {
  const found = CALL_SITES.find((c) => c.id === id);
  if (!found) {
    const known = CALL_SITES.map((c) => c.id).join(', ');
    throw new Error(`unknown call-site id: ${id}. Known: ${known}`);
  }
  return found;
}

/**
 * Resolve a registry path to an absolute filesystem path. Use the
 * supplied `repoRoot`, or auto-detect from this module's URL when
 * omitted (the registry lives at `<repoRoot>/evals/call-sites/`).
 */
export function resolveCallSitePath(
  relPath: string,
  repoRoot?: string,
): string {
  const root =
    repoRoot ??
    resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
  return resolve(root, relPath);
}

/**
 * Sanity-check that every registered call site has the artifacts it
 * claims. Used by the registry self-test to catch a CALL_SITES entry
 * whose fixture/scorer/golden was deleted or moved.
 */
export function assertCallSiteArtifactsExist(repoRoot?: string): void {
  const missing: string[] = [];
  for (const cs of CALL_SITES) {
    const fixture = resolveCallSitePath(cs.fixture, repoRoot);
    const scorer = resolveCallSitePath(cs.scorer, repoRoot);
    if (!existsSync(fixture)) missing.push(`${cs.id}: missing ${cs.fixture}`);
    if (!existsSync(scorer)) missing.push(`${cs.id}: missing ${cs.scorer}`);
    if (cs.golden) {
      const golden = resolveCallSitePath(cs.golden, repoRoot);
      if (!existsSync(golden)) missing.push(`${cs.id}: missing ${cs.golden}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `call-site registry artifacts missing:\n  ${missing.join('\n  ')}`,
    );
  }
}
