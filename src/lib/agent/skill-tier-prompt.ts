/**
 * Optional system-prompt slice for AMPLITUDE_WIZARD_SKILL_TIERS=1 (Phase C).
 * Surfaces a compact id/name menu so the model can call load_skill without
 * discovering paths on disk first.
 */
import { loadBundledSkillMenu } from '../wizard-tools.js';

const MAX_SKILL_MENU_PROMPT_CHARS = 12_000;

type SkillMenuPayload = {
  categories: Record<string, { id: string; name: string }[]>;
};

function renderMenu(payload: SkillMenuPayload): string {
  return JSON.stringify(payload);
}

/**
 * Trim the menu so the rendered JSON fits within the prompt budget while
 * remaining syntactically valid. Drops entries from the largest category
 * until the menu fits; if every category has been emptied we return `null`
 * so the caller can fall back to a "menu too large" note.
 *
 * Performance: a naive "drop one, re-stringify" loop is O(N^2) on N entries
 * (each JSON.stringify walks the whole structure) and made the regression
 * test for an oversized menu flake on Node 24 in CI. Instead we estimate
 * each entry's serialized cost once, drop entries while updating a running
 * length estimate, and re-stringify only as a final correctness check.
 */
function fitMenuToBudget(payload: SkillMenuPayload): string | null {
  let rendered = renderMenu(payload);
  if (rendered.length <= MAX_SKILL_MENU_PROMPT_CHARS) return rendered;

  // Per-entry serialized length plus the comma that separates it from a
  // sibling. This over-counts by one comma per category (the last entry has
  // no trailing comma) but the final renderMenu() call below settles the
  // exact length, so the estimate just needs to be a safe upper bound.
  const entryCost = new Map<{ id: string; name: string }, number>();
  for (const entries of Object.values(payload.categories)) {
    for (const entry of entries) {
      entryCost.set(entry, JSON.stringify(entry).length + 1);
    }
  }

  let estimated = rendered.length;
  while (estimated > MAX_SKILL_MENU_PROMPT_CHARS) {
    let largestName: string | null = null;
    let largestLen = 0;
    for (const [name, entries] of Object.entries(payload.categories)) {
      if (entries.length > largestLen) {
        largestLen = entries.length;
        largestName = name;
      }
    }
    if (largestName == null) return null;
    const entries = payload.categories[largestName];
    const removed = entries.pop();
    if (!removed) return null;
    estimated -= entryCost.get(removed) ?? 0;
  }

  // Final exact check — handles slight under/over-estimation from the
  // per-entry cost approximation above.
  rendered = renderMenu(payload);
  while (rendered.length > MAX_SKILL_MENU_PROMPT_CHARS) {
    let largestName: string | null = null;
    let largestLen = 0;
    for (const [name, entries] of Object.entries(payload.categories)) {
      if (entries.length > largestLen) {
        largestLen = entries.length;
        largestName = name;
      }
    }
    if (largestName == null) return null;
    payload.categories[largestName].pop();
    rendered = renderMenu(payload);
  }
  return rendered;
}

/**
 * Returns text to append after {@link buildSystemPromptAppend} when tiered
 * skills are enabled; empty string otherwise.
 */
export function buildSkillTierSystemPromptAppend(): string {
  if (process.env.AMPLITUDE_WIZARD_SKILL_TIERS !== '1') return '';
  try {
    const menu = loadBundledSkillMenu();
    const payload: SkillMenuPayload = {
      categories: Object.fromEntries(
        Object.entries(menu.categories).map(([name, entries]) => [
          name,
          entries.map((s) => ({ id: s.id, name: s.name })),
        ]),
      ),
    };
    // Truncating the JSON mid-token (the previous behaviour) produced
    // syntactically invalid JSON inside a fenced code block, which made the
    // model hallucinate ids. Instead, drop entries until the menu fits, and
    // fall back to a plain note when even an empty menu would overflow.
    const rendered = fitMenuToBudget(payload);
    if (rendered == null) {
      return (
        `\n\n## Bundled skill menu (tiered loading)\n\n` +
        `Skill menu too large to inline; call \`wizard-tools:load_skill_menu\` to discover ids before \`wizard-tools:load_skill\`.\n`
      );
    }
    return (
      `\n\n## Bundled skill menu (tiered loading)\n\n` +
      `Use \`wizard-tools:load_skill\` for full SKILL.md bodies and ` +
      `\`wizard-tools:load_skill_reference\` for paths under \`references/\` only. ` +
      `Ids must match this menu.\n\n` +
      `\`\`\`json\n${rendered}\n\`\`\`\n`
    );
  } catch {
    return '';
  }
}
