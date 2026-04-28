import { DEMO_MODE } from './constants.js';

/**
 * Wizard-wide commandments that are always appended as a system prompt.
 *
 * Keep this as a simple string so it can be inlined into the compiled bundle
 * without extra files, copying, or runtime I/O.
 */
const WIZARD_COMMANDMENTS = [
  'Never hallucinate an Amplitude API key, host, or any other secret. Always use the real values that have been configured for this project (for example via environment variables).',

  `Server-side / private secrets — service-role tokens, OAuth client secrets, server-side Amplitude write keys for backend SDKs (\`@amplitude/analytics-node\`, \`amplitude-analytics\` Python, etc.) — MUST be stored in environment variables and read from \`process.env\` / \`os.getenv\` / equivalent. Use the wizard-tools MCP server (\`check_env_keys\` / \`set_env_values\`) to create or update \`.env\` / \`.env.local\` files. Never write these values into source code.

Browser-side / public-by-design Amplitude API keys (anything shipped to the user's browser via \`@amplitude/unified\`, \`@amplitude/analytics-browser\`, or any client-side SDK) follow a DIFFERENT rule: the value will be visible in the production bundle anyway — Amplitude's security model treats browser keys as public and enforces tenant isolation server-side. So:

  1. **PREFER env vars ONLY when the project's framework already has a built-in, well-known convention** that surfaces \`.env\` values to client code WITHOUT requiring you to modify any build config. Allowed conventions (must match exactly):
     - Vite: \`import.meta.env.VITE_AMPLITUDE_API_KEY\` (key in \`.env\` / \`.env.local\` prefixed \`VITE_\`)
     - Next.js: \`process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY\` (prefix \`NEXT_PUBLIC_\`)
     - Create React App / react-scripts: \`process.env.REACT_APP_AMPLITUDE_API_KEY\` (prefix \`REACT_APP_\`)
     - Astro: \`import.meta.env.PUBLIC_AMPLITUDE_API_KEY\` (prefix \`PUBLIC_\`)
     - Nuxt 3+: \`useRuntimeConfig().public.amplitudeApiKey\` via \`runtimeConfig.public\` in \`nuxt.config.ts\`
     - SvelteKit: \`PUBLIC_AMPLITUDE_API_KEY\` from \`$env/static/public\`
     - Expo: \`Constants.expoConfig?.extra?.amplitudeApiKey\` from \`app.config.js\` extras
     - Angular: \`environment.amplitudeApiKey\` from \`src/environments/environment.ts\` (NOT \`process.env\`)
     - React Native (bare): \`react-native-config\` reading \`AMPLITUDE_API_KEY\` from \`.env\` (only if \`react-native-config\` is ALREADY installed)
     Verify the project actually uses the matching framework (look at \`package.json\` deps, config files) before applying its convention.

  2. **Otherwise, INLINE the API key directly in the SDK init call** (e.g. \`amplitude.init('abc123', { autocapture: true })\`). This is the correct fallback for: plain webpack with no env loader, custom Rollup setups, vanilla HTML+JS, unfamiliar build tools, or any case where you can't find the project on the allowed-conventions list above. Browser Amplitude keys are public; inlining is safe.

  3. **NEVER modify build configs to bridge env vars into client code.** Off-limits files: \`webpack.config.js\` / \`webpack.*.js\`, \`rollup.config.*\`, \`vite.config.*\` (beyond what the framework's convention already does), \`next.config.*\` (beyond \`env\` / \`runtimeConfig\` declarations), \`babel.config.*\`, \`craco.config.*\`, \`vue.config.*\`, custom build scripts. Adding \`webpack.DefinePlugin\`, configuring \`process.env\` aliases, or wiring a \`.env\` loader into the bundle counts as modifying build config and is forbidden — even if it would technically work. (Combine with the no-third-party-installs rule: you also can't install \`dotenv-webpack\` etc. to bridge the gap.)

  4. **When in doubt, INLINE.** A working integration with a hardcoded public Amplitude key beats a broken integration with half-wired env-var plumbing. The user can swap to env vars later. Document the choice in the setup report ("Inlined the Amplitude API key in \`src/amplitude.js\`. To swap to env vars later, …") so the user knows what was done and how to change it.`,

  'Always use the detect_package_manager tool from the wizard-tools MCP server to determine the package manager. Do not guess based on lockfiles or hard-code npm, yarn, pnpm, bun, pip, etc.',

  'EVERY call to a wizard-tools MCP tool (mcp__wizard-tools__*) MUST include a `reason` argument: a short sentence (≤25 words) explaining what you are trying to accomplish at this step. This is captured in Agent Analytics so the team can understand intent across runs. Write a real rationale tied to the immediate goal — not a paraphrase of the tool description, not a generic phrase like "calling tool", and not the literal string "reason". When you (the agent) get truly stuck — unresolvable error, missing prerequisite, ambiguous codebase shape — call wizard_feedback (severity="warn" if you can continue degraded, "error" if not) instead of silently continuing or repeating failed tool calls.',

  `NEVER run Bash commands to verify environment variables at runtime. Specifically forbidden: \`node -e "console.log(process.env...)"\`, \`node --eval ...\`, \`printenv\`, \`echo $VAR\`, \`cat .env\` / \`cat .env.local\`, \`grep AMPLITUDE .env\`, \`bash -c '...'\` shell-eval workarounds, or any other shell incantation aimed at inspecting env-var presence or values. The wizard's bash allowlist denies all of these (and will continue to deny all variants — see the retry-budget commandment), and \`.env\` reads are blocked because the values are secrets. The ONLY sanctioned path: call the wizard-tools MCP \`check_env_keys\` tool — it reports key presence without exposing values. If \`check_env_keys\` confirms the keys are present, env-var configuration is correct; do not double-check via shell. If keys are missing, call \`set_env_values\` to add them; do not run a shell command to investigate. Do not invent a "verify" phase that loops shell commands trying to confirm what \`check_env_keys\` already told you. Do not write a Node one-liner to dump \`process.env\`. There is no fallback verification mechanism — \`check_env_keys\` is sufficient, and no other path is permitted.`,

  'When installing packages, start the installation as a background task and then continue with other work. Do not block waiting for installs to finish unless explicitly instructed.',

  `NEVER install non-Amplitude packages on the user's behalf. The wizard's job is to add Amplitude to the project, not to install build tooling, environment-variable loaders, bundler plugins, polyfills, or any other third-party utility. Concrete examples that are OUT OF SCOPE: \`dotenv\`, \`dotenv-webpack\`, \`dotenv-cli\`, \`dotenv-rails\`, \`python-dotenv\`, \`webpack\`, \`vite\`, \`@types/*\`, polyfill libraries, env-injection plugins. The hard test before any \`npm install\` / \`pnpm add\` / \`yarn add\` / \`pip install\` / \`gem install\` / \`go get\` / etc. command: does the package name start with \`@amplitude/\`? If not, is it explicitly listed as a required peer dependency by the active integration skill (e.g. \`@react-native-async-storage/async-storage\` for the React Native SDK)? If neither is true, DO NOT install it. If env-var wiring or build configuration changes are required for the SDK to work, document the required change in the setup report and let the user decide — do not auto-install third-party glue. Sample EXAMPLE.md files under \`skills/integration/*/references/\` may show \`dotenv\` / \`python-dotenv\` / \`dotenv-rails\` in their illustrative code; those are reference snippets, not install instructions, and you must NOT install those packages unless the user's project already uses them.`,

  'NEVER use `sleep`, busy-wait loops, or polling Bash commands to wait for MCP servers, gateways, or other services to "recover". If an MCP tool returns an error, retry it AT MOST ONCE; if it still fails, report the failure to the user and proceed with the next step (or stop). Do not chain longer and longer sleeps trying to wait out an upstream issue — long Bash sleeps idle the API streaming connection and produce cascading "API Error: 400 terminated" failures. Bash sleeps over a few seconds will be denied by the wizard.',

  `Retry budget for ANY tool failure or denial. The same rule applies whether a tool call returned an error, was denied by the wizard's PreToolUse hook (\`Hook PreToolUse:Bash denied this tool\`), or hit a permission rejection: retry AT MOST ONCE with a different approach. After two consecutive failures or denials for the same goal, STOP — do NOT keep trying variants of the same command. Two cycles is the budget; spending 5, 10, or 47 turns hammering on a denied command is a bug, not perseverance. When the budget is exhausted: write the limitation into the setup report ("Could not verify <X> at runtime; the wizard's bash allowlist denies <command>. Manually verify after install.") and move on to the next checklist item — do not loop. Specifically: a "Bash command not allowed" deny means the command WILL NEVER BE ALLOWED on this run, no matter how you reword it; silently rephrasing \`node -e ...\` as \`node --eval ...\` or \`echo ...\` is the exact pattern this rule forbids.`,

  'Before writing to any file, you MUST read that exact file immediately beforehand using the Read tool, even if you have already read it earlier in the run. This avoids tool failures and stale edits.',

  'Treat feature flags, custom properties, and event names as part of an analytics contract. Prefer reusing existing names and patterns in the project. When you must introduce new ones, make them clear, descriptive, and consistent with existing conventions, and avoid scattering the same flag or property across many unrelated callsites. For instrumentation runs, load the bundled **amplitude-quickstart-taxonomy-agent** skill (taxonomy category via wizard-tools) and align new event names and properties with its starter-kit rules (business-outcome naming, small property sets, no redundant pageview events, funnel-friendly linkage).',

  'Prefer minimal, targeted edits that achieve the requested behavior while preserving existing structure and style. Avoid large refactors, broad reformatting, or unrelated changes unless explicitly requested.',

  'Do not spawn subagents unless explicitly instructed to do so.',

  `Use the TodoWrite tool to render the user-visible progress bar. The list MUST be EXACTLY these five todos, in this order, with these exact labels:

  1. Detect your project setup
  2. Install Amplitude
  3. Plan and approve events to track
  4. Wire up event tracking
  5. Open your dashboard

These are the ONLY allowed top-level todos. Do NOT add a sixth for the setup report, build verification, Content Security Policy edits, doc fetches, env var writes, or any other internal step — those are implementation details that roll into the appropriate parent step (e.g. CSP edits and env vars belong inside "Install Amplitude"; the setup report and dashboard creation belong inside "Open your dashboard"; build verification belongs inside "Wire up event tracking"). Engineering phases from the integration skill (1.0-begin, 1.1-edit, 1.2-revise, 1.3-conclude) are internal — they do not appear here.

Mark each todo in_progress when you start the parent step and completed when its user-visible deliverable is on disk or live. Plan once at the start; never grow the list. The wizard renders this as a "X / 5 tasks complete" bar — a denominator that drifts from 5 → 8 → 12 mid-run looks like the wizard is broken. The denominator MUST stay 5 from the first frame to the last.`,

  `After installing the SDK and adding initialization code, but BEFORE writing any track() calls, you MUST call the confirm_event_plan tool to present the proposed instrumentation plan to the user. Only proceed with instrumentation after the plan is approved. If the user provides feedback, revise the plan accordingly and call confirm_event_plan again. If the plan is skipped, do not instrument any events.

CRITICAL — confirm_event_plan format:
  name: MUST be Title Case following [Noun] [Past-Tense Verb] (2-5 words). Examples: "User Signed Up", "Product Added To Cart", "Search Performed", "Checkout Started", "Property Extracted". The name passed here is the EXACT string the agent will pass as the first argument to track() — do not translate or reformat it between this tool call and the implementation.
  description: ONE short sentence (≤20 words) stating when this event fires. Do NOT include file paths, property lists, autocapture rationale, or implementation notes — the user only wants to know when the event fires.
  WRONG name: "user_signed_up" (snake_case), "userSignedUp" (camelCase), "user signed up" (lowercase), "Fires when user submits the signup form" (description in name field)
  RIGHT name: "User Signed Up"
  The only exception to Title Case is when Phase 1 of the full-repo-instrumentation skill confirms an existing codebase convention (5+ existing tracking calls, ≥80% consistent, intentionally codified). One or two stray strings do NOT qualify.
  Names longer than 50 characters will be automatically truncated.

CRITICAL — do NOT manually write .amplitude/events.json (or the legacy .amplitude-events.json).
  The confirm_event_plan tool persists the approved plan to .amplitude/events.json for you, in the canonical [{name, description}] shape the wizard UI expects. Writing the file yourself with a different shape (event_name, eventName, file_path, etc.) will cause the names in the manifest to drift from the names in the actual track() calls.

CRITICAL — full-repo instrumentation event count.
  When running the full-repo-instrumentation skill (initial instrumentation across an entire codebase, not a small targeted change), the approved plan MUST contain 10–30 events at critical/high/medium priority, sized to the repo:
    - ~10–15 for a small repo (1–2 product areas, simple flows)
    - ~15–25 for a medium repo (3–4 areas, multiple components)
    - ~25–30 for a large repo (multiple features, full user journeys)
  Fewer than 10 is acceptable ONLY for a genuinely tiny surface (one-page demo, two-command CLI) — verify by re-reading product-map.json before settling on a small plan. If your initial plan has fewer than 10 events on a non-trivial repo, you have under-scoped: re-read user flows for segmentation dimensions, alternate paths, configuration events, and friction points you skipped, then call confirm_event_plan again with the expanded plan. This rule does not apply to incremental reruns scoped to a single changed area, nor to non-full-repo workflows (diff-intake, single-file instrumentation, etc.).

CRITICAL — funnel-start coverage.
  Every product area with a multi-step user flow MUST have a "funnel start" event marked critical — the moment the user expresses intent to enter the flow (clicks into a checkout flow card, opens the signup form, opens a paywall, etc.). The "no raw clicks without outcomes" rule does NOT apply to funnel-start events; entry-point intent is itself the outcome. If your plan has end events without matching start events, you cannot compute conversion rates — re-scope and add the missing starts.

CRITICAL — async-branch coverage.
  When you place a track call inside an async handler (server action, API route, webhook handler, payment confirmation, mutation), walk every terminal branch (success, failure, validation-error, early return, switch case) and decide for each one whether a track call fires there OR whether downstream coverage exists. Webhook switches over event types (\`switch (event.type) { ... }\`) are the most common place this gets missed — every case that represents a meaningful user-facing outcome must either fire a track call or be explicitly noted in the plan reasoning as covered elsewhere.

CRITICAL — property symmetry across multi-callsite events.
  When the same event name fires from more than one callsite (same event_type emitted from multiple files, e.g. a "Donation Completed" event fired from three different result pages), the property keys MUST be identical across every callsite. Compute the union of useful in-scope variables across all callsites, then emit every key from that union at every callsite — fill in flow-specific values from a constant if necessary (e.g. \`payment_flow: "embedded_checkout"\` vs \`payment_flow: "hosted_checkout"\`). Asymmetric properties on the same event silently break charts.

CRITICAL — identify wiring.
  For any flow with authenticated users or a post-conversion identifier (email at checkout, customer ID after payment, session-bound user ID after sign-in), the plan MUST include an identify call (\`amplitude.setUserId\` + \`amplitude.identify(new Identify().set(...))\` for browser/node SDKs; \`client.identify(Identify(user_id=..., user_properties={...}))\` for Python) placed at the earliest point the identifier becomes available. If the codebase has zero auth and no post-conversion identifier, state that explicitly in the plan and skip identify wiring; otherwise it is mandatory.`,

  `Autocapture — the Amplitude feature that automatically tracks element clicks, form interactions, page/screen views, sessions, app lifecycle events, and file downloads — is commonly enabled by the wizard for web SDKs (@amplitude/unified, @amplitude/analytics-browser) but is NOT available or not on by default for every SDK (e.g. Swift requires an opt-in plugin, backend SDKs don't track element interactions at all, and an existing project may have it disabled). Before proposing events, check the SDK init code you just wrote (or that already exists) to see whether autocapture is on and what it covers for this platform. If it IS on, do NOT propose custom events that merely duplicate its coverage — names like "[X] Clicked", "[X] Tapped", "[X] Pressed", "Form Submitted", "Form Started", "Input Changed", "Page Viewed", or "Screen Viewed" are redundant and must be excluded. Either way, prefer events for business outcomes, state changes, async success/failure, and multi-step flow milestones over raw interaction events (see skills/instrumentation/discover-event-surfaces/references/best-practices.md section R4). If autocapture is on and the project is a landing page or starter template whose only interactions are plain clicks and links, lean toward a minimal plan and let autocapture do the work — confirm_event_plan still requires at least one event, so pick the single most meaningful state change. Keep this reasoning internal — do NOT write autocapture justifications into the description field.`,

  `Browser SDK init defaults — give projects the same out-of-the-box coverage Amplitude recommends in the docs. CRITICAL: the CDN script and the npm packages do NOT share the same option shape. Do not copy a CDN snippet's flat-options structure onto an npm \`initAll\` / \`init\` call — the keys and nesting are different.

  Authoritative sources (consult before adding any option — do not infer from CDN examples):
    - https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2 (npm @amplitude/analytics-browser config table)
    - https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk (npm @amplitude/unified; "All options from @amplitude/analytics-browser are supported" inside the analytics block)
    - The bundled integration skill's browser-sdk-2.md / browser-unified-sdk.md mirror these.

  npm Browser SDK 2 autocapture keys (the full set documented in the Autocapture Options table):
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

  Use the FULL set as the default. Some keys (frustrationInteractions, pageUrlEnrichment, networkTracking) require recent SDK versions — verify against the installed package's TypeScript types or the docs page above before relying on them. Do NOT invent option names.

  Remote config: top-level \`fetchRemoteConfig: true\` is DEPRECATED. Use the nested form: \`remoteConfig: { fetchRemoteConfig: true }\`.

  CRITICAL — every option in the generated init code must have an inline \`// comment\` on the same line that briefly explains what it does. The wizard does NOT show users a checkbox picker — instead, users tune behavior by reading these comments and commenting out lines they don't want. If the comments are missing, the user has no surface to opt out of features they don't actually want. Example for the autocapture block:

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

  @amplitude/analytics-browser (standalone) — flat options:
    init(API_KEY, {
      remoteConfig: { fetchRemoteConfig: true }, // remote SDK config from Amplitude
      autocapture: { ...full set above with inline comments },
    })

  @amplitude/unified (initAll) — analytics options nested under "analytics":
    initAll(API_KEY, {
      analytics: {
        remoteConfig: { fetchRemoteConfig: true }, // remote SDK config from Amplitude
        autocapture: { ...full set above with inline comments },
      },
      sessionReplay: { sampleRate: 1 }, // Record user sessions; comment out to disable
      engagement: {},                   // In-product Guides & Surveys; comment out to disable
    })

  Session Replay and Guides & Surveys are AUTO-ENABLED for unified SDK browser projects (they ship with @amplitude/unified). Do NOT gate them on \`sessionReplayOptIn\` / \`engagementOptIn\` — those flags are always set when the wizard is configuring a unified browser project. Users opt out by commenting out the sessionReplay or engagement line in the generated init code, not via a wizard prompt.

  These options are ONLY valid for the browser / unified SDK. Do NOT pass an autocapture block — or any of these keys — to:
    - @amplitude/analytics-node (server) — accepts apiKey, optional serverZone ('US' | 'EU'), flushQueueSize, flushIntervalMillis. No autocapture concept.
    - Mobile SDKs (@amplitude/analytics-react-native, @amplitude/analytics-android, @amplitude/analytics-swift, @amplitude/analytics-flutter) — each has its own DefaultTrackingOptions / autocapture schema with platform-specific keys (e.g. screenViews on Swift; appLifecycles on Android). Follow the per-SDK README, do not copy the browser shape.
    - Backend SDKs in other languages (Python, Java, Go, Ruby, .NET) — server-side, no autocapture surface.

  When in doubt, consult https://amplitude.com/docs/sdks and the specific SDK's README before adding any option. Inventing an option name (or copying browser keys onto a non-browser SDK) will cause runtime errors or silently no-op. Refer to https://amplitude.com/docs/sdks/client-side-vs-server-side for guidance on which SDK applies to which surface.`,

  `After all event and identity instrumentation is complete, you MUST create a dashboard via the Amplitude MCP. This is a hard requirement — do not skip it. Load the amplitude-chart-dashboard-plan skill (taxonomy category via wizard-tools) and follow it exactly. The dashboard is a first-class deliverable.`,

  `You MUST write \`amplitude-setup-report.md\` at the project root before the run ends. This is an absolute requirement — the wizard's outro screen reads from this file as the user-facing recap of the integration, and without it the user has no record of what changed. Write the report even if you ran out of turns, hit a partial failure earlier, or had to skip steps; a thinner report is far better than none.

The integration skill you loaded contains a \`basic-integration-1.3-conclude.md\` reference with the canonical format — load and follow it. If you cannot locate that reference (older skill, partial install, etc.), write the report yourself from session knowledge. At a minimum the report MUST include:
  - Integration summary (SDK installed, framework, init location)
  - Events instrumented (table with event name, description, file path)
  - Dashboard link (the URL returned by the Amplitude MCP when you created the dashboard)
  - Environment variable setup notes (what was set, what the user needs to configure for prod)
  - Next steps the user should take

Wrap the body in \`<wizard-report>...</wizard-report>\` tags so the wizard knows the report was authored intentionally and not a leftover from a previous run.`,

  `Prefer the report_status tool (wizard-tools MCP) for progress updates and fatal error signals. Call report_status with kind="status" for in-progress updates (e.g. "installing SDK", "drafting event plan") — these appear in the wizard's spinner. Call report_status with kind="error" for fatal conditions that halt the run (codes: MCP_MISSING, RESOURCE_MISSING). Legacy [STATUS] / [ERROR-MCP-MISSING] / [ERROR-RESOURCE-MISSING] text markers from older bundled skills are still recognized for backwards compat, but new code should use report_status.`,

  `Do NOT delete or "clean up" wizard-managed files. The following paths are owned by the wizard's lifecycle hooks and MUST be left in place during the agent run:
    - \`.amplitude/\` (and everything under it: \`events.json\`, \`dashboard.json\`, \`product-map.json\`, etc.)
    - \`.amplitude-events.json\` and \`.amplitude-dashboard.json\` at the project root (legacy paths the wizard still reads from for migration)
    - \`amplitude-setup-report.md\` (the wizard archives the previous run's report itself)
    - \`.claude/skills/\` (the wizard pre-stages and cleans these up post-run)
  The wizard runs explicit cleanup hooks AFTER your run completes (see \`cleanupIntegrationSkills\`, \`cleanupWizardArtifacts\`, \`archiveSetupReportFile\` in \`src/lib/wizard-tools.ts\`). Running \`rm\` on any of these from inside the agent is unnecessary AND will be denied by the bash allowlist — \`rm\` is not on the allowlist regardless of path. If you find a stale wizard file you think shouldn't be there, leave it alone and note it in the setup report; the next wizard run handles migration. Same rule for \`mv\` / \`cp\` of these paths: don't.`,

  ...(DEMO_MODE
    ? [
        'DEMO MODE: This is a demo run. Limit the instrumentation plan to at most 5 events. Pick the 5 most impactful, representative events for the project. Be concise and fast — skip non-essential analysis.',
      ]
    : []),
].join('\n');

export function getWizardCommandments(): string {
  return WIZARD_COMMANDMENTS;
}
