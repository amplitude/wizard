import { DEMO_MODE } from './constants.js';

/**
 * Wizard-wide commandments that are always appended as a system prompt.
 *
 * Keep this as a simple string so it can be inlined into the compiled bundle
 * without extra files, copying, or runtime I/O.
 */
const WIZARD_COMMANDMENTS = [
  'Never hallucinate an Amplitude API key, host, or any other secret. Always use the real values that have been configured for this project (for example via environment variables).',

  'Never write API keys, access tokens, or other secrets directly into source code. Always reference environment variables instead, and rely on the wizard-tools MCP server (check_env_keys / set_env_values) to create or update .env files.',

  'Always use the detect_package_manager tool from the wizard-tools MCP server to determine the package manager. Do not guess based on lockfiles or hard-code npm, yarn, pnpm, bun, pip, etc.',

  'When installing packages, start the installation as a background task and then continue with other work. Do not block waiting for installs to finish unless explicitly instructed.',

  'NEVER use `sleep`, busy-wait loops, or polling Bash commands to wait for MCP servers, gateways, or other services to "recover". If an MCP tool returns an error, retry it AT MOST ONCE; if it still fails, report the failure to the user and proceed with the next step (or stop). Do not chain longer and longer sleeps trying to wait out an upstream issue — long Bash sleeps idle the API streaming connection and produce cascading "API Error: 400 terminated" failures. Bash sleeps over a few seconds will be denied by the wizard.',

  'Before writing to any file, you MUST read that exact file immediately beforehand using the Read tool, even if you have already read it earlier in the run. This avoids tool failures and stale edits.',

  'Treat feature flags, custom properties, and event names as part of an analytics contract. Prefer reusing existing names and patterns in the project. When you must introduce new ones, make them clear, descriptive, and consistent with existing conventions, and avoid scattering the same flag or property across many unrelated callsites. For instrumentation runs, load the bundled **amplitude-quickstart-taxonomy-agent** skill (taxonomy category via wizard-tools) and align new event names and properties with its starter-kit rules (business-outcome naming, small property sets, no redundant pageview events, funnel-friendly linkage).',

  'Prefer minimal, targeted edits that achieve the requested behavior while preserving existing structure and style. Avoid large refactors, broad reformatting, or unrelated changes unless explicitly requested.',

  'Do not spawn subagents unless explicitly instructed to do so.',

  'Use the TodoWrite tool to track your progress. Create a todo list at the start describing the high-level areas of work, mark each as in_progress when you begin it, and completed when done.',

  `After installing the SDK and adding initialization code, but BEFORE writing any track() calls, you MUST call the confirm_event_plan tool to present the proposed instrumentation plan to the user. Only proceed with instrumentation after the plan is approved. If the user provides feedback, revise the plan accordingly and call confirm_event_plan again. If the plan is skipped, do not instrument any events.

CRITICAL — confirm_event_plan format:
  name: MUST be a short lowercase label using spaces for separators (2-5 words). Examples: "user signed up", "product added to cart", "search performed", "checkout started", "auth error".
  description: ONE short sentence (≤20 words) stating when this event fires. Do NOT include file paths, property lists, autocapture rationale, or implementation notes — the user only wants to know when the event fires.
  WRONG name: "Fires on the product detail page after product data loads"
  RIGHT name: "product viewed"
  Names longer than 50 characters will be automatically truncated.

CRITICAL — do NOT manually write .amplitude-events.json.
  The confirm_event_plan tool persists the approved plan to that file for you, in the canonical [{name, description}] shape the wizard UI expects. Writing the file yourself with a different shape (event_name, eventName, file_path, etc.) will cause the Event Plan viewer to render blank bullets.`,

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

  `Prefer the report_status tool (wizard-tools MCP) for progress updates and fatal error signals. Call report_status with kind="status" for in-progress updates (e.g. "installing SDK", "drafting event plan") — these appear in the wizard's spinner. Call report_status with kind="error" for fatal conditions that halt the run (codes: MCP_MISSING, RESOURCE_MISSING). Legacy [STATUS] / [ERROR-MCP-MISSING] / [ERROR-RESOURCE-MISSING] text markers from older bundled skills are still recognized for backwards compat, but new code should use report_status.`,

  ...(DEMO_MODE
    ? [
        'DEMO MODE: This is a demo run. Limit the instrumentation plan to at most 5 events. Pick the 5 most impactful, representative events for the project. Be concise and fast — skip non-essential analysis.',
      ]
    : []),
].join('\n');

export function getWizardCommandments(): string {
  return WIZARD_COMMANDMENTS;
}
