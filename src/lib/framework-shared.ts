/**
 * Shared constants and small builders used by per-framework `FrameworkConfig`
 * objects. The goal is to keep behaviour identical to inlining (so framework
 * detection order, prompt text, env handling, and outro copy all stay byte
 * identical) while removing line-for-line duplication across the 18
 * `*-wizard-agent.ts` files.
 *
 * Anything load-bearing for prompt content goes here as a `const` — never as a
 * function that rewrites or trims, so the agent sees the exact same string it
 * would have if the framework had inlined it.
 */
import type { WizardOptions } from '../utils/types';
import { getPackageVersion } from '../utils/package-json';
import { tryGetPackageJson } from '../utils/package-json-light';

// ── Outro / UI strings ─────────────────────────────────────────────────

/**
 * Success message shown in every framework's outro. Kept identical across
 * frameworks intentionally — the wording is part of the wizard's UX
 * commitment ("integration complete" not "wizard finished").
 */
export const SUCCESS_MESSAGE_INTEGRATION_COMPLETE =
  'Amplitude integration complete';

/**
 * Final-step bullet shown in (almost) every framework's outro next-steps.
 * Phrased as an imperative so it reads naturally after framework-specific
 * verification steps.
 */
export const OUTRO_DASHBOARD_LINE =
  'Visit your Amplitude dashboard to see incoming events';

// ── Project-type detection blurbs ──────────────────────────────────────

/**
 * Project-type detection blurb for JavaScript / TypeScript frameworks. Used
 * by Next.js, Vue, React Router, React Native, and JavaScript (Web) — anywhere
 * the agent should consider `package.json` + lockfiles as authoritative.
 */
export const JS_TS_PROJECT_TYPE_DETECTION =
  'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.';

// ── Env-var shapes ─────────────────────────────────────────────────────

/**
 * Most server-side frameworks (Python/Django/Flask/FastAPI, JS-Node,
 * JS-Web) write a single `AMPLITUDE_API_KEY` env var. The server URL is
 * implicit (uses the SDK default).
 */
export function apiKeyOnlyEnv(apiKey: string): Record<string, string> {
  return { AMPLITUDE_API_KEY: apiKey };
}

/**
 * Frameworks where the SDK needs the host pinned explicitly (Go, Java,
 * React Native, Generic). Mirrors `apiKey + AMPLITUDE_SERVER_URL` shape
 * those configs were inlining.
 */
export function apiKeyAndServerUrlEnv(
  apiKey: string,
  host: string,
): Record<string, string> {
  return {
    AMPLITUDE_API_KEY: apiKey,
    AMPLITUDE_SERVER_URL: host,
  };
}

/**
 * Frameworks that don't read API keys from `.env` files at all (mobile /
 * native / game-engine: Android, Swift, Flutter, Unity, Unreal). The key
 * lives in framework-native config (gradle.properties, xcconfig,
 * --dart-define, DefaultEngine.ini, ScriptableObject, etc.).
 */
export function emptyEnv(): Record<string, string> {
  return {};
}

// ── Detection helpers ──────────────────────────────────────────────────

/**
 * Frameworks that don't expose a version number (Python, Go, Java, Swift,
 * Android, Flutter, Unity, Unreal, JS-Node, JS-Web, React Native, Generic,
 * Django/Flask/FastAPI — these compute the version separately via
 * `getInstalledVersion`). Returns `undefined` to satisfy
 * `FrameworkDetection.getVersion`.
 */
export const noVersionFromPackageJson = (): string | undefined => undefined;

/**
 * Returns a `getInstalledVersion` implementation for a Node-based framework
 * that reads `<packageName>` from the project's `package.json`. Used by
 * Next.js, Vue, and other JS frameworks where the version is derived
 * straight from the manifest.
 */
export function nodeInstalledVersion(
  packageName: string,
): (options: WizardOptions) => Promise<string | undefined> {
  return async (options: WizardOptions) => {
    const packageJson = await tryGetPackageJson(options);
    return packageJson
      ? getPackageVersion(packageName, packageJson)
      : undefined;
  };
}

// ── Prompt fragment builders ───────────────────────────────────────────

/**
 * Build the standard "Framework docs ID" prompt line. Every framework that
 * exposes docs through the `amplitude://docs/frameworks/<id>` MCP resource
 * uses the same wording — only the id changes, so a builder keeps the
 * wording in lockstep.
 */
export function frameworkDocsIdLine(frameworkId: string): string {
  return `Framework docs ID: ${frameworkId} (use amplitude://docs/frameworks/${frameworkId} for documentation)`;
}
