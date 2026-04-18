/**
 * Detect CLI binaries bundled by an outer GUI host app (Conductor et al.).
 *
 * Mac apps that run coding agents in parallel often ship their own copy of
 * `codex` / `claude` under `/Library/Application Support/<app>/`. When the
 * wizard runs inside one of those host apps, the bundled binary may be the
 * only one on PATH — but the user never installed it and would be surprised
 * to see the tool pop up in the MCP picker.
 *
 * The guard is macOS-only because the bundled-by-host pattern is specific
 * to Mac GUI wrapper apps.
 */
export function isBundledByHostApp(resolvedPath: string): boolean {
  if (process.platform !== 'darwin') return false;
  return /\/Library\/Application Support\//i.test(resolvedPath);
}
