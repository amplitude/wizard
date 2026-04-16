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
]);

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
  // URL query strings (may contain auth tokens like ?code=…&token=…)
  {
    pattern: /(https?:\/\/[^\s"'?]*)\?[^\s"']+/g,
    replacement: '$1?[REDACTED_PARAMS]',
  },
  // Hex strings that look like API keys (32+ hex chars)
  { pattern: /\b[a-f0-9]{32,}\b/gi, replacement: '[REDACTED_KEY]' },
  // Absolute paths (macOS / Linux home dirs and system temp dirs)
  {
    pattern: /\/(?:Users|home|var|tmp)\/[^\s"':,}\]]+/g,
    replacement: '[~]/...',
  },
];

// ── Public API ──────────────────────────────────────────────────────

/**
 * Redact sensitive data from a string.
 * Applies all pattern-based replacements.
 */
export function redactString(str: string): string {
  let result = str;
  for (const { pattern, replacement } of STRING_PATTERNS) {
    // Reset lastIndex for global regexes reused across calls
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
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
