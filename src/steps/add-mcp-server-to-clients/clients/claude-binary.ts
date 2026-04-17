import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { debug } from '../../../utils/debug';

let cachedPath: string | null = null;

/**
 * Locate the `claude` CLI binary. Shared by Claude Code MCP + plugin clients.
 * Checks common install paths first, then walks $PATH without exec.
 */
export function findClaudeBinary(): string | null {
  if (cachedPath) return cachedPath;

  const possiblePaths = [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];

  for (const claudePath of possiblePaths) {
    if (fs.existsSync(claudePath)) {
      debug(`  Found claude binary at: ${claudePath}`);
      cachedPath = claudePath;
      return claudePath;
    }
  }

  const pathDirs = (process.env.PATH ?? '').split(path.delimiter);
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = path.join(dir, 'claude');
    if (fs.existsSync(candidate)) {
      debug(`  Found claude in PATH: ${candidate}`);
      cachedPath = candidate;
      return candidate;
    }
  }

  return null;
}

/** Test-only: clear the cached binary path. */
export function _resetClaudeBinaryCache(): void {
  cachedPath = null;
}
