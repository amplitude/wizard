/**
 * Centralized redaction for secrets, PII, and sensitive paths.
 *
 * Applied at the serialization boundary — callers log freely;
 * redaction strips sensitive data before it reaches a file, Sentry, or NDJSON output.
 */

// ── Patterns ────────────────────────────────────────────────────────

/** Keys whose values are always fully redacted. Case-insensitive match. */
const SENSITIVE_KEYS = new Set([
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'idtoken',
  'id_token',
  'apikey',
  'api_key',
  'projectapikey',
  'authorization',
  'password',
  'secret',
  'cookie',
  // CI org secret carrying the gateway bearer (MIGRATION_PLAN
  // §7.5). Match by both env-var-shape (`WIZARD_OAUTH_TOKEN`) and
  // common camelCase variants so structured log payloads can't leak it
  // when callers pass it through verbatim.
  'wizard_oauth_token',
  'wizardoauthtoken',
]);

/**
 * Env-var values that, if present and non-empty at module load, get
 * value-redacted from any string anywhere in the log stream. Captured once
 * — env vars don't change mid-run, so the cost is amortized. We can't put
 * the env-var NAME (`WIZARD_OAUTH_TOKEN`) on `SENSITIVE_KEYS` and call it
 * a day: callers commonly log free-form strings ("got token X from env")
 * where the redactor only sees the value, not its source key. Matching
 * the literal value catches those leaks.
 *
 * Only literal substring redaction is used here — no regex — so the
 * presence of regex metacharacters in a token doesn't surprise us.
 */
const ENV_VALUE_REDACTIONS: ReadonlyArray<{ value: string; label: string }> =
  (() => {
    const captured: Array<{ value: string; label: string }> = [];
    const wizardOAuthToken = process.env.WIZARD_OAUTH_TOKEN?.trim();
    if (wizardOAuthToken && wizardOAuthToken.length >= 8) {
      captured.push({
        value: wizardOAuthToken,
        label: '[REDACTED_WIZARD_OAUTH_TOKEN]',
      });
    }
    return captured;
  })();

/** Regex patterns applied to string values. Order matters — first match wins. */
const STRING_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // JWTs (header.payload.signature)
  {
    pattern:
      /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    replacement: '[REDACTED_JWT]',
  },
  // Bearer tokens
  { pattern: /Bearer\s+[^\s"']+/gi, replacement: 'Bearer [REDACTED]' },
  // Hex strings that look like API keys (32+ hex chars)
  { pattern: /\b[a-f0-9]{32,}\b/gi, replacement: '[REDACTED_KEY]' },
  // Absolute paths (macOS / Linux home dirs)
  {
    pattern: /\/(?:Users|home)\/[^\s"':,}\]]+/g,
    replacement: '[~]/...',
  },
];

// ── Public API ──────────────────────────────────────────────────────

/**
 * Redact sensitive data from a string.
 * Applies all pattern-based replacements, then env-value substring
 * redaction (so a logger that prints the WIZARD_OAUTH_TOKEN value
 * verbatim — e.g. `log.info("got token", { token: process.env.WIZARD_OAUTH_TOKEN })`
 * after JSON serialization — can't leak it).
 */
export function redactString(str: string): string {
  let result = str;
  for (const { pattern, replacement } of STRING_PATTERNS) {
    // Reset lastIndex for global regexes reused across calls
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  for (const { value, label } of ENV_VALUE_REDACTIONS) {
    if (result.includes(value)) {
      result = result.split(value).join(label);
    }
  }
  return result;
}

/**
 * Deep-redact an arbitrary value.
 * - Strings: apply pattern replacements
 * - Objects: redact sensitive keys, recurse into values
 * - Arrays: recurse into elements
 * - Primitives: pass through
 *
 * Returns a new value — never mutates the input.
 */
export function redact(value: unknown, depth = 0): unknown {
  // Guard against circular references and deeply nested objects
  if (depth > 10) return '[TRUNCATED]';

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof val === 'string') {
      result[key] = redactString(val);
    } else {
      result[key] = redact(val, depth + 1);
    }
  }
  return result;
}
