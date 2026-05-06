/**
 * Prefix-size benchmark.
 *
 * Compares two ways of constructing the agent's system prefix:
 *
 *   - **before** ("eager"): commandments + every active skill body + tools.
 *     This is the wizard's behavior today — every skill that gets staged
 *     into the agent run contributes to the system prompt regardless of
 *     whether the current turn needs it.
 *
 *   - **after** ("lazy"): always-on commandments + a "skill menu" of names
 *     and one-line descriptions + tools. The agent calls a hypothetical
 *     `load_skill(id)` to fetch a body on demand. This is the migration
 *     plan's projected savings if we move skills off the eager prefix.
 *
 * The benchmark walks `skills/` (top-level, populated by
 * `pnpm skills:refresh`) plus `.claude/skills/` (committed bundled skills)
 * and reports the actual delta against `getWizardCommandments({})`.
 *
 * Honest note: the wizard does NOT currently inline every SKILL.md body
 * into the system prompt — most skills are loaded through the agent SDK's
 * skill-loading machinery. The "eager" number here is an upper bound for
 * what the prefix WOULD be if we did, which is the comparison the
 * migration plan asks us to track.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { getWizardCommandments } from '../src/lib/commandments.js';

import { type BenchmarkResult } from './types.js';

interface SkillSummary {
  id: string;
  description: string;
  bodyBytes: number;
}

function discoverSkillsAt(skillsDir: string, prefix = ''): SkillSummary[] {
  if (!fs.existsSync(skillsDir)) return [];
  const out: SkillSummary[] = [];
  for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    if (ent.isDirectory()) {
      const skillFile = path.join(skillsDir, ent.name, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        out.push(
          summarizeSkill(`${prefix}${ent.name}`, skillFile, [
            path.join(skillsDir, ent.name, 'references'),
          ]),
        );
      } else {
        // One level of nesting (e.g. skills/integration/<id>/SKILL.md).
        out.push(
          ...discoverSkillsAt(
            path.join(skillsDir, ent.name),
            `${prefix}${ent.name}/`,
          ),
        );
      }
    } else if (ent.isFile() && ent.name.endsWith('.md')) {
      // Flat layout: `<id>.md`. README is excluded.
      if (ent.name === 'README.md') continue;
      const id = ent.name.replace(/\.md$/, '');
      out.push(
        summarizeSkill(`${prefix}${id}`, path.join(skillsDir, ent.name)),
      );
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function summarizeSkill(
  id: string,
  file: string,
  extraDirs: string[] = [],
): SkillSummary {
  const text = fs.readFileSync(file, 'utf8');
  let description = '';
  // Cheap frontmatter scan — avoids depending on a YAML parser. Only the
  // description matters for the menu.
  const fmMatch = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (fmMatch && fmMatch[1]) {
    const fm = fmMatch[1];
    const dm = /description:\s*(?:>\s*)?\n?([^\n][^\n]*(?:\n {2}[^\n]*)*)/.exec(
      fm,
    );
    if (dm && dm[1]) {
      description = dm[1]
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' ');
    }
  }
  // For folder-layout skills, references/* contribute to "eager" load
  // because the eager-load model inlines everything reachable from the
  // skill directory into the system prompt.
  let extraBytes = 0;
  for (const refsDir of extraDirs) {
    if (fs.existsSync(refsDir)) {
      for (const f of fs.readdirSync(refsDir)) {
        const p = path.join(refsDir, f);
        const st = fs.statSync(p);
        if (st.isFile()) extraBytes += st.size;
      }
    }
  }
  return {
    id,
    description,
    bodyBytes: text.length + extraBytes,
  };
}

/** Synthesize the kind of "tools JSON" Anthropic counts toward the prefix. */
function syntheticToolsBlockBytes(): number {
  // Approximation of the AI SDK / agent-sdk tool definition payload.
  // Encodes a small placeholder so the comparison stays apples-to-apples
  // until we wire the real tools manifest in.
  const tools = [
    {
      name: 'detect_framework',
      description:
        'Deterministic filesystem framework detection (same signals as wizard core).',
      inputSchema: { projectDir: 'string' },
    },
  ];
  return JSON.stringify(tools, null, 2).length;
}

export function runPrefixSizeBenchmark(repoRoot: string): BenchmarkResult {
  // Walk the two skill roots the wizard ships with.
  const skillsTop = path.join(repoRoot, 'skills');
  const skillsClaude = path.join(repoRoot, '.claude', 'skills');
  const skills = [
    ...discoverSkillsAt(skillsTop),
    ...discoverSkillsAt(skillsClaude),
  ].sort((a, b) => a.id.localeCompare(b.id));

  const commandments = getWizardCommandments({});
  const toolsBytes = syntheticToolsBlockBytes();

  const totalSkillBodyBytes = skills.reduce((n, s) => n + s.bodyBytes, 0);

  // EAGER (today's upper bound): commandments + every skill body + tools.
  const eagerBytes = commandments.length + totalSkillBodyBytes + toolsBytes;
  // Token estimation uses the byte count divided by ~4 (English-prose
  // ballpark). We never read skill bodies into memory here — `bodyBytes`
  // came from stat()/readFile so the harness stays cheap on huge bundles.
  const eagerTokens = Math.ceil(eagerBytes / 4);

  // LAZY (projected): commandments + skill menu (id + description) + tools.
  // Bodies are loaded on demand via load_skill.
  const menu = skills.map((s) => `- ${s.id}: ${s.description}`).join('\n');
  const lazyBytes = commandments.length + menu.length + toolsBytes;
  const lazyTokens = Math.ceil(lazyBytes / 4);

  const reductionPct =
    eagerBytes === 0 ? 0 : Math.round((1 - lazyBytes / eagerBytes) * 100);

  // Status: migration plan projects 50-70% savings. Mark `ok` once we
  // hit that floor, `warn` when the skill bundle is too small to make
  // the comparison meaningful or the reduction is below projection.
  const status: BenchmarkResult['status'] =
    skills.length <= 1 ? 'warn' : reductionPct >= 50 ? 'ok' : 'warn';

  const note =
    skills.length <= 1
      ? `only ${skills.length} skill on disk — projected reduction grows with bundle.`
      : `${skills.length} skills counted.`;

  return {
    id: 'prefix-size',
    label: 'System-prefix size (eager vs lazy)',
    before: eagerTokens,
    after: lazyTokens,
    unit: 'tokens',
    delta: `-${reductionPct}%`,
    status,
    note,
    details: {
      eagerBytes,
      lazyBytes,
      eagerTokens,
      lazyTokens,
      commandmentsBytes: commandments.length,
      toolsBytes,
      skills: skills.map((s) => ({
        id: s.id,
        description: s.description,
        bodyBytes: s.bodyBytes,
      })),
      auditProjectionPct: '50-70%',
    },
  };
}
