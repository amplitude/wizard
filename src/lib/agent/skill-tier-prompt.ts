/**
 * System-prompt slice for tiered skill delivery (Phase C). Surfaces a
 * compact id/name menu so the model can call `load_skill` without
 * discovering paths on disk first.
 *
 * Tiered delivery is default-on; opt out with
 * `AMPLITUDE_WIZARD_SKILL_TIERS=0` to restore eager pre-staging.
 */
import { isSkillTiersEnabled } from '../wizard-tools.js';
import {
  buildSkillMenuFileContent,
  type SkillMenuFileContent,
} from '../wizard-tools/bundled-skills.js';

/**
 * Hard cap on the rendered menu's char count inside the system prompt.
 *
 * The menu is rendered as id-only (see {@link toIdOnlyPayload}), which is
 * roughly 2-3× more compact than the full `{ id, name }` shape that gets
 * written to `.claude/skills/skill-menu.json`. The model never reads `name`
 * from the prompt — it matches on `id` when calling `load_skill` — so
 * dropping `name` here is pure win on per-turn cache cost without losing
 * any signal. The on-disk file keeps the full shape so external tooling
 * that reads it (or the `load_skill_menu` MCP tool, when enabled) still
 * sees human-readable names.
 *
 * Cap reduced from 12_000 → 6_000: the bundled menu currently renders to
 * ~1.2 KB id-only, so 6 KB leaves >4× headroom for skill-list growth
 * before trimming kicks in.
 */
const MAX_SKILL_MENU_PROMPT_CHARS = 6_000;

/**
 * Id-only payload: same `categories` shape as the on-disk menu, but each
 * entry is just the string `id` instead of `{ id, name }`. The model only
 * ever needs `id` to call `load_skill`, so shipping `name` to every turn
 * is dead system-prompt weight.
 */
interface IdOnlySkillMenuPayload {
  categories: Record<string, string[]>;
}

type SkillMenuPayload = IdOnlySkillMenuPayload;

function toIdOnlyPayload(full: SkillMenuFileContent): IdOnlySkillMenuPayload {
  return {
    categories: Object.fromEntries(
      Object.entries(full.categories).map(([name, entries]) => [
        name,
        entries.map((e) => e.id),
      ]),
    ),
  };
}

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

  // Per-entry serialized length plus the comma separating it from a sibling.
  // Over-counts by one comma per category (last entry has no trailing comma)
  // but the final renderMenu() pass below corrects to exact length.
  const entryCost = new Map<string, number>();
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
 * skills are enabled; empty string when the user has opted out via
 * `AMPLITUDE_WIZARD_SKILL_TIERS=0`.
 */
export function buildSkillTierSystemPromptAppend(): string {
  if (!isSkillTiersEnabled()) return '';
  try {
    // Render as id-only ({ categories: { <cat>: ["<id>", ...] } }) — the
    // model only needs ids to call `load_skill`. Names live in the on-disk
    // `skill-menu.json` for tools / humans that want them.
    const payload: SkillMenuPayload = toIdOnlyPayload(
      buildSkillMenuFileContent(),
    );
    // Truncating the JSON mid-token (the previous behaviour) produced
    // syntactically invalid JSON inside a fenced code block, which made the
    // model hallucinate ids. Instead, drop entries until the menu fits, and
    // fall back to a plain note when even an empty menu would overflow.
    const rendered = fitMenuToBudget(payload);
    if (rendered == null) {
      return (
        `\n\n## Bundled skill menu (tiered loading)\n\n` +
        `Skill bodies are NOT pre-loaded. Call \`wizard-tools:load_skill_menu\` to discover ids, then \`wizard-tools:load_skill\` to fetch a body.\n` +
        `Do not call \`load_skill\` more than twice for the same skillId in a phase — bodies are cached, repeat calls are denied.\n`
      );
    }
    return (
      `\n\n## Bundled skill menu (tiered loading)\n\n` +
      `Skill bodies are NOT pre-loaded. Use \`wizard-tools:load_skill\` to fetch a skill's full SKILL.md body when you need it, ` +
      `and \`wizard-tools:load_skill_reference\` for paths under \`references/\` only. Ids must match this menu. ` +
      `Do not call \`load_skill\` more than twice for the same skillId in a phase — repeat calls are denied.\n\n` +
      `\`\`\`json\n${rendered}\n\`\`\`\n`
    );
  } catch {
    return '';
  }
}
