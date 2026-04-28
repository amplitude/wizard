/**
 * Claude Code Plugin — DEPRECATED. Uninstall-only. Drop in next release.
 *
 * Previous wizard versions installed an Amplitude Claude Code plugin (slash
 * commands + bundled MCP) via `claude plugin install`. This client keeps the
 * uninstall path alive so users who have the plugin installed can remove it
 * via the wizard. The install path is intentionally a no-op — the wizard now
 * only installs the bare MCP entry through `ClaudeCodeMCPClient`.
 *
 * Detection strategy: only report `isClientSupported()` true if the plugin
 * is currently installed (probed via `claude plugin list`). That keeps it
 * out of the install picker entirely while letting it surface in the
 * uninstall flow exclusively for affected users.
 */
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MCPClient } from '../MCPClient';
import { analytics } from '../../../utils/analytics';
import { debug } from '../../../utils/debug';
import {
  CLAUDE_PLUGIN_ID,
  CLAUDE_PLUGIN_MARKETPLACE_NAME,
} from '../../../lib/constants';

const PLUGIN_REF = `${CLAUDE_PLUGIN_ID}@${CLAUDE_PLUGIN_MARKETPLACE_NAME}`;

function findClaudeBinary(): string | null {
  const possiblePaths = [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter);
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = path.join(dir, 'claude');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Async wrapper around spawn that captures stdout/stderr. */
function runCli(
  binary: string,
  args: string[],
): Promise<{ status: number; stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve) => {
    const proc = spawn(binary, args, { stdio: 'pipe' });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout?.on('data', (d: Buffer) => stdoutChunks.push(d));
    proc.stderr?.on('data', (d: Buffer) => stderrChunks.push(d));
    proc.on('error', (err) => {
      resolve({
        status: -1,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.from(err.message),
      });
    });
    proc.on('close', (status) => {
      resolve({
        status: status ?? 0,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
      });
    });
  });
}

export class ClaudeCodePluginClient extends MCPClient {
  name = 'Claude Code Plugin';

  getServerPropertyName(): string {
    return 'mcpServers';
  }

  getConfigPath(): Promise<string> {
    throw new Error('Not implemented');
  }

  /**
   * Uninstall-only: report supported only when the plugin is actually
   * installed. Keeps it out of the install picker (which uses
   * getSupportedClients) and lets it surface in getInstalledClients() for
   * the uninstall flow.
   */
  async isClientSupported(): Promise<boolean> {
    return this.isServerInstalled();
  }

  async isServerInstalled(): Promise<boolean> {
    const binary = findClaudeBinary();
    if (!binary) return false;
    try {
      // Guard against older Claude Code versions without `plugin` subcommand.
      const help = spawnSync(binary, ['plugin', '--help'], { stdio: 'pipe' });
      if (help.status !== 0) return false;
      const result = await runCli(binary, ['plugin', 'list']);
      if (result.status !== 0) return false;
      return result.stdout.toString().includes(PLUGIN_REF);
    } catch {
      return false;
    }
  }

  /** Install path retired — wizard now installs only the bare MCP entry. */
  addServer(): Promise<{ success: boolean }> {
    return Promise.resolve({ success: false });
  }

  async removeServer(): Promise<{ success: boolean }> {
    const binary = findClaudeBinary();
    if (!binary) return { success: false };

    const result = await runCli(binary, [
      'plugin',
      'uninstall',
      PLUGIN_REF,
      '--scope',
      'user',
    ]);

    if (result.status !== 0) {
      const err =
        result.stderr.toString().trim() || result.stdout.toString().trim();
      debug(`  Failed to uninstall Amplitude plugin: ${err}`);
      analytics.captureException(
        new Error(`Failed to uninstall Amplitude plugin: ${err}`),
      );
      return { success: false };
    }
    return { success: true };
  }
}
