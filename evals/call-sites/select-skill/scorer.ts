/**
 * Scorer for the `select_skill` call site (Tier-2 `load_skill`).
 *
 * Per MIGRATION_PLAN.md §7.4 the scorer asserts:
 *
 *   1. The agent picks an ID that exists in the menu (no
 *      hallucinated skill IDs — the model is allowed to decline,
 *      but it cannot invent).
 *   2. When the menu contains a skill that matches the phase +
 *      framework pair, the agent selects it (or a closely-prefixed
 *      one). When no match exists, the agent declines (`null` /
 *      missing `selectedSkillId`) rather than picking blindly.
 *
 * The "closely-prefixed" rule is intentional: skill IDs are
 * `<category>/<framework>` and we don't want a brittle exact-match
 * test that fails when a fixture's phase is `instrumentation` and
 * any `instrumentation/*` skill is acceptable.
 */

import type {
  CallSiteArtifact,
  CallSiteFixture,
  CallSiteScorer,
  ScorerResult,
} from '../types.js';

interface MenuEntry {
  id: string;
  title: string;
}

interface SelectSkillInput {
  phase: string;
  framework?: string;
  menu: MenuEntry[];
}

interface SelectSkillOutput {
  selectedSkillId?: string | null;
  rationale?: string;
}

function isSelectSkillInput(x: unknown): x is SelectSkillInput {
  if (!x || typeof x !== 'object') return false;
  const o = x as { phase?: unknown; menu?: unknown };
  return typeof o.phase === 'string' && Array.isArray(o.menu);
}

function isSelectSkillOutput(x: unknown): x is SelectSkillOutput {
  if (!x || typeof x !== 'object') return false;
  return true; // tolerate `selectedSkillId: null` and missing fields
}

export const scorer: CallSiteScorer = {
  id: 'CS-select-skill-in-menu',
  layer: 1,
  description:
    '`select_skill` must pick an ID that exists in the menu, prefer a phase+framework match when one exists, or decline cleanly when no skill applies.',
  evaluate(artifact: CallSiteArtifact, fixture: CallSiteFixture): ScorerResult {
    if (!isSelectSkillInput(fixture.input)) {
      return {
        pass: false,
        weight: 10,
        detail: 'fixture.input did not match { phase, menu } shape',
      };
    }
    if (!isSelectSkillOutput(artifact.output)) {
      return {
        pass: false,
        weight: 10,
        detail: 'output did not match { selectedSkillId, rationale } shape',
      };
    }

    const { phase, framework, menu } = fixture.input;
    const { selectedSkillId } = artifact.output;
    const menuIds = new Set(menu.map((m) => m.id));

    // Decline path: when the menu has no plausible match for the
    // phase+framework pair, missing/null is the right answer.
    const plausibleMatches = menu.filter((m) => {
      if (!m.id.startsWith(`${phase}/`)) return false;
      if (framework && m.id.slice(phase.length + 1) !== framework) return false;
      return true;
    });
    const hasPlausibleMatch = plausibleMatches.length > 0;

    if (selectedSkillId === null || selectedSkillId === undefined) {
      if (hasPlausibleMatch) {
        return {
          pass: false,
          weight: 10,
          detail: `agent declined to select a skill but the menu had ${plausibleMatches.length} plausible match(es)`,
        };
      }
      return { pass: true, weight: 10 };
    }

    if (!menuIds.has(selectedSkillId)) {
      return {
        pass: false,
        weight: 10,
        detail: `selectedSkillId="${selectedSkillId}" is not in the menu (hallucinated)`,
      };
    }

    if (hasPlausibleMatch) {
      const isPlausible = plausibleMatches.some(
        (m) => m.id === selectedSkillId,
      );
      if (!isPlausible) {
        return {
          pass: false,
          weight: 10,
          detail: `selectedSkillId="${selectedSkillId}" is in the menu but ignores the phase=${phase}/framework=${
            framework ?? '<any>'
          } match (${plausibleMatches.map((m) => m.id).join(', ')})`,
        };
      }
    }

    return { pass: true, weight: 10 };
  },
};
