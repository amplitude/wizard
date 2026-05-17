/**
 * Shared `claude` binary lookup used by both `ClaudeCodeMCPClient` and
 * `ClaudeCodePluginClient`. Both need to spawn the Claude Code CLI to
 * add/remove MCP entries or plugins, and both previously inlined the same
 * lookup logic — keep it in one place so future install-path tweaks
 * (Homebrew Apple Silicon, snap, etc.) only need to land once.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { debug } from '../../../utils/debug';

/**
 * Common installation paths probed before falling back to `PATH`. Order
 * matters — local installs win over global so wizard-invoked `claude` matches
 * what the user runs in their shell.
 */
const CLAUDE_BINARY_PATHS = [
  ['.local', 'bin', 'claude'],
  ['.claude', 'local', 'claude'],
] as const;

const CLAUDE_BINARY_ABSOLUTE_PATHS = [
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',
];

/**
 * Locate the `claude` binary, searching well-known install paths first and
 * then walking `$PATH`. Returns `null` when nothing usable is found.
 *
 * SECURITY: We never `exec` to discover the binary — only `fs.existsSync` on
 * fully-resolved paths. Any path string returned here is safe to pass as
 * argv[0] to `spawn`/`spawnSync` without shell interpretation.
 */
export function findClaudeBinary(options?: {
  debugLog?: boolean;
}): string | null {
  const home = os.homedir();
  const candidates = [
    ...CLAUDE_BINARY_PATHS.map((parts) => path.join(home, ...parts)),
    ...CLAUDE_BINARY_ABSOLUTE_PATHS,
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      if (options?.debugLog) debug(`  Found claude binary at: ${candidate}`);
      return candidate;
    }
  }

  const pathDirs = (process.env.PATH ?? '').split(path.delimiter);
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = path.join(dir, 'claude');
    if (fs.existsSync(candidate)) {
      if (options?.debugLog) debug(`  Found claude in PATH: ${candidate}`);
      return candidate;
    }
  }

  return null;
}
