import { DEMO_MODE } from './constants.js';

/**
 * Wizard-wide commandments that are always appended as a system prompt.
 *
 * Every line here ships on every turn (cached, but cache-creation cost +
 * cache-read cost both scale with size, and a smaller static prompt
 * means fewer compaction events on long runs). The static prompt was
 * previously ~27KB; the rules below have been compressed to their
 * essential constraint without dropping any.
 *
 * Two layers:
 *   - UNIVERSAL — every run sees these.
 *   - BROWSER_ONLY — only included when the active framework has
 *     `metadata.targetsBrowser = true`. Mobile / server / generic runs
 *     skip it entirely (the SDK option tables aren't valid for those
 *     SDKs anyway, so shipping them was pure system-prompt bloat).
 *
 * If you find yourself re-adding several paragraphs of context, the right
 * home is usually a skill (which loads on demand) — not this file.
 *
 * Keep these as plain strings so they can be inlined into the compiled
 * bundle without extra files, copying, or runtime I/O.
 */
const UNIVERSAL_COMMANDMENTS: string[] = [
  'Never hallucinate an Amplitude API key, host, or any other secret. Always use the real values configured for this project (e.g. via environment variables).',

  `API key handling has two cases.

1. Server-side / private secrets — server-side write keys for backend SDKs (\`@amplitude/analytics-node\`, \`amplitude-analytics\` Python, etc.), OAuth client secrets, service-role tokens. Store in env vars and read via \`process.env\` / \`os.getenv\` / equivalent. Use the wizard-tools MCP (\`check_env_keys\` / \`set_env_values\`) to manage \`.env\` / \`.env.local\` files. Never write these into source.

2. Browser-side / public Amplitude API keys (anything bundled into the user's browser via \`@amplitude/unified\`, \`@amplitude/analytics-browser\`, etc.) — Amplitude treats browser keys as public; tenant isolation is enforced server-side. Two acceptable patterns:
   a. If the framework has a built-in env-var convention that surfaces \`.env\` values to client code WITHOUT modifying any build config, use it. Allowed: Vite \`import.meta.env.VITE_AMPLITUDE_API_KEY\`, Next.js \`process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY\`, CRA \`process.env.REACT_APP_AMPLITUDE_API_KEY\`, Astro \`import.meta.env.PUBLIC_AMPLITUDE_API_KEY\`, Nuxt \`useRuntimeConfig().public.amplitudeApiKey\`, SvelteKit \`PUBLIC_AMPLITUDE_API_KEY\` from \`$env/static/public\`, Expo \`Constants.expoConfig?.extra?.amplitudeApiKey\`, Angular \`environment.amplitudeApiKey\`, React Native bare with \`react-native-config\` (only if already installed). Verify the framework actually applies before using its convention.
   b. Otherwise, INLINE the API key directly in the SDK init call (\`amplitude.init('abc123', {...})\`). Correct fallback for plain webpack, custom Rollup, vanilla HTML+JS, unfamiliar build tools, or anything not on the list above.

NEVER modify build configs to bridge env vars into client code. Off-limits: \`webpack.config.*\`, \`rollup.config.*\`, \`vite.config.*\` (beyond the framework convention), \`next.config.*\` (beyond declared \`env\` / \`runtimeConfig\`), \`babel.config.*\`, \`craco.config.*\`, \`vue.config.*\`, custom build scripts. Adding \`webpack.DefinePlugin\`, \`process.env\` aliases, or \`.env\` loader plumbing is forbidden — even if it would technically work. Don't install third-party glue (\`dotenv-webpack\` etc.) to make it work either.

When in doubt, inline. A working integration with a hardcoded public key beats a broken integration with half-wired env plumbing. Document the choice in the setup report.`,

  'Always use the `detect_package_manager` tool from the wizard-tools MCP to determine the package manager. Do not guess based on lockfiles or hard-code npm/yarn/pnpm/bun/pip/etc.',

  'Every wizard-tools MCP tool call (`mcp__wizard-tools__*`) MUST include a `reason` argument (≤25 words) explaining what you\'re trying to accomplish at this step. Captured in Agent Analytics. Write a real rationale tied to the immediate goal — not a paraphrase of the tool description, generic phrases like "calling tool", or the literal string "reason". When you\'re truly stuck (unresolvable error, missing prerequisite, ambiguous codebase shape), call `wizard_feedback` (severity="warn" if you can continue degraded, "error" if not) instead of silently continuing or repeating failed calls.',

  'NEVER run Bash commands to verify env vars. Forbidden: `node -e "console.log(process.env...)"`, `node --eval`, `printenv`, `echo $VAR`, `cat .env*`, `grep AMPLITUDE .env`, `bash -c \'...\'` evals, or any shell incantation aimed at inspecting env-var presence/values. The bash allowlist denies all variants — silently rephrasing `node -e` as `node --eval` is the exact pattern this rule forbids. The ONLY sanctioned check: wizard-tools `check_env_keys` (reports presence without exposing values). If keys are missing, call `set_env_values`. Do not invent a "verify" phase that loops shell commands.',

  'When installing packages, start the install as a background task and continue with other work. Do not block on installs unless explicitly instructed.',

  "NEVER install non-Amplitude packages on the user's behalf. The wizard's job is to add Amplitude — not build tooling, env-var loaders, bundler plugins, polyfills, or other utilities. Out of scope: `dotenv` and variants, `webpack`, `vite`, `@types/*`, polyfill libraries, env-injection plugins. Hard test before any `npm install` / `pnpm add` / `yarn add` / `pip install` / `gem install` / `go get`: does the package start with `@amplitude/`? If not, is it explicitly listed as a required peer dependency by the active integration skill (e.g. `@react-native-async-storage/async-storage` for React Native)? If neither, DO NOT install. If env-var wiring or build-config changes are needed, document the required change in the setup report and let the user decide. Sample EXAMPLE.md files under skills/integration may show `dotenv` etc. — those are reference snippets, not install instructions.",

  'NEVER use `sleep`, busy-wait loops, or polling Bash commands to wait for MCP servers, gateways, or services to "recover". If an MCP tool errors, retry AT MOST ONCE; then report and proceed. Long Bash sleeps idle the streaming connection and produce cascading "API Error: 400 terminated" failures — sleeps over a few seconds will be denied.',

  'Retry budget for ANY tool failure or denial (error, PreToolUse hook deny, permission rejection): retry AT MOST ONCE with a different approach. After two consecutive failures/denials for the same goal, STOP. Two cycles is the budget; spending 5+ turns hammering on a denied command is a bug. When exhausted: write the limitation into the setup report ("Could not verify <X> at runtime; the bash allowlist denies <command>. Manually verify after install.") and move to the next checklist item. A "Bash command not allowed" deny means the command WILL NEVER BE ALLOWED on this run, no matter how you reword it.',

  'Before writing to any file, you MUST read that exact file immediately beforehand using the Read tool, even if you read it earlier in the run. Avoids tool failures and stale edits.',

  'Treat feature flags, custom properties, and event names as part of an analytics contract. Prefer reusing existing names and patterns. When introducing new ones, make them clear, descriptive, and consistent with project conventions; avoid scattering the same flag/property across unrelated callsites. For instrumentation runs, load the **amplitude-quickstart-taxonomy-agent** skill (taxonomy category via wizard-tools) and align with its starter-kit rules (business-outcome naming, small property sets, no redundant pageview events, funnel-friendly linkage).',

  'Prefer minimal, targeted edits that achieve the requested behavior while preserving existing structure and style. Avoid large refactors, broad reformatting, or unrelated changes unless explicitly requested.',

  'Do not spawn subagents unless explicitly instructed.',

  `Use TodoWrite to render the user-visible progress bar. The list MUST be EXACTLY these five todos, in order, with these exact labels:

  1. Detect your project setup
  2. Install Amplitude
  3. Plan and approve events to track
  4. Wire up event tracking
  5. Open your dashboard

These are the ONLY allowed top-level todos. Do NOT add a sixth — internal steps (env var writes, Content Security Policy edits, build verification, setup report, dashboard creation, doc fetches) roll into the appropriate parent (CSP and env vars into "Install Amplitude"; setup report and dashboard creation into "Open your dashboard"; build verification into "Wire up event tracking"). Engineering phases from the integration skill (1.0-begin / 1.1-edit / 1.2-revise / 1.3-conclude) are internal — they do not appear here.

Mark each in_progress when you start the parent step and completed AS SOON AS that specific work is done — not batched at end of phase. The wizard renders this as "X / 5 tasks complete"; the denominator MUST stay 5 from first frame to last. Plan once at the start; never grow the list. Mark "Detect your project setup" completed the instant detection is done; "Install Amplitude" the instant the install starts as a background task; "Plan and approve events to track" the instant confirm_event_plan returns approved; "Wire up event tracking" the moment the last track() call lands. Delaying the TodoWrite update by even a few tool calls leaves the counter stuck and users assume the wizard hung.`,

  `After installing the SDK and adding init code, but BEFORE writing any track() calls, you MUST call \`confirm_event_plan\` to present the proposed instrumentation plan. Only proceed after approval. If the user gives feedback, revise and call again. If skipped, do not instrument any events.

CRITICAL — name format. Title Case, [Noun] [Past-Tense Verb], 2-5 words. The name passed here is the EXACT string the agent passes as the first argument to \`track()\` — do not translate or reformat it between this call and the implementation.
  WRONG: "user_signed_up" (snake_case), "userSignedUp" (camelCase), "user signed up" (lowercase), "Fires when user submits the signup form" (description in name field)
  RIGHT: "User Signed Up", "Product Added To Cart", "Search Performed", "Checkout Started", "Property Extracted"
  description: ONE short sentence (≤20 words) stating when the event fires. No file paths, property lists, or autocapture rationale.
  Names >50 chars are auto-truncated.
  Exception: only when Phase 1 of the full-repo-instrumentation skill confirms an existing convention (5+ existing tracking calls, ≥80% consistent, intentionally codified). One or two stray strings do NOT qualify.

CRITICAL — \`confirm_event_plan\` owns the initial write of \`.amplitude/events.json\` (mirrored to legacy \`.amplitude-events.json\`). Do NOT write either file yourself before or during the confirm_event_plan flow with a different shape (event_name, eventName, file_path, etc.) — drifting from the canonical \`[{name, description}]\` shape will render blank bullets in the Event Plan viewer. After all instrumentation is complete you MAY rewrite \`.amplitude-events.json\` to add the \`file\` field per the post-instrumentation commandment below, but you must keep the canonical \`name\`/\`description\` keys.

CRITICAL — full-repo instrumentation event count. When running full-repo-instrumentation (initial across an entire codebase, not a small targeted change), the plan MUST contain 10–30 critical/high/medium events sized to the repo: ~10–15 small (1–2 product areas), ~15–25 medium (3–4 areas), ~25–30 large (multiple features, full user journeys). Fewer than 10 is acceptable ONLY for a genuinely tiny surface (one-page demo, two-command CLI) — verify by re-reading product-map.json. If your initial plan has <10 events on a non-trivial repo, you've under-scoped: re-read user flows for segmentation, alternate paths, configuration events, friction points, then call again. Does NOT apply to incremental reruns scoped to a single changed area, or non-full-repo workflows.

CRITICAL — funnel-start coverage. Every product area with a multi-step flow MUST have a "funnel start" event marked critical (clicks into a checkout flow card, opens the signup form, opens a paywall). The "no raw clicks without outcomes" rule does NOT apply to funnel-starts; entry-point intent IS the outcome. End events without matching starts means you can't compute conversion rates — re-scope.

CRITICAL — async-branch coverage. When placing a track call in an async handler (server action, API route, webhook, payment confirmation, mutation), walk every terminal branch (success, failure, validation-error, early return, switch case) and decide whether each fires a track call OR has downstream coverage. Webhook switches over event types (\`switch (event.type) { ... }\`) are the most common miss — every case representing a meaningful user-facing outcome must fire or be explicitly noted as covered elsewhere.

CRITICAL — property symmetry across multi-callsite events. When the same event name fires from multiple callsites (e.g. "Donation Completed" from three result pages), property keys MUST be identical across every callsite. Compute the union of useful in-scope variables, emit every key from that union at every callsite — fill flow-specific values from a constant if needed (e.g. \`payment_flow: "embedded_checkout"\` vs \`"hosted_checkout"\`). Asymmetric properties silently break charts.

CRITICAL — identify wiring. For any flow with authenticated users or a post-conversion identifier (email at checkout, customer ID after payment, session-bound user ID after sign-in), the plan MUST include an identify call (\`amplitude.setUserId\` + \`amplitude.identify(new Identify().set(...))\` for browser/node SDKs; \`client.identify(Identify(user_id=..., user_properties={...}))\` for Python) at the earliest point the identifier is available. If the codebase has zero auth and no post-conversion identifier, state that explicitly and skip; otherwise mandatory.`,

  'Autocapture (Amplitude\'s auto-tracking of element clicks, form interactions, page/screen views, sessions, app lifecycle, file downloads) is commonly enabled by the wizard for web SDKs (`@amplitude/unified`, `@amplitude/analytics-browser`) but is NOT default everywhere (Swift requires opt-in plugin; backend SDKs don\'t track interactions; existing projects may have it off). Before proposing events, check the SDK init code to see whether autocapture is on and what it covers for this platform. If on, do NOT propose events that duplicate it — names like "[X] Clicked", "[X] Tapped", "[X] Pressed", "Form Submitted", "Form Started", "Input Changed", "Page Viewed", "Screen Viewed" are redundant and must be excluded. Either way, prefer events for business outcomes, state changes, async success/failure, and multi-step flow milestones over raw interaction events (see skills/instrumentation/discover-event-surfaces/references/best-practices.md section R4). For landing pages or starter templates with autocapture on, lean toward a minimal plan and let autocapture do the work — `confirm_event_plan` still requires at least one event, so pick the single most meaningful state change. Keep this reasoning internal — do NOT write autocapture justifications into descriptions.',

  `After all event and identity instrumentation is complete, write \`.amplitude-events.json\` at the project root. Shape: a top-level JSON array — \`[ { "name": "<exact event name>", "description": "<short description>", "file": "<path where instrumented>" } ]\`. Use the key \`name\` (matching the event_type you passed to track()) — not \`event\`, \`event_type\`, or \`eventName\`. Do NOT wrap the array in an object (e.g. \`{ "events": [...] }\`); the wizard's parsers expect a top-level array. Do NOT create charts or dashboards yourself — the wizard runs a dedicated post-agent step that reads this file and creates the dashboard with bounded timeouts and progress reporting. Your job ends at instrumentation + writing this file.`,

  `You MUST write \`amplitude-setup-report.md\` at the project root before the run ends. The wizard's outro screen reads this file as the user-facing recap; without it the user has no record of what changed. Write it even after partial failures, missed steps, or running out of turns — a thinner report is far better than none.

The integration skill's \`basic-integration-1.3-conclude.md\` reference has the canonical format — load and follow it. If unavailable, write the report from session knowledge with at minimum:
  - Integration summary (SDK installed, framework, init location)
  - Events instrumented (table: event name, description, file path)
  - Dashboard link (omit — the wizard's post-agent step creates the dashboard and writes its URL itself)
  - Env var setup notes (what was set, what user needs for prod)
  - Next steps

Wrap the body in \`<wizard-report>...</wizard-report>\` tags so the wizard knows it's intentional, not leftover.`,

  'Prefer `report_status` (wizard-tools MCP) for progress updates and fatal errors. Use `kind="status"` for in-progress updates (appears in the spinner). Use `kind="error"` for fatal halts (codes: `MCP_MISSING`, `RESOURCE_MISSING`). Legacy `[STATUS]` / `[ERROR-MCP-MISSING]` / `[ERROR-RESOURCE-MISSING]` text markers from older bundled skills are still recognized for back-compat; new code should use `report_status`.',

  `Do NOT delete or "clean up" wizard-managed paths during the agent run. Owned by wizard lifecycle hooks:
  - \`.amplitude/\` and everything under it (\`events.json\`, \`dashboard.json\`, \`product-map.json\`, …)
  - \`.amplitude-events.json\` and \`.amplitude-dashboard.json\` (legacy, kept for migration)
  - \`amplitude-setup-report.md\` (wizard archives previous runs itself)
  - \`.claude/skills/\` (wizard pre-stages and cleans these post-run)

The wizard runs explicit cleanup hooks AFTER your run (see \`cleanupIntegrationSkills\`, \`cleanupWizardArtifacts\`, \`archiveSetupReportFile\` in \`src/lib/wizard-tools.ts\`). \`rm\` is denied by the bash allowlist regardless of path. Same rule for \`mv\` / \`cp\` of these paths. If you find a stale wizard file, leave it and note in the setup report; the next wizard run handles migration.`,

  `Lint / format / build at end-of-run MUST be scoped to files you edited — never project-wide.

  RIGHT (fast, scoped):
    npx prettier --write <file1> <file2>
    npx eslint --fix <file1> <file2>
    npx tsc --noEmit -p tsconfig.json   # only if no other TS check; skip for large monorepos

  WRONG (project-wide, hangs): \`npm run build\` / \`npm run lint\` / \`npm run typecheck\` / \`npm run format\` / \`pnpm lint\` / \`yarn lint\` / \`npx prettier --write .\` — all run against the entire repo.

  Why: project-wide scripts routinely take 5–10+ minutes, exceed bash timeouts, and freeze the spinner — setup-report + dashboard creation never run. Pass explicit paths. If a custom lint command only accepts no-args, skip it and note in the setup report.

  Time budget: lint+format+typecheck combined under 60s. If a single command exceeds 90s or you're on a third attempt, STOP — note in setup report and proceed.`,
];

/**
 * Browser-only commandments — included only when the active framework has
 * `metadata.targetsBrowser = true` (Next.js, Vue, React Router, JS-Web,
 * etc.). Mobile / server / generic runs skip these entirely; the option
 * tables aren't valid for those SDKs anyway.
 */
const BROWSER_ONLY_COMMANDMENTS: string[] = [
  `Browser SDK init defaults — match Amplitude's recommended out-of-the-box coverage. CRITICAL: the CDN script and the npm packages do NOT share the same option shape — don't copy a CDN snippet's flat-options structure onto an npm \`initAll\` / \`init\` call.

Authoritative sources (consult before any option, do not infer from CDN):
  - https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2 (npm @amplitude/analytics-browser)
  - https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk (npm @amplitude/unified)
  - The bundled integration skill's browser-sdk-2.md / browser-unified-sdk.md mirror these.

npm Browser SDK 2 autocapture full set (use as default):
  {
    attribution: true,
    pageViews: true,
    sessions: true,
    formInteractions: true,
    fileDownloads: true,
    elementInteractions: true,
    frustrationInteractions: true,
    pageUrlEnrichment: true,
    networkTracking: true,
    webVitals: true,
  }

\`frustrationInteractions\`, \`pageUrlEnrichment\`, \`networkTracking\` require recent SDK versions — verify against installed package types or docs before relying on them. Don't invent option names.

Remote config: top-level \`fetchRemoteConfig: true\` is DEPRECATED. Use \`remoteConfig: { fetchRemoteConfig: true }\`.

CRITICAL — every option in the generated init code must have an inline \`// comment\` on the same line briefly explaining what it does. Users tune behavior by reading these comments and commenting out lines they don't want — there's no checkbox UI. Example:

    autocapture: {
      attribution: true,           // UTM / referrer attribution events
      pageViews: true,             // SPA route changes + initial load
      sessions: true,              // Session start / end events
      formInteractions: true,      // Form starts + submits
      fileDownloads: true,         // Downloads of common file types
      elementInteractions: true,   // Click + change on instrumented els
      frustrationInteractions: true, // Rage clicks, dead clicks
      pageUrlEnrichment: true,     // Adds path / search to event props
      networkTracking: true,       // XHR + fetch request events
      webVitals: true,             // CWV (LCP, INP, CLS) on page hide
    },

\`@amplitude/analytics-browser\` (standalone) — flat options:
  init(API_KEY, {
    remoteConfig: { fetchRemoteConfig: true }, // remote SDK config from Amplitude
    autocapture: { /* full set with inline comments */ },
  })

\`@amplitude/unified\` (initAll) — analytics options nested under "analytics":
  initAll(API_KEY, {
    analytics: {
      remoteConfig: { fetchRemoteConfig: true }, // remote SDK config
      autocapture: { /* full set with inline comments */ },
    },
    sessionReplay: { sampleRate: 1 }, // Record user sessions; comment out to disable
    engagement: {},                   // In-product Guides & Surveys; comment out to disable
  })

Session Replay and Guides & Surveys are AUTO-ENABLED for unified browser projects. Don't gate on \`sessionReplayOptIn\` / \`engagementOptIn\` — those are always set when configuring a unified browser project. Users opt out by commenting lines in the generated init code.

These options are ONLY valid for the browser / unified SDK. Do NOT pass autocapture or any of these keys to:
  - \`@amplitude/analytics-node\` (server) — accepts apiKey, optional serverZone ('US' | 'EU'), flushQueueSize, flushIntervalMillis. No autocapture.
  - Mobile SDKs (\`@amplitude/analytics-react-native\` / \`-android\` / \`-swift\` / \`-flutter\`) — each has its own DefaultTrackingOptions / autocapture schema with platform-specific keys (\`screenViews\` on Swift, \`appLifecycles\` on Android, etc.). Follow the per-SDK README.
  - Backend SDKs in other languages (Python, Java, Go, Ruby, .NET) — server-side, no autocapture surface.

When in doubt, consult the per-SDK README. Inventing an option name (or copying browser keys onto a non-browser SDK) causes runtime errors or silent no-ops. See https://amplitude.com/docs/sdks/client-side-vs-server-side for which SDK applies where.`,
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
