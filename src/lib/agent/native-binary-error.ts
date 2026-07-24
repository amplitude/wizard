/**
 * Detection + remediation copy for the Claude Agent SDK's "native binary
 * not found" failure (Sentry WIZARD-CLI-19).
 *
 * The SDK (`@anthropic-ai/claude-agent-sdk`) ships the `claude` runtime
 * binary via per-platform `optionalDependencies` (e.g.
 * `@anthropic-ai/claude-agent-sdk-linux-x64-musl`). At `query()` time it
 * resolves that platform package's binary. When the package/binary for the
 * current platform isn't present it throws one of two shapes:
 *
 *   - `Claude Code native binary not found at <path>. Please ensure Claude
 *      Code is installed via native installer or specify a valid path with
 *      options.pathToClaudeCodeExecutable.`
 *   - `Native CLI binary for <platform>-<arch> not found. Reinstall
 *      @anthropic-ai/claude-agent-sdk without --omit=optional, or set
 *      options.pathToClaudeCodeExecutable.`
 *
 * This is a userland install-config problem, not a wizard bug: almost always
 * `node_modules` was installed on one OS/libc (e.g. a glibc CI/builder stage)
 * and copied into a different runtime (e.g. an Alpine/musl image), so only
 * the wrong-libc optional dependency got materialized. The wizard used to
 * relay the raw SDK stack; this module turns it into an actionable message.
 */

/**
 * Robustly detect the SDK's missing-native-binary error. Matches on the two
 * known message shapes plus a defensive fallback, so copy tweaks upstream
 * don't silently regress detection.
 */
export function isNativeBinaryMissingError(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('native binary not found') ||
    lower.includes('native cli binary for') ||
    // Both message shapes reference this option; pairing it with a
    // "not found" signal keeps the match specific to the resolution
    // failure rather than any incidental mention.
    (lower.includes('pathtoclaudecodeexecutable') &&
      lower.includes('not found'))
  );
}

/**
 * Best-effort libc flavor for Linux. glibc runtimes expose
 * `glibcVersionRuntime` in the Node process report header; its absence on
 * Linux implies musl (Alpine and friends). Returns `null` off Linux or when
 * detection isn't available — callers omit the libc suffix in that case
 * rather than guessing.
 */
export function detectLinuxLibc(): 'glibc' | 'musl' | null {
  if (process.platform !== 'linux') return null;
  try {
    const report = (
      process.report as { getReport?: () => unknown } | undefined
    )?.getReport?.();
    const header = (report as { header?: Record<string, unknown> } | undefined)
      ?.header;
    if (header && 'glibcVersionRuntime' in header) return 'glibc';
    return 'musl';
  } catch {
    return null;
  }
}

/** Human-readable `<os>-<arch>[-<libc>]` label for the current platform. */
export function describeCurrentPlatform(): string {
  const base = `${process.platform}-${process.arch}`;
  const libc = detectLinuxLibc();
  return libc ? `${base}-${libc}` : base;
}

/**
 * Build the user-facing remediation message. Concise, matches the wizard's
 * sectioned error voice (blank-line-separated blocks). `platform` is
 * injectable for tests; production callers let it default to the detected
 * platform.
 */
export function formatNativeBinaryMissingMessage(
  platform: string = describeCurrentPlatform(),
): string {
  return [
    `Claude Code's native binary for your platform (${platform}) wasn't found.`,
    `This usually means the platform-specific @anthropic-ai/claude-agent-sdk optional dependency didn't get installed — most often because node_modules was installed on a different OS or libc (e.g. glibc) and copied into this environment (e.g. Alpine/musl), so only the wrong-platform binary was materialized.`,
    [
      'To fix:',
      '  • Reinstall dependencies in this environment instead of copying node_modules across OS/libc boundaries.',
      '  • If you use pnpm, set pnpm.supportedArchitectures (os / cpu / libc, e.g. libc: [glibc, musl]) to include this platform, then reinstall.',
      '  • Or point the SDK at an existing Claude Code binary via options.pathToClaudeCodeExecutable.',
    ].join('\n'),
  ].join('\n\n');
}
