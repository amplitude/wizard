import { spawn, spawnSync } from 'child_process';
import { MCPClient, type AddServerResult } from '../MCPClient';
import { analytics } from '../../../utils/analytics';
import { debug } from '../../../utils/debug';
import {
  CLAUDE_PLUGIN_ID,
  CLAUDE_PLUGIN_MARKETPLACE_NAME,
  CLAUDE_PLUGIN_MARKETPLACE_REPO,
} from '../../../lib/constants';
import { findClaudeBinary } from './claude-binary';

const PLUGIN_REF = `${CLAUDE_PLUGIN_ID}@${CLAUDE_PLUGIN_MARKETPLACE_NAME}`;

/** Async wrapper around spawn that captures stdout/stderr and returns a spawnSync-shaped result. */
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

/**
 * Install flow for the Amplitude Claude Code plugin (bundles the MCP server +
 * slash commands). Sibling to ClaudeCodeMCPClient, which installs only the raw
 * MCP entry.
 */
export class ClaudeCodePluginClient extends MCPClient {
  name = 'Claude Code';

  constructor() {
    super();
  }

  getServerPropertyName(): string {
    return 'mcpServers';
  }

  getConfigPath(): Promise<string> {
    throw new Error('Not implemented');
  }

  isClientSupported(): Promise<boolean> {
    try {
      const binary = findClaudeBinary();
      if (!binary) {
        debug('  Claude Code not found.');
        return Promise.resolve(false);
      }
      const versionResult = spawnSync(binary, ['--version'], { stdio: 'pipe' });
      if (versionResult.status !== 0) return Promise.resolve(false);
      // Guard against older Claude Code versions that don't have the
      // `plugin` subcommand. Without this probe they'd pass --version
      // and then fail opaquely during `claude plugin marketplace add`
      // with "unknown command". Returning false here keeps
      // resolveClientsForMode from swapping in the plugin client.
      const pluginHelp = spawnSync(binary, ['plugin', '--help'], {
        stdio: 'pipe',
      });
      if (pluginHelp.status !== 0) {
        debug(
          '  Claude Code is missing the `plugin` subcommand — skipping plugin client.',
        );
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }

  async isServerInstalled(): Promise<boolean> {
    const binary = findClaudeBinary();
    if (!binary) return false;
    try {
      const result = await runCli(binary, ['plugin', 'list']);
      if (result.status !== 0) return false;
      return result.stdout.toString().includes(PLUGIN_REF);
    } catch {
      return false;
    }
  }

  async addServer(
    _apiKey?: string,
    _selectedFeatures?: string[],
    local?: boolean,
  ): Promise<AddServerResult> {
    // Defense in depth: the plugin marketplace only ships the production
    // Amplitude MCP, so a `--local` request can never be honored here. Callers
    // (resolveClientsForMode, addMCPServerToClientsStep) already route around
    // this — but if a future refactor passes us local=true we'd silently
    // install prod, which is the wrong dev-loop behavior. Fail loudly instead.
    if (local) {
      return {
        success: false,
        error:
          'Claude Code plugin does not support --local. Use --local-mcp to install the bare amplitude-local MCP entry instead.',
      };
    }
    const binary = findClaudeBinary();
    if (!binary) {
      return {
        success: false,
        error: 'Claude Code CLI not found on PATH.',
      };
    }

    const marketplaceResult = await runCli(binary, [
      'plugin',
      'marketplace',
      'add',
      CLAUDE_PLUGIN_MARKETPLACE_REPO,
    ]);

    if (
      marketplaceResult.status !== 0 &&
      !isAlreadyThere(marketplaceResult.stderr, marketplaceResult.stdout)
    ) {
      const err = stderrSummary(
        marketplaceResult.stderr,
        marketplaceResult.stdout,
      );
      analytics.captureException(
        new Error(`Failed to add Amplitude plugin marketplace: ${err}`),
      );
      return {
        success: false,
        error: `Could not register Amplitude marketplace: ${err}`,
      };
    }

    const installResult = await runCli(binary, [
      'plugin',
      'install',
      PLUGIN_REF,
      '--scope',
      'user',
    ]);

    if (installResult.status !== 0) {
      if (isAlreadyThere(installResult.stderr, installResult.stdout)) {
        debug('  Amplitude plugin already installed — continuing.');
      } else {
        const err = stderrSummary(installResult.stderr, installResult.stdout);
        analytics.captureException(
          new Error(`Failed to install Amplitude plugin: ${err}`),
        );
        return {
          success: false,
          error: `Plugin install failed: ${err}`,
        };
      }
    }

    await this.removeStaleMcpEntry(binary);
    return { success: true };
  }

  async removeServer(local?: boolean): Promise<AddServerResult> {
    // Same invariant as addServer: the plugin only manages the prod entry.
    // `getInstalledClients(local)` already skips the plugin probe when local
    // is set, but guard here too in case a caller bypasses that path.
    if (local) {
      return {
        success: false,
        error:
          'Claude Code plugin does not support --local. Use --local-mcp to manage the amplitude-local MCP entry.',
      };
    }
    const binary = findClaudeBinary();
    if (!binary) {
      return {
        success: false,
        error: 'Claude Code CLI not found on PATH.',
      };
    }

    const result = await runCli(binary, [
      'plugin',
      'uninstall',
      PLUGIN_REF,
      '--scope',
      'user',
    ]);

    if (result.status !== 0) {
      const err = stderrSummary(result.stderr, result.stdout);
      analytics.captureException(
        new Error(`Failed to uninstall Amplitude plugin: ${err}`),
      );
      return { success: false, error: err };
    }
    return { success: true };
  }

  /**
   * If a prior wizard run added a bare `amplitude` MCP entry, remove it now
   * that the plugin provides the same server. Best-effort — don't fail install
   * if this step errors.
   */
  private async removeStaleMcpEntry(binary: string): Promise<void> {
    try {
      const list = await runCli(binary, ['mcp', 'list']);
      if (list.status !== 0) return;
      const output = list.stdout.toString();
      // Match a top-level `amplitude` server entry (not `amplitude-local`).
      const hasBareEntry = /^amplitude(?:\s|:)/m.test(output);
      if (!hasBareEntry) return;

      debug(
        '  Removing stale bare `amplitude` MCP entry (superseded by plugin).',
      );
      await runCli(binary, ['mcp', 'remove', '--scope', 'user', 'amplitude']);
    } catch {
      // best-effort
    }
  }
}

/** Some Claude CLI commands print "already..." but exit 0; others exit non-zero. */
function isAlreadyThere(
  stderr: Buffer | string | undefined,
  stdout: Buffer | string | undefined,
): boolean {
  const text = `${stderr?.toString() ?? ''}\n${stdout?.toString() ?? ''}`;
  return /already\b/i.test(text);
}

function stderrSummary(
  stderr: Buffer | string | undefined,
  stdout: Buffer | string | undefined,
): string {
  const text =
    (stderr?.toString() ?? '').trim() || (stdout?.toString() ?? '').trim();
  if (!text) return 'unknown error';
  // Keep the first few lines — keep user-visible errors readable.
  return text.split('\n').slice(0, 3).join(' ').slice(0, 300);
}
