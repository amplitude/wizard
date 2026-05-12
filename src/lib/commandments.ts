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

  'API keys, env conventions, and when to inline a public key vs use a framework env var — read `.claude/skills/wizard-prompt-supplement/references/api-keys-and-env.md`. Invariants: never invent secrets; use wizard-tools `check_env_keys` / `set_env_values` for `.env*`; never modify webpack/vite/next/babel config to pipe env into client code.',

  'The first user message contains a `# Pre-flight context (...)` block. Two variants exist: (1) **full pre-flight** — the wizard already discovered the cwd, framework, lockfile-based package manager, TypeScript flag, Amplitude org/project/region, project-binding state, and which AMPLITUDE_* env keys exist in which `.env*` files; (2) **JIT mode** (header reads "large project — load on demand") — only Project and Amplitude blocks are present; Environment is omitted and the inline guidance tells you to use discovery tools on demand. For full pre-flight, treat the block as authoritative on the FIRST turn. Do NOT call `detect_package_manager`, `check_env_keys`, or fan out Glob/Read probes for `package.json` / lockfiles / `.env*` just to re-derive those answers. The discovery tools remain registered — call them only when you genuinely need to verify a specific value the user changed mid-run, when the pre-flight block marks a field with `?`, or before `set_env_values` if you must confirm a key is still missing. For JIT mode, follow the inline guidance in the pre-flight block — use `detect_package_manager`, `check_env_keys`, and other discovery tools just-in-time as you need the information.',

  'Always use the `detect_package_manager` tool from the wizard-tools MCP to determine the package manager when the pre-flight block does not already report it. Do not guess based on lockfiles or hard-code npm/yarn/pnpm/bun/pip/etc.',

  'Every wizard-tools MCP tool call (`mcp__wizard-tools__*`) MUST include a `reason` argument (≤25 words) explaining what you\'re trying to accomplish at this step. Captured in Agent Analytics. Write a real rationale tied to the immediate goal — not a paraphrase of the tool description, generic phrases like "calling tool", or the literal string "reason". When you\'re truly stuck (unresolvable error, missing prerequisite, ambiguous codebase shape), call `wizard_feedback` (severity="warn" if you can continue degraded, "error" if not) instead of silently continuing or repeating failed calls.',

  'NEVER use Bash to verify env vars — `node -e`, `node --eval`, `printenv`, `echo $VAR`, `cat .env*`, `grep AMPLITUDE .env`, `bash -c "..."` are all denied by the allowlist. The ONLY sanctioned check is wizard-tools `check_env_keys` (reports presence without exposing values); if keys are missing, call `set_env_values`. Read the deny message for details — do not retry with a reworded variant.',

  `Build/typecheck/lint verification — keep shell shapes SIMPLE. Allowed: package-manager scripts (\`yarn test:typecheck\`, \`npx tsc --noEmit\`, \`npx eslint --fix src/file.ts\`) optionally piped to a SINGLE \`| tail -50\` or \`| head -30\`. Denied: ✗ \`yarn typecheck | grep -E "..." | head -30\` (multiple pipes, parens), ✗ \`yarn build && yarn lint\` (\`&&\` chaining), ✗ \`tsc --noEmit; yarn lint\` (\`;\` chaining). Use \`Grep\` for substring filtering on captured stdout, not a shell pipe. Scope to edited files only (see scoping commandment below) — never run project-wide. On a deny, DO NOT retry with progressively more shell composition; note in the setup report and move on.`,

  'When installing packages, start the install as a background task and continue with other work. Do not block on installs unless explicitly instructed.',

  'For monorepos with package-manager workspaces, use the workspace-aware install syntax: `yarn workspace <name> add <pkg>`, `yarn --cwd <dir> add <pkg>`, `pnpm --filter <name> add <pkg>`, or `npm -w <ws> install <pkg>`. Avoid `cd <dir> && <cmd>` — the `&&` is denied by the bash allowlist.',

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

  'When a wizard tool returns a structured error payload (`{"success": false, "error": ..., "guidance": ..., "suggestedTool": ..., "suggestedArgs": ..., "context": ...}`), READ the `guidance` field and follow it. If `suggestedTool` / `suggestedArgs` are present, call THAT tool with THOSE args next — do NOT retry the failing tool with the same args. The same shape comes back for PreToolUse denials (Bash policy, denied paths, denied event-plan / dashboard writes). Treating structured errors as recovery instructions is the difference between a 1-turn fix and a 5-turn loop that trips the consecutive-deny circuit breaker.',

  'Before writing to any file, you MUST read that exact file immediately beforehand using the Read tool, even if you read it earlier in the run. Avoids tool failures and stale edits.',

  'Treat feature flags, custom properties, and event names as part of an analytics contract. Prefer reusing existing names and patterns. When introducing new ones, make them clear, descriptive, and consistent with project conventions; avoid scattering the same flag/property across unrelated callsites. For instrumentation runs, load the **amplitude-quickstart-taxonomy-agent** skill from `.claude/skills/` via `mcp__wizard-tools__load_skill` (the wizard pre-stages it; do not use wizard-tools skill-menu tools — they are disabled) and align with its starter-kit rules (business-outcome naming, small property sets, no redundant pageview events, funnel-friendly linkage).',

  'Prefer minimal, targeted edits that achieve the requested behavior while preserving existing structure and style. Avoid large refactors, broad reformatting, or unrelated changes unless explicitly requested.',

  'Never replace wholesale, reset-to-template, or substantially rewrite a project\'s root-level AI or contributor guidance files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `CONTRIBUTING.md`, `.github/copilot-instructions.md`, or similar). Those belong to the repository maintainers — do not "onboard" the repo by authoring a fresh CLAUDE.md from scratch. If a tiny inline hint helps, append at most one `## Amplitude (wizard)` section pointing at `amplitude-setup-report.md`; otherwise rely on the setup report only.',

  'Do not spawn subagents unless explicitly instructed.',

  `Use TodoWrite to narrate progress. The wizard renders the user-visible 4-step checklist from your tool calls (PreToolUse / PostToolUse), so step status is mechanical and you don't need to micro-manage it. Your job here is to mark each step in_progress when you start it and completed when you finish — the wizard treats your list as advisory \`activeForm\` text only ("Installing project dependencies") and ignores status discrepancies. Use EXACTLY these four labels, in order, so the renderer can match them:

  1. Detect your project setup
  2. Install Amplitude
  3. Plan and approve events to track
  4. Wire up event tracking

Do NOT add a fifth — internal steps (env var writes, Content Security Policy edits, build verification, setup report, doc fetches) roll into the appropriate parent (CSP and env vars into "Install Amplitude"; setup report and build verification into "Wire up event tracking"). Engineering phases from the integration skill (1.0-begin / 1.1-edit / 1.2-revise / 1.3-conclude) are internal — they do not appear here. The denominator MUST stay 4 — the wizard renders "X / 4 tasks complete" regardless of what your list says. Chart + dashboard creation is NOT part of this run; it lives in a separate deferred command (\`amplitude-wizard dashboard\`) that runs once event ingestion has caught up — do not call \`record_dashboard\`, \`create_chart\`, \`create_dashboard\`, or any Amplitude MCP chart/dashboard tool here.`,

  'Before proposing the event plan (i.e. before `confirm_event_plan`), you MUST load the **discover-analytics-patterns** skill from `.claude/skills/` via `mcp__wizard-tools__load_skill` to identify existing analytics wrapper calls, helper functions, hooks, or instrumentation patterns already in the codebase. If the codebase already has tracking calls (even via a custom wrapper like `trackEvent()`, `useAnalytics()`, or an `ampli.*` typed call), REUSE those patterns when you instrument — do not reimplement the events on top of the raw SDK. Reference the discovered pattern in the setup report so the user can see which wrapper was honored.',

  'After installing the SDK and adding init code, but BEFORE writing any track() calls, you MUST call confirm_event_plan. Naming, plan sizing, funnel/async/symmetry/identify, autocapture overlap, and `.amplitude/events.json` ownership — read `.claude/skills/wizard-prompt-supplement/references/confirm-event-plan-contract.md` before the call. Invariants: confirm_event_plan owns the initial write of `.amplitude/events.json` (canonical shape `[{name, description}]`); do not pre-write a conflicting shape, do not create the legacy root `.amplitude-events.json` / `.amplitude-dashboard.json`; if skipped, do not instrument.',

  `Events fully covered by Amplitude autocapture MUST NOT be proposed in the event plan. The event plan is exclusively for events that require a hand-written \`track()\` call. If the user's interaction is one of the autocaptured types for the active SDK, do NOT include it in the events array you pass to \`confirm_event_plan\` — proposing an event the wizard will not implement is a bug. The user sees it in the plan, approves it, and then nothing gets written. BEFORE you assemble the \`events\` array, audit every candidate against the SDK's init config. If autocapture handles it end-to-end, drop it from the plan entirely — do NOT include it with a note, do NOT mention it in the description, do NOT let it ride along to "remind" the user. The plan is the contract for what \`track()\` calls will be written; if no \`track()\` call will be written, the event does not belong in the plan. Only propose events that capture business outcomes, state changes, async success/failure, or multi-step flow milestones that autocapture cannot infer from a click alone. Common autocaptured shapes that MUST NOT be proposed: "[X] Clicked", "Button Clicked", "Link Clicked", "Element Clicked", "Page Viewed", "Screen Viewed", "Route Changed", "Session Started", "Session Ended", "Form Submitted", "Form Started", "File Downloaded", "Rage Click", "Dead Click", "Error Occurred", and any single-button-click event like "Foo Pasted" / "Bar Exported" / "Baz Opened" that fires from a click handler with no business-side state change. Platform-specific autocapture catalogs: browser (@amplitude/unified / @amplitude/analytics-browser) defaults are documented at https://amplitude.com/docs/data/sdks/browser-2/autocapture and named on the browser-only commandment block; mobile SDKs (Swift / Android / React Native / Flutter) only autocapture what the init config explicitly opts in to — read the active SDK's init code before deciding.`,

  `Every \`track()\` call you write MUST include 1-3 properties that capture the user-meaningful context of the action. A bare event name is not enough — the goal is for the event to answer a question in Amplitude (e.g., "what model was used for that AI generation?" "which room was joined?" "how long did the export take?"). Choose properties from information the surrounding code already has access to — local variables, function arguments, state — never invent or hand-roll property values.

Property naming follows lowercase-with-spaces or snake_case based on the project's existing convention (detected via the \`discover-analytics-patterns\` skill). If no convention exists, use snake_case.

Examples:
  // GOOD — captures user-meaningful context the analyst needs
  amplitude.track("ai diagram generated", {
    prompt_length: prompt.length,
    model: "claude-sonnet-4-6",
    latency_ms: Date.now() - startedAt,
  });
  amplitude.track("collaboration session joined", { room_id: roomId });
  amplitude.track("canvas exported", { format: "png", element_count: elements.length });

  // BAD — bare event with no context; the chart can only count occurrences
  amplitude.track("scene saved to backend");
  amplitude.track("ai diagram generated");

If you genuinely cannot capture any property at a callsite (e.g., a pure lifecycle event like \`app loaded\` where the only available context is \`frame_id\` and you've already captured it), prefer a single property over zero — and document the gap in the Setup Report's "Instrumented" table as "(no properties captured — context unavailable at callsite)".`,

  `Event-plan size MUST scale with the signal in the codebase — do NOT artificially cap the plan at round numbers (5, 10, 12) regardless of project size. The floor is whatever the **discover-event-surfaces** skill turned up: count of route/page entries, distinct user-meaningful action callsites (form submits, mutations, network writes, dialog opens, navigation events), and the wrapper/helper hits from \`discover-analytics-patterns\`. A medium app (≈50+ routes / ≈20+ distinct user actions) typically warrants 20-40 events; a large monorepo or feature-rich SaaS can justifiably exceed that. The goal is COVERAGE of high-priority user actions, not minimal viable instrumentation — leaving real signal on the table for the sake of a tidy number is a quality regression.

The plan you pass to \`confirm_event_plan\` MUST be ordered by user-impact — most-used / most-load-bearing flows first (auth, primary creation/save actions, conversion-shaped events), supporting actions next, edge-case events last. Users review the plan top-down and may skim; the top entries are what the reviewer reads first and what gets shipped if they tap "looks good" early. Do NOT sort alphabetically, by file location, or by the order events surfaced during discovery.

The ONLY context where a hard cap is appropriate is DEMO_MODE — that constraint is owned by \`DEMO_MODE_COMMANDMENTS\` in this file and applied by the wizard itself; do not replicate or anticipate that cap in normal runs.`,

  'Post-instrumentation `.amplitude/events.json` array shape — read `.claude/skills/wizard-prompt-supplement/references/post-instrumentation-events-and-dashboard.md`. This run does NOT create charts or dashboards: do NOT call `record_dashboard` / `create_chart` / `create_dashboard` / `query_dataset` / any Amplitude MCP chart/dashboard tool — those are deferred to the `amplitude-wizard dashboard` command, which runs after ingestion catches up.',

  'Setup report format and `<wizard-report>` tags — read `.claude/skills/wizard-prompt-supplement/references/setup-report-requirements.md`. You MUST write `amplitude-setup-report.md` at the project root before the run ends.',

  `The Setup Report (\`amplitude-setup-report.md\`) MUST reconcile every event in the approved \`.amplitude/events.json\` plan. Each event lands in exactly one of three buckets:

  - **Instrumented** — a \`track()\` call was wired. Show the file path. Include any properties captured.
  - **Covered by autocapture** — no \`track()\` call needed because autocapture catches it. Name the specific autocapture surface (e.g., "element clicks via autocapture.elementInteractions" or "page views via autocapture.pageViews"). Generic "autocapture handles it" is insufficient — be specific so the user can verify.
  - **Dropped** — intentionally not wired AND not autocaptured. Explain why (e.g., "this event would require backend instrumentation we cannot reach from the client").

The sum of events across all three buckets MUST equal the count in the approved plan. A bullet count mismatch is a contract violation that hides work the user paid for from the agent (in tokens / time) and never received.`,

  'Prefer `report_status` (wizard-tools MCP) for progress updates and fatal errors. Use `kind="status"` for in-progress updates (appears in the spinner). Use `kind="error"` for fatal halts (codes: `MCP_MISSING`, `RESOURCE_MISSING`). Legacy `[STATUS]` / `[ERROR-MCP-MISSING]` / `[ERROR-RESOURCE-MISSING]` text markers from older bundled skills are still recognized for back-compat; new code should use `report_status`.',

  `Do NOT delete or "clean up" wizard-managed paths during the agent run. Owned by wizard lifecycle hooks:
  - \`.amplitude/\` and everything under it (\`events.json\`, \`dashboard.json\`, \`product-map.json\`, …) — the wizard writes project metadata only here
  - Legacy root \`.amplitude-events.json\` / \`.amplitude-dashboard.json\` — do not create or rewrite; leave existing files from older runs alone (reads may still use them during migration)
  - \`amplitude-setup-report.md\` (wizard archives previous runs itself)
  - \`.claude/skills/\` (wizard pre-stages and cleans these post-run)

The wizard runs explicit cleanup hooks AFTER your run (see \`cleanupIntegrationSkills\`, \`cleanupWizardArtifacts\`, \`archiveSetupReportFile\` in \`src/lib/wizard-tools.ts\`). \`rm\` is denied by the bash allowlist regardless of path. Same rule for \`mv\` / \`cp\` of these paths. If you find a stale wizard file, leave it and note in the setup report; the next wizard run handles migration.`,

  'When running Grep to discover analytics patterns or instrumentation surfaces, always pass `head_limit: 20` and exclude `node_modules/**`, `dist/**`, `build/**`, `**/*.test.*`, `**/*.spec.*` via the `glob` parameter. If the unfiltered result is large, use `output_mode: "count"` first to size the search, then narrow the pattern or path before requesting filenames. Wide unfiltered Grep results trigger context compaction and slow the run.',

  'Lint / format / build at end-of-run MUST be scoped to files you edited — pass explicit paths to `npx prettier --write <files>` / `npx eslint --fix <files>` / `npx tsc --noEmit`. Project-wide commands (`npm run build` / `npm run lint` / `pnpm lint` / `yarn lint` / `npx prettier --write .`) are forbidden — they hang on large repos. Rationale, time budget (combined <60s), and the third-attempt stop rule: read `.claude/skills/wizard-prompt-supplement/references/lint-scoping.md`.',
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

  `Browser autocapture surface catalog — these are the autocaptured event sources for @amplitude/unified / @amplitude/analytics-browser when their defaults are on. Cross-reference against the SDK init config you wrote, then drop any candidate event covered by an enabled surface from the \`confirm_event_plan\` events array (see the universal "Events fully covered by Amplitude autocapture MUST NOT be proposed" rule).

  - \`attribution\` — UTM / referrer attribution events
  - \`pageViews\` — SPA route changes and initial page loads (covers "Page Viewed", "Screen Viewed", "Route Changed")
  - \`sessions\` — session start / end (covers "Session Started", "Session Ended")
  - \`formInteractions\` — form starts and submits (covers "Form Submitted", "Form Started", "Input Changed")
  - \`fileDownloads\` — clicks on download links for common file types (covers "File Downloaded")
  - \`elementInteractions\` — clicks and changes on instrumented elements (covers "[X] Clicked", "Button Clicked", "Link Clicked", "Element Clicked", and any single-click-fired "Foo Pasted" / "Bar Exported" / "Baz Opened" event with no business-side state change)
  - \`frustrationInteractions\` — rage clicks and dead clicks (covers "Rage Click", "Dead Click")
  - \`networkTracking\` — XHR / fetch request events (covers any "Request Sent" / "Response Received" generic network events)
  - \`webVitals\` — LCP, INP, CLS on page hide (covers "Web Vitals" / per-metric events)
  - \`errorMonitoring\` — uncaught JS errors (covers "Error Occurred")
  - \`pageUrlEnrichment\` — adds path / search to event props (not a standalone event; no need to propose URL-tracking events)

Doc: https://amplitude.com/docs/data/sdks/browser-2/autocapture`,

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
