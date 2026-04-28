/**
 * Shared per-framework prompt lines for browser-SDK frameworks
 * (Next.js, Vue, React Router, JavaScript-Web).
 *
 * Each of these frameworks recommends `@amplitude/unified` and ends up
 * generating the same `initAll(...)` shape: full autocapture block,
 * sessionReplay plugin, engagement (Guides & Surveys) block, every
 * option line carrying an inline `// comment` so users tune by editing
 * code rather than via a wizard prompt. Keeping the guidance in one
 * place ensures the four framework prompts can't drift over time and
 * suggest different SDK shapes for what is essentially the same
 * browser-bundle install.
 *
 * The full schema and inline-comment requirement live in the global
 * commandments (`src/lib/commandments.ts` — "Browser SDK init defaults").
 * These per-framework lines are the brief version that surfaces
 * alongside framework-specific context (router type, env var prefix,
 * entry-point file).
 */

/**
 * One-line summary suitable for inclusion in a framework's
 * `getAdditionalContextLines`. Communicates:
 *   - Use `@amplitude/unified` (preferred over standalone browser SDK).
 *   - SR + G&S ship bundled — wizard auto-enables them.
 *   - Init shape + inline comments are governed by the wizard
 *     commandments; the agent must follow those exactly.
 */
export const BROWSER_UNIFIED_SDK_PROMPT_LINE = `Preferred BROWSER SDK: @amplitude/unified — single npm package that bundles @amplitude/analytics-browser, Session Replay, and Guides & Surveys (engagement). The wizard auto-enables all three so users get the full out-of-the-box coverage without a separate opt-in step. Follow the wizard commandments' "Browser SDK init defaults" exactly: full autocapture block + remoteConfig.fetchRemoteConfig nested under analytics:, sessionReplay: { sampleRate: 1 }, and engagement: {}. EVERY option line MUST have an inline // comment explaining what it does — that's the user's opt-out surface (comment the line for any feature they don't want). Do NOT copy a CDN snippet's flat-options shape onto initAll; the npm structure is different.`;
