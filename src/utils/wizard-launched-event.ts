/**
 * Property bag for the `wizard cli: wizard launched` root event. Extracted
 * from `bin.ts` so the redaction logic can be unit-tested in isolation —
 * adding a new sensitive flag should land with a paired test rather than
 * relying on a manual run.
 *
 * Sensitive-field policy enforced here:
 * - Credentials / PII collapse to a `'<flag> provided'` boolean.
 * - Paths collapse to presence (paths can contain usernames).
 * - High-cardinality IDs (org/project/app) collapse to presence — they
 *   aren't credentials, but raw values aren't chart-useful either.
 * - `--email` additionally exposes `'email domain'` so adoption can be
 *   sliced by provider without storing the local-part.
 * - Enumerated / low-cardinality strings (`--auth-onboarding`,
 *   `--compaction-window`) pass through with their actual value.
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
    'ci env detected': Boolean(process.env.CI),
    'node arch': process.arch,
    'nested agent': nestedAgentDetected,

    debug: bool('debug'),
    verbose: bool('verbose'),
    ci: bool('ci'),
    agent: bool('agent'),
    yes: bool('yes'),
    force: bool('force'),
    json: bool('json'),
    human: bool('human'),
    // `--default` defaults to true; the only meaningful signal is the
    // opt-out (`--no-default`), which scripts use to keep prompts visible.
    'no defaults': argv.default === false,
    'auto approve': bool('auto-approve'),
    'accept tos': bool('accept-tos'),
    'confirm app': bool('confirm-app'),
    signup: bool('signup'),
    'local mcp': bool('local-mcp'),
    dev: bool('dev'),

    'skip bootstrap': bool('skip-bootstrap'),
    'skill tiers': bool('skill-tiers'),
    'ai sdk probe': bool('ai-sdk-probe'),
    'ai sdk probe strict': bool('ai-sdk-probe-strict'),
    'ai sdk console': bool('ai-sdk-console'),
    'ai sdk inner loop': bool('ai-sdk-inner-loop'),

    'auth onboarding': str('auth-onboarding'),
    'compaction window': str('compaction-window'),

    // Presence only — high cardinality args that aren't credential-bearing
    'app id provided': present('app-id'),
    'app name provided': present('app-name'),
    'project id provided': present('project-id'),
    'workspace id provided': present('workspace-id'),
    'org provided': present('org'),
    'env provided': present('env'),

    // Presence only — credential-bearing or PII-bearing
    'api key provided': present('api-key'),
    'token provided': present('token'),
    'proxy bearer provided': present('proxy-bearer'),
    'full name provided': present('full-name'),

    // Presence + non-PII domain fragment; local-part is dropped
    'email provided': present('email'),
    'email domain': emailDomainFromArg(argv.email),

    // Presence only — paths may contain usernames
    'install dir provided': present('install-dir'),
    'cache dir provided': present('cache-dir'),
    'log path provided': present('log'),
    'context path provided': present('context'),
    'plan id provided': present('plan-id'),

    // Presence only — internal env-var passthroughs. Not user-controlled
    // in interactive flows; presence indicates a programmatic invocation
    // (orchestrator, benchmark harness, apply-child).
    'event plan decision provided': present('event-plan-decision'),
    'event plan feedback provided': present('event-plan-feedback'),
    'benchmark file provided': present('benchmark-file'),
    'benchmark config provided': present('benchmark-config'),
    'log file provided': present('log-file'),
  };
}
