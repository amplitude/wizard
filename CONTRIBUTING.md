# Contributing

Thanks for your interest in contributing to the Amplitude Wizard! This guide
covers everything you need to get started.

## Development setup

```bash
# Clone and install
git clone https://github.com/amplitude/wizard.git
cd wizard
pnpm install

# Run from source (no build needed)
pnpm try

# Build
pnpm build
```

**Requirements:** Node.js >= 18.17.0, pnpm

## Testing

```bash
pnpm test          # unit tests (vitest)
pnpm test:watch    # watch mode
pnpm test:bdd      # BDD / Cucumber tests
pnpm test:e2e      # end-to-end tests (builds first)
pnpm lint          # prettier + eslint
pnpm fix           # auto-fix lint issues
```

Please ensure all tests pass before submitting a PR.

## Commit conventions

This repo uses [conventional commits](https://www.conventionalcommits.org/).
PR titles and commit messages must start with a type prefix:

```
feat: add Vue 3 framework support
fix: handle missing package.json gracefully
docs: update flow diagrams
test: add router resolution tests
chore: bump dependencies
refactor: simplify framework detection
```

Valid types: `feat`, `fix`, `docs`, `test`, `ci`, `refactor`, `perf`, `chore`, `revert`

A CI check enforces this on PR titles.

## Pull requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests as needed
4. Run `pnpm lint` and `pnpm test` to verify
5. Open a PR with a conventional commit title
6. Fill in the PR description with a summary and test plan

## Adding a new framework

See the [`adding-framework-support` skill](./.claude/skills/adding-framework-support/SKILL.md) for a step-by-step guide. The short version:

1. Add an enum value to `Integration` in `src/lib/constants.ts` (position controls detection priority)
2. Create `src/frameworks/<name>/<name>-wizard-agent.ts` exporting a `FrameworkConfig`
3. Register it in `src/lib/registry.ts`
4. Add an integration skill in `skills/integration/`
5. Add the docs URL to `OUTBOUND_URLS.frameworkDocs` in `constants.ts`

## Architecture overview

The wizard is built with [Ink](https://github.com/vadimdemedes/ink) (React for CLIs) and uses the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) to run an AI agent that instruments analytics.

Key architectural rules:

- **Session is the single source of truth** — all state lives in `WizardSession`
- **Screens are passive** — they observe session state, they don't own navigation
- **Flows are declarative** — defined as pipelines of `{ screen, show, isComplete }` entries
- **Framework configs are data-driven** — everything goes through `FrameworkConfig` + `FRAMEWORK_REGISTRY`

See [CLAUDE.md](./CLAUDE.md) for the full architecture reference and [docs/flows.md](./docs/flows.md) for flow diagrams.

## Reporting issues

File bugs and feature requests at [github.com/amplitude/wizard/issues](https://github.com/amplitude/wizard/issues).
