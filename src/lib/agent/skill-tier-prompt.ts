/**
 * Optional system-prompt slice for AMPLITUDE_WIZARD_SKILL_TIERS=1 (Phase C).
 * Surfaces a compact id/name menu so the model can call load_skill without
 * discovering paths on disk first.
 */
import { loadBundledSkillMenu } from '../wizard-tools.js';

const MAX_SKILL_MENU_PROMPT_CHARS = 12_000;

/**
 * Returns text to append after {@link buildSystemPromptAppend} when tiered
 * skills are enabled; empty string otherwise.
 */
export function buildSkillTierSystemPromptAppend(): string {
  if (process.env.AMPLITUDE_WIZARD_SKILL_TIERS !== '1') return '';
  try {
    const menu = loadBundledSkillMenu();
    const out = Object.fromEntries(
      Object.entries(menu.categories).map(([name, entries]) => [
        name,
        entries.map((s) => ({ id: s.id, name: s.name })),
      ]),
    );
    let payload = JSON.stringify({ categories: out });
    if (payload.length > MAX_SKILL_MENU_PROMPT_CHARS) {
      payload = `${payload.slice(0, MAX_SKILL_MENU_PROMPT_CHARS)}…`;
    }
    return (
      `\n\n## Bundled skill menu (tiered loading)\n\n` +
      `Use \`wizard-tools:load_skill\` for full SKILL.md bodies and ` +
      `\`wizard-tools:load_skill_reference\` for paths under \`references/\` only. ` +
      `Ids must match this menu.\n\n` +
      `\`\`\`json\n${payload}\n\`\`\`\n`
    );
  } catch {
    return '';
  }
}
