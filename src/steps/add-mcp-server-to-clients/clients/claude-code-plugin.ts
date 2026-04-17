import { spawnSync } from 'child_process';
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
      const result = spawnSync(binary, ['--version'], { stdio: 'pipe' });
      return Promise.resolve(result.status === 0);
    } catch {
      return Promise.resolve(false);
    }
  }

  isServerInstalled(): Promise<boolean> {
    const binary = findClaudeBinary();
    if (!binary) return Promise.resolve(false);
    try {
      const result = spawnSync(binary, ['plugin', 'list'], { stdio: 'pipe' });
      if (result.status !== 0) return Promise.resolve(false);
      const output = result.stdout?.toString() ?? '';
      return Promise.resolve(output.includes(PLUGIN_REF));
    } catch {
      return Promise.resolve(false);
    }
  }

  addServer(): Promise<AddServerResult> {
    const binary = findClaudeBinary();
    if (!binary) {
      return Promise.resolve({
        success: false,
        error: 'Claude Code CLI not found on PATH.',
      });
    }

    const marketplaceResult = spawnSync(
      binary,
      ['plugin', 'marketplace', 'add', CLAUDE_PLUGIN_MARKETPLACE_REPO],
      { stdio: 'pipe' },
    );

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
      return Promise.resolve({
        success: false,
        error: `Could not register Amplitude marketplace: ${err}`,
      });
    }

    const installResult = spawnSync(
      binary,
      ['plugin', 'install', PLUGIN_REF, '--scope', 'user'],
      { stdio: 'pipe' },
    );

    if (installResult.status !== 0) {
      if (isAlreadyThere(installResult.stderr, installResult.stdout)) {
        debug('  Amplitude plugin already installed — continuing.');
      } else {
        const err = stderrSummary(installResult.stderr, installResult.stdout);
        analytics.captureException(
          new Error(`Failed to install Amplitude plugin: ${err}`),
        );
        return Promise.resolve({
          success: false,
          error: `Plugin install failed: ${err}`,
        });
      }
    }

    this.removeStaleMcpEntry(binary);
    return Promise.resolve({ success: true });
  }

  removeServer(): Promise<AddServerResult> {
    const binary = findClaudeBinary();
    if (!binary) {
      return Promise.resolve({
        success: false,
        error: 'Claude Code CLI not found on PATH.',
      });
    }

    const result = spawnSync(
      binary,
      ['plugin', 'uninstall', PLUGIN_REF, '--scope', 'user'],
      { stdio: 'pipe' },
    );

    if (result.status !== 0) {
      const err = stderrSummary(result.stderr, result.stdout);
      analytics.captureException(
        new Error(`Failed to uninstall Amplitude plugin: ${err}`),
      );
      return Promise.resolve({ success: false, error: err });
    }
    return Promise.resolve({ success: true });
  }

  /**
   * If a prior wizard run added a bare `amplitude` MCP entry, remove it now
   * that the plugin provides the same server. Best-effort — don't fail install
   * if this step errors.
   */
  private removeStaleMcpEntry(binary: string): void {
    try {
      const list = spawnSync(binary, ['mcp', 'list'], { stdio: 'pipe' });
      if (list.status !== 0) return;
      const output = list.stdout?.toString() ?? '';
      // Match a top-level `amplitude` server entry (not `amplitude-local`).
      const hasBareEntry = /^amplitude(?:\s|:)/m.test(output);
      if (!hasBareEntry) return;

      debug(
        '  Removing stale bare `amplitude` MCP entry (superseded by plugin).',
      );
      spawnSync(binary, ['mcp', 'remove', '--scope', 'user', 'amplitude'], {
        stdio: 'pipe',
      });
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
