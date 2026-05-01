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

**Requirements:** Node.js >= 20, pnpm

## Agent-assisted development (Cursor, Claude Code, etc.)

- **`CLAUDE.md`** at the repo root is the **canonical** file most coding agents load. It documents architecture, Ink/TUI conventions (Esc / `useScreenInput` / `useEscapeBack`), and PR expectations.
- **`CONTRIBUTING.md`** (this file) is for **human** contributors: setup, tests, commits, PRs.
- In a **fresh clone or git worktree**, run **`pnpm install`** before **`pnpm test`** or **`pnpm exec vitest`** — otherwise `vitest` is not on `PATH` and installs look incomplete.
- When you change **`src/ui/tui/`**, **`flows.ts`**, **`router.ts`**, or navigation-related **`store.ts`**, run **focused Vitest** (stable pool; fewer flakes than a full wide run):

  ```bash
  pnpm exec vitest run --pool=forks --maxWorkers=1 \
    src/ui/tui/__tests__/router.test.ts \
    src/ui/tui/__tests__/flow-invariants.test.ts
  ```

  Add any `src/ui/tui/screens/__tests__/` files that cover screens you edited.

### Local LLM proxy

The wizard routes Claude API calls through an LLM gateway. For local development
you can point the wizard at a local proxy:

```bash
# Terminal 1 — start your local proxy
# (see internal docs for proxy setup)

# Terminal 2 — run the wizard against it
WIZARD_LLM_PROXY_URL=http://localhost:3030/wizard pnpm try
```

You can also bypass the gateway entirely if you have an Anthropic API key:

```bash
ANTHROPIC_API_KEY=sk-ant-... pnpm try
```

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
4. Run `pnpm lint` and `pnpm test` to verify (for TUI/router/flow edits, also run the focused Vitest command under **Agent-assisted development**)
5. If `git status` shows you are **behind** `origin/<your-branch>`, run **`git pull --rebase origin <branch>`** before **`git push`**
6. Open a PR with a conventional commit title
7. Fill in the PR description with a summary and test plan
8. If you used a **`/reflect`** session on the work, paste the numbered checklist into the PR (or link to it); skip with “N/A” only for non-agent sessions
9. After **`git push`**, open the PR with **`gh pr create --fill`** when the GitHub CLI is available and authenticated (otherwise use the compare URL from the push output)

## Adding a new framework

Use an existing framework under `src/frameworks/` and `skills/integration/` as
your template. The short version:

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
