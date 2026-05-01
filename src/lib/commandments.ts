import { DEMO_MODE } from './constants.js';

/**
 * Wizard-wide commandments that are always appended as a system prompt.
 *
 * Every line here ships on every turn (cached, but cache-creation cost +
 * cache-read cost both scale with size, and a smaller static prompt
 * means fewer compaction events on long runs).
 *
 * Two layers:
 *   - UNIVERSAL — every run sees these.
 *   - BROWSER_ONLY — only included when the active framework has
 *     `metadata.targetsBrowser = true`. Mobile / server / generic runs
 *     skip it entirely.
 *
 * Long tutorial copy, Amplitude product tables, and extended contracts live
 * in the bundled **wizard-prompt-supplement** skill (`skills/wizard/` in
 * the repo) — pre-staged to `.claude/skills/wizard-prompt-supplement/`.
 * The integration prompt instructs agents to load it; commandments here
 * keep only invariants + pointers so per-turn append stays small.
 *
 * Keep these as plain strings so they can be inlined into the compiled
 * bundle without extra files, copying, or runtime I/O.
 */
const UNIVERSAL_COMMANDMENTS: string[] = [
  'Never hallucinate an Amplitude API key, host, or any other secret. Always use the real values configured for this project (e.g. via environment variables).',

  'API keys (server private vs browser public), allowed env conventions, forbidden build-config bridging, and when to inline a public key — full detail in the pre-staged skill `.claude/skills/wizard-prompt-supplement/references/api-keys-and-env.md` (load via Read after opening `wizard-prompt-supplement/SKILL.md`). Invariant: never invent secrets; use wizard-tools `check_env_keys` / `set_env_values` for `.env*`; never modify webpack/vite/next/babel config to pipe env into client code.',

  'Always use the `detect_package_manager` tool from the wizard-tools MCP to determine the package manager. Do not guess based on lockfiles or hard-code npm/yarn/pnpm/bun/pip/etc.',

  'Every wizard-tools MCP tool call (`mcp__wizard-tools__*`) MUST include a `reason` argument (≤25 words) explaining what you\'re trying to accomplish at this step. Captured in Agent Analytics. Write a real rationale tied to the immediate goal — not a paraphrase of the tool description, generic phrases like "calling tool", or the literal string "reason". When you\'re truly stuck (unresolvable error, missing prerequisite, ambiguous codebase shape), call `wizard_feedback` (severity="warn" if you can continue degraded, "error" if not) instead of silently continuing or repeating failed calls.',

  'NEVER use Bash to verify env vars — `node -e`, `node --eval`, `printenv`, `echo $VAR`, `cat .env*`, `grep AMPLITUDE .env`, `bash -c "..."` are all denied by the allowlist. The ONLY sanctioned check is wizard-tools `check_env_keys` (reports presence without exposing values); if keys are missing, call `set_env_values`. Read the deny message for details — do not retry with a reworded variant.',

  `Build/typecheck/lint verification — keep shell shapes SIMPLE. Allowed: package-manager scripts (\`yarn test:typecheck\`, \`npx tsc --noEmit\`, \`npx eslint --fix src/file.ts\`) optionally piped to a SINGLE \`| tail -50\` or \`| head -30\`. Denied: ✗ \`yarn typecheck | grep -E "..." | head -30\` (multiple pipes, parens), ✗ \`yarn build && yarn lint\` (\`&&\` chaining), ✗ \`tsc --noEmit; yarn lint\` (\`;\` chaining). Use \`Grep\` for substring filtering on captured stdout, not a shell pipe. Scope to edited files only (see scoping commandment below) — never run project-wide. On a deny, DO NOT retry with progressively more shell composition; note in the setup report and move on.`,

  'When installing packages, start the install as a background task and continue with other work. Do not block on installs unless explicitly instructed.',

  `Discovery parallelism — fan out independent probes in ONE assistant message instead of serializing them turn-by-turn. The Claude Agent SDK runs every tool call in a single message in parallel, so a 3-tool batch costs ~one round-trip; the same 3 calls split across 3 messages costs ~3 round-trips and ~10–20s of avoidable wall time on cold-start.

Combine in the SAME message when none depend on each other (typical for the very first project sniff):
  - \`mcp__wizard-tools__detect_package_manager\`
  - \`mcp__wizard-tools__check_env_keys\`
  - \`Glob\` (e.g. \`package.json\`, \`pyproject.toml\`, \`pubspec.yaml\` — whatever signals the framework)
  - \`Read\` of a file you know exists (typically \`package.json\` from the framework-detection prompt context)

Same rule for any later "I want to understand the project shape" batch: when you'd be calling several Read / Glob / Grep / wizard-tools probes whose results are independent, fire them together. DO serialize when one truly depends on another (Glob first, Read the matched paths second). If unsure, parallelism is the safer default — the wizard's status spinner stays responsive and the cache hit rate on the first user message stays hot.

Write tools (Edit / Write) — DO parallelize when each call targets a DIFFERENT file. Instrumenting an event across 5 files = 5 Edit calls in ONE assistant message; that's the single biggest wall-clock win in the "Wire up event tracking" phase. The Read-before-Write rule still applies (each file needs a prior Read), and you must NEVER fan out two writes to the SAME file in one message — those races corrupt content. When in doubt about file independence, serialize.`,

  "NEVER install non-Amplitude packages on the user's behalf. The wizard's job is to add Amplitude — not build tooling, env-var loaders, bundler plugins, polyfills, or other utilities. Out of scope: `dotenv` and variants, `webpack`, `vite`, `@types/*`, polyfill libraries, env-injection plugins. Hard test before any `npm install` / `pnpm add` / `yarn add` / `pip install` / `gem install` / `go get`: does the package start with `@amplitude/`? If not, is it explicitly listed as a required peer dependency by the active integration skill (e.g. `@react-native-async-storage/async-storage` for React Native)? If neither, DO NOT install. If env-var wiring or build-config changes are needed, document the required change in the setup report and let the user decide. Sample EXAMPLE.md files under skills/integration may show `dotenv` etc. — those are reference snippets, not install instructions.",

  'NEVER use `sleep`, busy-wait loops, or polling Bash commands to wait for MCP servers, gateways, or services to "recover". If an MCP tool errors, retry AT MOST ONCE; then report and proceed. Long Bash sleeps idle the streaming connection and produce cascading "API Error: 400 terminated" failures — sleeps over a few seconds will be denied.',

  'Retry budget for ANY tool failure or denial (error, PreToolUse hook deny, permission rejection): retry AT MOST ONCE with a different approach. After two consecutive failures/denials for the same goal, STOP. Two cycles is the budget; spending 5+ turns hammering on a denied command is a bug. When exhausted: write the limitation into the setup report ("Could not verify <X> at runtime; the bash allowlist denies <command>. Manually verify after install.") and move to the next checklist item. A "Bash command not allowed" deny means the command WILL NEVER BE ALLOWED on this run, no matter how you reword it.',

  'Before writing to any file, you MUST read that exact file immediately beforehand using the Read tool, even if you read it earlier in the run. Avoids tool failures and stale edits.',

  'Treat feature flags, custom properties, and event names as part of an analytics contract. Prefer reusing existing names and patterns. When introducing new ones, make them clear, descriptive, and consistent with project conventions; avoid scattering the same flag/property across unrelated callsites. For instrumentation runs, load the **amplitude-quickstart-taxonomy-agent** skill from `.claude/skills/` via the Skill tool (the wizard pre-stages it; do not use wizard-tools skill-menu tools — they are disabled) and align with its starter-kit rules (business-outcome naming, small property sets, no redundant pageview events, funnel-friendly linkage).',

  'Prefer minimal, targeted edits that achieve the requested behavior while preserving existing structure and style. Avoid large refactors, broad reformatting, or unrelated changes unless explicitly requested.',

  'Never replace wholesale, reset-to-template, or substantially rewrite a project\'s root-level AI or contributor guidance files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `CONTRIBUTING.md`, `.github/copilot-instructions.md`, or similar). Those belong to the repository maintainers — do not "onboard" the repo by authoring a fresh CLAUDE.md from scratch. If a tiny inline hint helps, append at most one `## Amplitude (wizard)` section pointing at `amplitude-setup-report.md`; otherwise rely on the setup report only.',

  'Do not spawn subagents unless explicitly instructed.',

  `Use TodoWrite to narrate progress. The wizard renders the user-visible 5-step checklist from your tool calls (PreToolUse / PostToolUse), so step status is mechanical and you don't need to micro-manage it. Your job here is to mark each step in_progress when you start it and completed when you finish — the wizard treats your list as advisory \`activeForm\` text only ("Installing project dependencies") and ignores status discrepancies. Use EXACTLY these five labels, in order, so the renderer can match them:

  1. Detect your project setup
  2. Install Amplitude
  3. Plan and approve events to track
  4. Wire up event tracking
  5. Build your starter dashboard

Do NOT add a sixth — internal steps (env var writes, Content Security Policy edits, build verification, setup report, doc fetches) roll into the appropriate parent (CSP and env vars into "Install Amplitude"; setup report into "Build your starter dashboard"; build verification into "Wire up event tracking"). Engineering phases from the integration skill (1.0-begin / 1.1-edit / 1.2-revise / 1.3-conclude) are internal — they do not appear here. The denominator MUST stay 5 — the wizard renders "X / 5 tasks complete" regardless of what your list says.`,

  `After installing the SDK and adding init code, but BEFORE writing any track() calls, you MUST call confirm_event_plan. Naming rules, plan sizing, funnel/async/symmetry/identify, autocapture overlap, and .amplitude/events.json ownership — read \`.claude/skills/wizard-prompt-supplement/references/confirm-event-plan-contract.md\` before the call. Invariants: confirm_event_plan owns the initial write of \`.amplitude/events.json\` only (canonical under \`.amplitude/\`; do not create or overwrite legacy root \`.amplitude-events.json\` / \`.amplitude-dashboard.json\`); canonical shape [{name, description}]; do not pre-write a conflicting shape; if skipped, do not instrument.`,

  'Post-instrumentation `.amplitude/events.json` (under `.amplitude/`) array shape, dashboard creation, and `record_dashboard` — read `.claude/skills/wizard-prompt-supplement/references/post-instrumentation-events-and-dashboard.md`.',

  'Setup report format and `<wizard-report>` tags — read `.claude/skills/wizard-prompt-supplement/references/setup-report-requirements.md`. You MUST write `amplitude-setup-report.md` at the project root before the run ends.',

  'Prefer `report_status` (wizard-tools MCP) for progress updates and fatal errors. Use `kind="status"` for in-progress updates (appears in the spinner). Use `kind="error"` for fatal halts (codes: `MCP_MISSING`, `RESOURCE_MISSING`). Legacy `[STATUS]` / `[ERROR-MCP-MISSING]` / `[ERROR-RESOURCE-MISSING]` text markers from older bundled skills are still recognized for back-compat; new code should use `report_status`.',

  `Do NOT delete or "clean up" wizard-managed paths during the agent run. Owned by wizard lifecycle hooks:
  - \`.amplitude/\` and everything under it (\`events.json\`, \`dashboard.json\`, \`product-map.json\`, …) — the wizard writes project metadata only here
  - Legacy root \`.amplitude-events.json\` / \`.amplitude-dashboard.json\` — do not create or rewrite; leave existing files from older runs alone (reads may still use them during migration)
  - \`amplitude-setup-report.md\` (wizard archives previous runs itself)
  - \`.claude/skills/\` (wizard pre-stages and cleans these post-run)

The wizard runs explicit cleanup hooks AFTER your run (see \`cleanupIntegrationSkills\`, \`cleanupWizardArtifacts\`, \`archiveSetupReportFile\` in \`src/lib/wizard-tools.ts\`). \`rm\` is denied by the bash allowlist regardless of path. Same rule for \`mv\` / \`cp\` of these paths. If you find a stale wizard file, leave it and note in the setup report; the next wizard run handles migration.`,

  `Lint / format / build at end-of-run MUST be scoped to files you edited — never project-wide.

  RIGHT (fast, scoped):
    npx prettier --write <file1> <file2>
    npx eslint --fix <file1> <file2>
    npx tsc --noEmit -p tsconfig.json   # only if no other TS check; skip for large monorepos

  WRONG (project-wide, hangs): \`npm run build\` / \`npm run lint\` / \`npm run typecheck\` / \`npm run format\` / \`pnpm lint\` / \`yarn lint\` / \`npx prettier --write .\` — all run against the entire repo.

  Rationale and time-budget detail: \`.claude/skills/wizard-prompt-supplement/references/lint-scoping.md\`. Pass explicit paths. If a custom lint command only accepts no-args, skip it and note in the setup report.

  Time budget: lint+format+typecheck combined under 60s. If a single command exceeds 90s or you're on a third attempt, STOP — note in setup report and proceed.`,
];

/**
 * Browser-only commandments — included only when the active framework has
 * `metadata.targetsBrowser = true` (Next.js, Vue, React Router, JS-Web,
 * etc.). Mobile / server / generic runs skip these entirely; the option
 * tables aren't valid for those SDKs anyway.
 *
 * Full npm option tables and doc links live in wizard-prompt-supplement
 * `references/browser-sdk-init-defaults.md`. This block keeps init-location
 * guidance and the RIGHT/WRONG import pattern (locked by tests) plus a
 * short pointer that still mentions initAll / frustrationInteractions for
 * browser-vs-non-browser gating tests.
 */
const BROWSER_ONLY_COMMANDMENTS: string[] = [
  `Browser SDK init defaults — CDN vs npm shapes differ; full autocapture tables, init()/initAll() examples, remoteConfig nesting, sessionReplay/engagement defaults, and per-SDK exclusions: read \`.claude/skills/wizard-prompt-supplement/references/browser-sdk-init-defaults.md\`. Defaults use the full autocapture set including frustrationInteractions; unified shape uses initAll(API_KEY, { analytics: { remoteConfig: { fetchRemoteConfig: true }, autocapture: { /* each key with same-line // comment */ } }, sessionReplay: { sampleRate: 1 }, engagement: {} }). Every generated option line needs a brief // comment so users can toggle behavior.`,

  `Initialize the SDK exactly once, in the framework's natural entry file. Every other file imports the SDK package directly with a namespace import — do NOT build a project-local re-export wrapper.

Init goes in the entry file the framework already runs once at startup:
  - Next.js 15.3+: \`instrumentation-client.ts\`
  - React + Vite / CRA: \`src/main.tsx\` / \`src/main.jsx\` / \`src/index.tsx\`
  - React Router v6/v7 declarative: \`src/main.tsx\`
  - TanStack Router (file-based) / TanStack Start: \`src/routes/__root.tsx\`
  - Vue / Nuxt: root \`App.vue\` setup script or a Nuxt plugin under \`plugins/\`
  - Astro: an \`is:inline\` script in the layout, or an \`amplitude.astro\` component imported by the layout
  - Vanilla JS / no framework hook: a single \`src/amplitude.js\` that calls \`initAll(...)\` and \`export default amplitude\` of the namespace

Every other file does a direct namespace import from the SDK package:

  // ✓ RIGHT — direct namespace import (matches every browser app under context-hub/basics/*)
  import * as amplitude from "@amplitude/unified";
  amplitude.track("Burrito Considered", { variant: "veggie" });

  // ✗ WRONG — building a re-export wrapper and routing every callsite through it
  // src/lib/amplitude.ts:
  //   initAll(API_KEY, {...});
  //   export { track, setUserId, identify, Identify } from "@amplitude/unified";
  // src/components/Foo.tsx:
  //   import { track } from "@/lib/amplitude";

Why this matters: the SDK package already exports \`track\`, \`setUserId\`, \`identify\`, \`Identify\` — a project-local re-export adds no abstraction, just an extra hop the agent forgets about. In mixed runs the re-exports become dead code that lies about being load-bearing: a future dev refactors the wrapper expecting the rest of the project to follow, and nothing actually changes. Pick the entry-file-init + direct-namespace-import pattern and use it everywhere; if a stray re-export wrapper already exists from an earlier run, leave existing callsites alone but route new track calls directly through the SDK.

Vanilla JS escape hatch: if there is no framework entry hook, the wrapper module should follow the \`basics/javascript-web/src/amplitude.js\` shape — \`export default amplitude;\` of the namespace, NOT \`export { track, ... }\` named re-exports. Consumers do \`import amplitude from "./amplitude.js"\` and \`import { Identify } from "@amplitude/unified"\` separately for the \`Identify\` class.`,
];

const DEMO_MODE_COMMANDMENTS: string[] = DEMO_MODE
  ? [
      'DEMO MODE: This is a demo run. Limit the instrumentation plan to at most 5 events. Pick the 5 most impactful, representative events. Be concise and fast — skip non-essential analysis.',
    ]
  : [];

export interface CommandmentOptions {
  /**
   * Whether the active framework targets the browser. When true, browser-only
   * guidance (SDK init defaults, autocapture options, init-code templates) is
   * appended. When false / undefined, that block is omitted — saves several
   * KB of system-prompt bloat on mobile / server / generic runs.
   *
   * Defaults to false (conservative — mobile / backend runs get the lean
   * commandment set; if you don't know the platform, you don't need browser
   * defaults).
   */
  targetsBrowser?: boolean;
}

export function getWizardCommandments(
  options: CommandmentOptions = {},
): string {
  const blocks = [...UNIVERSAL_COMMANDMENTS];
  if (options.targetsBrowser) {
    blocks.push(...BROWSER_ONLY_COMMANDMENTS);
  }
  blocks.push(...DEMO_MODE_COMMANDMENTS);
  return blocks.join('\n');
}
