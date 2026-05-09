/**
 * cli-display — Helpers for rendering CLI commands back to the user.
 *
 * Every command we tell a human (or an outer agent's human) to run must
 * be reachable without a global install. The canonical invocation is
 * `npx @amplitude/wizard …`. The bare `wizard` / `amplitude-wizard`
 * binaries only exist when a user has explicitly run
 * `npm install -g @amplitude/wizard`, and showing them in error messages
 * or outro text strands users who rely on `npx`.
 *
 * Use these helpers anywhere the wizard surfaces a command string to a
 * user — outro screens, error output, NDJSON `instruction` strings,
 * resume hints, etc. Argv arrays emitted as machine-readable hints
 * (e.g. `resumeCommand: string[]`) should also pass through
 * `normalizeCliCommand` so spawn-style consumers and human-rendered
 * forms stay consistent.
 */

const NPX_PREFIX = ['npx', '@amplitude/wizard'] as const;

/**
 * Returns true when `parts` already begins with `npx @amplitude/wizard`.
 */
function hasNpxPrefix(parts: readonly string[]): boolean {
  return parts[0] === NPX_PREFIX[0] && parts[1] === NPX_PREFIX[1];
}

/**
 * Strip a leading bare `wizard` or `amplitude-wizard` token from a
 * command array so we can replace it with the canonical npx prefix.
 *
 * Returns the trailing args (no binary). When `parts` doesn't start with
 * any recognized bin token, the whole array is treated as args.
 */
function dropLeadingBin(parts: readonly string[]): readonly string[] {
  if (parts.length === 0) return parts;
  const head = parts[0];
  if (head === 'wizard' || head === 'amplitude-wizard') {
    return parts.slice(1);
  }
  return parts;
}

/**
 * Normalize an argv-style command array so it always starts with
 * `['npx', '@amplitude/wizard', …]`. Idempotent — passing an
 * already-prefixed array is a no-op.
 *
 * Use this for machine-readable hints (`resumeCommand`, `loginCommand`,
 * `command:` fields in NDJSON `suggestedAction` payloads) so that
 * outer agents spawning the suggested command don't depend on a global
 * install.
 */
export function normalizeCliCommand(
  parts: readonly string[],
): readonly string[] {
  if (hasNpxPrefix(parts)) return parts;
  const tail = dropLeadingBin(parts);
  return [...NPX_PREFIX, ...tail];
}

/**
 * Quote a single command part for shell-safe display when it contains
 * whitespace or shell metacharacters. We deliberately use
 * double-quote-with-backslash-escapes (rather than single-quotes)
 * because the rendered string is for the user to copy and works in
 * both POSIX shells and Windows cmd / PowerShell after minor
 * adjustments.
 *
 * Exported for the unit tests; production callers should go through
 * `formatResumeCommand` / `formatCliCommand`.
 */
export function shellQuote(part: string): string {
  if (part.length === 0) return '""';
  // Plain alphanumerics + a small allowlist of safe punctuation render
  // as-is. Anything else (spaces, quotes, $, backticks, etc.) gets
  // double-quoted with embedded `"` and `\` escaped.
  if (/^[A-Za-z0-9_\-.,/:@=+%]+$/.test(part)) return part;
  const escaped = part.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Render an argv-style command array into a single human-readable
 * string with `npx @amplitude/wizard` always in front.
 *
 * Examples:
 *   formatCliCommand(['wizard', 'login'])
 *     → 'npx @amplitude/wizard login'
 *   formatCliCommand(['npx', '@amplitude/wizard', 'status'])
 *     → 'npx @amplitude/wizard status'
 *   formatCliCommand(['amplitude-wizard', 'apply', '--plan-id', 'abc 1'])
 *     → 'npx @amplitude/wizard apply --plan-id "abc 1"'
 */
export function formatCliCommand(parts: readonly string[]): string {
  return normalizeCliCommand(parts).map(shellQuote).join(' ');
}

/**
 * Alias for `formatCliCommand`, named for the most common callsite —
 * resume / re-run hints in outro and error text.
 */
export const formatResumeCommand = formatCliCommand;
