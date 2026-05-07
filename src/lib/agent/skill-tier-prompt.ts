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
 * remaining syntactically valid. Drops one entry at a time from the largest
 * category until under budget; if every category has been emptied we return
 * `null` so the caller can fall back to a "menu too large" note.
 */
function fitMenuToBudget(payload: SkillMenuPayload): string | null {
  let rendered = renderMenu(payload);
  while (rendered.length > MAX_SKILL_MENU_PROMPT_CHARS) {
    const largest = Object.entries(payload.categories)
      .filter(([, entries]) => entries.length > 0)
      .sort(([, a], [, b]) => b.length - a.length)[0];
    if (!largest) return null;
    largest[1].pop();
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
