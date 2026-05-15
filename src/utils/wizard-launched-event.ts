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
  // Env-var helpers. The match semantics deliberately mirror each var's
  // consumer (e.g. `=== '1'` matches sentry.ts's check) — diverging would
  // make the funnel report "opted out" when the actual consumer didn't
  // honor the value.
  const envSet = (key: string): boolean => {
    const v = env[key];
    return typeof v === 'string' && v.length > 0;
  };
  const envEquals = (key: string, value: string): boolean => env[key] === value;
  const envValue = (key: string): string | null => {
    const v = env[key];
    return typeof v === 'string' && v.length > 0 ? v : null;
  };

  const firstPositional = argv._[0];

  return {
    subcommand:
      typeof firstPositional === 'string' ? firstPositional : 'default',
    'is tty': Boolean(process.stdout.isTTY),
    'ci env detected': envSet('CI'),
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

    // Undocumented env vars that meaningfully alter wizard behavior — read
    // directly via `process.env` by their consumers, so without explicit
    // capture they're invisible to the funnel.
    //
    // We deliberately do NOT capture the telemetry opt-out signals
    // (`DO_NOT_TRACK`, `AMPLITUDE_WIZARD_NO_TELEMETRY`). They're checked
    // only by `src/lib/observability/sentry.ts`, not by the analytics SDK,
    // so every event ingests regardless — that's the existing behavior of
    // every other `wizard cli: *` event and we're matching it here.
    // Capturing the opt-out value as a property would surface a signal no
    // other event tracks, which is the inconsistency we want to avoid.
    'allow nested env': envSet('AMPLITUDE_WIZARD_ALLOW_NESTED'),
    'gateway sanitize off env': envEquals(
      'AMPLITUDE_WIZARD_GATEWAY_SANITIZE_FETCH',
      '0',
    ),
    'no update check env': envEquals('AMPLITUDE_WIZARD_NO_UPDATE_CHECK', '1'),
    'no theme env': envEquals('AMPLITUDE_WIZARD_NO_THEME', '1'),

    // URL / endpoint overrides — presence only (URLs aren't chart-useful
    // and may point at internal infrastructure).
    'data api url override env': envSet('AMPLITUDE_WIZARD_DATA_API_URL'),
    'ingestion host override env': envSet('AMPLITUDE_WIZARD_INGESTION_HOST'),
    'signup url override env': envSet('AMPLITUDE_WIZARD_SIGNUP_URL'),
    'amplitude server url override env': envSet('AMPLITUDE_SERVER_URL'),

    // Credential fallback — presence only (never the value).
    'amplitude api key env': envSet('AMPLITUDE_API_KEY'),

    // Agent-behavior knobs — low-cardinality string values pass through
    // so dashboards can slice by filter mode / turn limit.
    'mcp tool filter env': envValue('AMPLITUDE_WIZARD_MCP_TOOL_FILTER'),
    'builtin tool filter env': envValue('AMPLITUDE_WIZARD_BUILTIN_TOOL_FILTER'),
    'max turns env': envValue('AMPLITUDE_WIZARD_MAX_TURNS'),

    // ─── LLM gateway / Claude / model overrides ──────────────────────
    // Endpoint or credential overrides change which LLM the agent
    // actually talks to — material for diagnosing model-routing issues.
    'anthropic base url override env': envSet('ANTHROPIC_BASE_URL'),
    'anthropic api key env': envSet('ANTHROPIC_API_KEY'),
    'anthropic auth token env': envSet('ANTHROPIC_AUTH_TOKEN'),
    'claude code oauth token env': envSet('CLAUDE_CODE_OAUTH_TOKEN'),
    'claude code disable beta env': envSet(
      'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
    ),
    'wizard llm proxy url override env': envSet('WIZARD_LLM_PROXY_URL'),
    // Model values pass through — low cardinality (claude-3-5-sonnet,
    // claude-3-haiku, etc.) and chart-useful for "what % run on which
    // model".
    'wizard claude model env': envValue('WIZARD_CLAUDE_MODEL'),
    'wizard haiku model env': envValue('WIZARD_HAIKU_MODEL'),

    // ─── Region / zone ───────────────────────────────────────────────
    // `us` / `eu` — load-bearing for cross-region routing diagnostics.
    'wizard zone env': envValue('WIZARD_ZONE'),

    // ─── Demo / experiments ──────────────────────────────────────────
    'demo mode env': envEquals('DEMO_MODE_WIZARD', '1'),
    'amplitude experiment deployment key env': envSet(
      'AMPLITUDE_EXPERIMENT_DEPLOYMENT_KEY',
    ),

    // ─── Service endpoint overrides ──────────────────────────────────
    'mcp url override env': envSet('MCP_URL'),
    'skills url override env': envSet('SKILLS_URL'),

    // ─── OAuth ───────────────────────────────────────────────────────
    'oauth client id override env': envSet('OAUTH_CLIENT_ID'),
    'oauth host override env': envSet('OAUTH_HOST'),
    'wizard oauth token env': envSet('WIZARD_OAUTH_TOKEN'),
    'wizard expires at env': envSet('WIZARD_EXPIRES_AT'),

    // ─── Sentry ──────────────────────────────────────────────────────
    'sentry dsn override env': envSet('SENTRY_DSN'),
    'sentry debug env': envEquals('SENTRY_DEBUG', '1'),

    // ─── Tuning ──────────────────────────────────────────────────────
    // Numeric override (milliseconds) — passes through as string. Low
    // cardinality in practice (one or two values per CI tier).
    'data ingestion timeout env': envValue('DATA_INGESTION_TIMEOUT_MS'),

    // Companion to `no update check env` — the upstream `update-notifier`
    // package's own opt-out env var (any non-empty value disables).
    'no update notifier env': envSet('NO_UPDATE_NOTIFIER'),
  };
}
