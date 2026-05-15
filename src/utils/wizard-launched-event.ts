/**
 * Property bag for the `wizard cli: wizard launched` root event.
 *
 * Scoped to flags and environment context that fundamentally change how
 * the wizard operates — not pure logging or internal agent diagnostics.
 * Internal toggles (ai-sdk probe / console / inner-loop, skill-tiers,
 * skip-bootstrap, compaction-window, benchmark / event-plan IPC,
 * log destinations) are intentionally NOT here — they belong on Sentry
 * tags so they're attached to error context where they're actually
 * useful. Tracked as a follow-up PR.
 *
 * Sensitive-field policy:
 * - Credentials / PII collapse to a `'<flag> provided'` boolean.
 * - Paths collapse to presence (paths can contain usernames).
 * - High-cardinality IDs (org/project/app) collapse to presence.
 * - `--email` additionally exposes `'email domain'` so adoption can be
 *   sliced by provider without storing the local-part.
 * - Enumerated / low-cardinality strings pass through with their value.
 * - Booleans pass through directly.
 *
 * Session properties (`mode`, `wizard_version`, `platform`, `node_version`,
 * `session id`, `run id`) auto-attach via `Analytics.capture()` — do not
 * re-pass them here.
 */

import type { Arguments } from 'yargs';

/**
 * Domain only — local-part is PII. Null for missing or malformed input.
 * Defensive check covers env-var / config paths that bypass yargs `coerce`.
 */
export function emailDomainFromArg(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const at = value.lastIndexOf('@');
  if (at < 1 || at >= value.length - 1) return null;
  return value.slice(at + 1).toLowerCase();
}

export function wizardLaunchedProperties(
  argv: Arguments,
  nestedAgentDetected: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const present = (key: string): boolean => {
    const v = argv[key];
    if (v === undefined || v === null) return false;
    if (typeof v === 'string') return v.length > 0;
    return true;
  };
  const bool = (key: string): boolean => argv[key] === true;
  const str = (key: string): string | null => {
    const v = argv[key];
    return typeof v === 'string' && v.length > 0 ? v : null;
  };

  const firstPositional = argv._[0];

  return {
    subcommand:
      typeof firstPositional === 'string' ? firstPositional : 'default',
    'is tty': Boolean(process.stdout.isTTY),
    'ci env detected': typeof env.CI === 'string' && env.CI.length > 0,
    'node arch': process.arch,
    'nested agent': nestedAgentDetected,

    // User-controllable boolean flags that change UX / behavior.
    // `--debug` / `--verbose` are intentionally excluded — they only
    // affect log verbosity, not what the wizard does.
    ci: bool('ci'),
    agent: bool('agent'),
    yes: bool('yes'),
    force: bool('force'),
    json: bool('json'),
    human: bool('human'),
    // `--default` is true by default; only the explicit `--no-default`
    // opt-out (used by scripts that want prompts visible) is a real signal.
    'no defaults': argv.default === false,
    'auto approve': bool('auto-approve'),
    'accept tos': bool('accept-tos'),
    'confirm app': bool('confirm-app'),
    signup: bool('signup'),
    'local mcp': bool('local-mcp'),
    dev: bool('dev'),

    // Path direction — drives the [1] sign-in vs [2] create-account branch.
    'auth onboarding': str('auth-onboarding'),

    // Targeting flags — presence only (high cardinality, not credential-bearing).
    // Each `'<flag> provided'` answers "did the agent get pre-scoped?"
    'app id provided': present('app-id'),
    'app name provided': present('app-name'),
    'project id provided': present('project-id'),
    'workspace id provided': present('workspace-id'),
    'org provided': present('org'),
    'env provided': present('env'),

    // Presence only — credential-bearing or PII-bearing.
    'api key provided': present('api-key'),
    'token provided': present('token'),
    'proxy bearer provided': present('proxy-bearer'),
    'full name provided': present('full-name'),

    // Presence + non-PII domain fragment; local-part is dropped.
    'email provided': present('email'),
    'email domain': emailDomainFromArg(argv.email),

    // Presence only — paths may contain usernames.
    'install dir provided': present('install-dir'),
    'cache dir provided': present('cache-dir'),
    'context path provided': present('context'),
    'plan id provided': present('plan-id'),
  };
}
