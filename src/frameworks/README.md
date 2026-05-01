# `src/frameworks/` — framework integrations

Each subdirectory implements one supported framework. The wizard auto-detects
which framework a project uses, then dispatches to that framework's config —
no switch statements, no per-framework branching outside this directory.

## Layout per framework

```
frameworks/<name>/
├── <name>-wizard-agent.ts   # exports a FrameworkConfig (the contract)
├── utils.ts                 # detection helpers, file-system probes
└── __tests__/               # unit tests for utils + the agent config
```

## The contract

Every framework must export an object that satisfies `FrameworkConfig` from
[`../lib/framework-config.ts`](../lib/framework-config.ts). The framework is
registered with a stable `Integration` enum value in
[`../lib/registry.ts`](../lib/registry.ts) and
[`../lib/constants.ts`](../lib/constants.ts).

**Detection order matters** — the order of entries in the `Integration`
enum drives both the auto-detection priority (first match wins) and the
display order in the manual-select menu.

## Adding a new framework

1. Mirror an existing framework's directory layout under `src/frameworks/`.
2. Add a matching skill under `skills/integration/integration-<name>/`
   (`SKILL.md` + `references/`). Skills are pulled from
   [`amplitude/context-hub`](https://github.com/amplitude/context-hub) via
   `pnpm skills:refresh` — don't author skills directly here; submit them
   to context-hub.
3. Add an `Integration.<Name>` enum entry in `../lib/constants.ts`. Place
   it in the correct detection-priority slot.
4. Register the config in `../lib/registry.ts`.
5. Write detection tests under `__tests__/utils.test.ts`.

## Currently supported

Next.js, Vue, React Router, Django, Flask, FastAPI, Swift, React Native,
Android, Flutter, Go, Java, Unreal, Unity. Plus the fallback chain: Python,
JavaScript/Node, JavaScript/Web, and Generic (the ultimate catch-all).

## See also

- `../../CLAUDE.md` — `### Framework integrations` section
- `_shared/` — prompt fragments and helpers reused across frameworks (e.g.
  the browser-SDK prompt)
