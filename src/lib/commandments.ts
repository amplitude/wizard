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

  'Before writing to any file, you MUST read that exact file immediately beforehand using the Read tool, even if you have already read it earlier in the run. This avoids tool failures and stale edits.',

  'Treat feature flags, custom properties, and event names as part of an analytics contract. Prefer reusing existing names and patterns in the project. When you must introduce new ones, make them clear, descriptive, and consistent with existing conventions, and avoid scattering the same flag or property across many unrelated callsites. For instrumentation runs, load the bundled **amplitude-quickstart-taxonomy-agent** skill (taxonomy category via wizard-tools) and align new event names and properties with its starter-kit rules (business-outcome naming, small property sets, no redundant pageview events, funnel-friendly linkage).',

  'Prefer minimal, targeted edits that achieve the requested behavior while preserving existing structure and style. Avoid large refactors, broad reformatting, or unrelated changes unless explicitly requested.',

  'Do not spawn subagents unless explicitly instructed to do so.',

  'Use the TodoWrite tool to track your progress. Create a todo list at the start describing the high-level areas of work, mark each as in_progress when you begin it, and completed when done.',

  `After installing the SDK and adding initialization code, but BEFORE writing any track() calls, you MUST call the confirm_event_plan tool to present the proposed instrumentation plan to the user. Only proceed with instrumentation after the plan is approved. If the user provides feedback, revise the plan accordingly and call confirm_event_plan again. If the plan is skipped, do not instrument any events.

CRITICAL — confirm_event_plan format:
  name: MUST be a short lowercase label using spaces for separators (2-5 words). Examples: "user signed up", "product added to cart", "search performed", "checkout started", "auth error".
  description: Put ALL details here — when it fires, properties, file paths.
  WRONG name: "Fires on the product detail page after product data loads"
  RIGHT name: "product viewed"
  Names longer than 50 characters will be automatically truncated.`,

  `Autocapture — the Amplitude feature that automatically tracks element clicks, form interactions, page/screen views, sessions, app lifecycle events, and file downloads — is commonly enabled by the wizard for web SDKs (@amplitude/unified, @amplitude/analytics-browser) but is NOT available or not on by default for every SDK (e.g. Swift requires an opt-in plugin, backend SDKs don't track element interactions at all, and an existing project may have it disabled). Before proposing events in confirm_event_plan, check the SDK init code you just wrote (or that already exists) to see whether autocapture is on and what it covers for this platform. If it IS on, do NOT propose custom events that merely duplicate its coverage — names like "[X] Clicked", "[X] Tapped", "[X] Pressed", "Form Submitted", "Form Started", "Input Changed", "Page Viewed", or "Screen Viewed" are redundant and must be excluded. Either way, prefer events for business outcomes, state changes, async success/failure, and multi-step flow milestones over raw interaction events (see skills/instrumentation/discover-event-surfaces/references/best-practices.md section R4). If autocapture is on and the project is a landing page or starter template whose only interactions are plain clicks and links, lean toward a minimal plan and let autocapture do the work — confirm_event_plan still requires at least one event, so pick the single most meaningful state change.`,

  `Do not call \`create_chart\` or \`create_dashboard\` on the Amplitude MCP, and do not write \`.amplitude-dashboard.json\`. The wizard creates the dashboard directly via its own REST call after your run completes — your job is to instrument events, nothing more on the dashboard side.`,

  ...(DEMO_MODE
    ? [
        'DEMO MODE: This is a demo run. Limit the instrumentation plan to at most 5 events. Pick the 5 most impactful, representative events for the project. Be concise and fast — skip non-essential analysis.',
      ]
    : []),
].join('\n');

export function getWizardCommandments(): string {
  return WIZARD_COMMANDMENTS;
}
