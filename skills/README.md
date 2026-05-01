# `skills/` — bundled instructions the agent loads on demand

Skills are markdown-based, structured instructions the wizard's internal
Claude agent can load mid-run. They scale the agent's competence without
bloating the always-on system prompt (`src/lib/commandments.ts`) — the
commandments stay terse, and the agent pulls in a skill only when it
needs that specific competence.

## Don't edit these files directly

This directory is **regenerated** from
[`amplitude/context-hub`](https://github.com/amplitude/context-hub).
Edits made here will be overwritten by the next `pnpm skills:refresh`.

To change a skill: open a PR against context-hub. After it ships, run
`pnpm skills:refresh` here (or rely on the
`refresh-instrumentation-skills.yml` / `refresh-integration-skills.yml`
workflows to pick up the change automatically).

## Categories

| Subdirectory | What it covers | Source in context-hub |
|--------------|----------------|------------------------|
| `integration/` | Per-framework SDK integration guides — one skill per supported framework, each with a `SKILL.md` + `references/` (begin / edit / revise / conclude phases plus framework-specific docs). | Generated from `transformation-config/` |
| `instrumentation/` | Analytics-instrumentation workflows — diff intake, event-surface discovery, pattern matching, and the end-to-end "add analytics" flow. | `context-hub/skills/instrumentation/` |
| `taxonomy/` | Quickstart taxonomy + chart/dashboard planning skills used by the data-setup flow. | `context-hub/skills/taxonomy/` |

## Skill anatomy

Every skill is a directory with at minimum:

```
<skill-id>/
├── SKILL.md            # YAML frontmatter (name, description, metadata) + workflow + references
└── references/         # supporting markdown the SKILL.md links to
    └── *.md
```

## How the agent loads a skill

The wizard's in-process MCP server (`src/lib/wizard-tools.ts`) used to
expose `load_skill_menu` / `install_skill` tools — currently disabled
behind a feature flag. Today, skills are pre-staged into the user's
project under `.claude/skills/` by the wizard's lifecycle hooks, and the
agent reads them as plain files.

## See also

- `../CLAUDE.md` — `### Skills` section
- The context-hub repo for editing skills, plus its `transformation-config/`
  for the integration-skill generator
