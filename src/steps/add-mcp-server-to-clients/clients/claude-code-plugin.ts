import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as jsonc from 'jsonc-parser';
import { MCPClient } from '../MCPClient';
import { analytics } from '../../../utils/analytics';
import { debug } from '../../../utils/debug';
import {
  CLAUDE_PLUGIN_ID,
  CLAUDE_PLUGIN_MARKETPLACE_NAME,
  CLAUDE_PLUGIN_MARKETPLACE_REPO,
} from '../../../lib/constants';
import { findClaudeBinary } from './claude-binary';

const PLUGIN_REF = `${CLAUDE_PLUGIN_ID}@${CLAUDE_PLUGIN_MARKETPLACE_NAME}`;

function userSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
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
    return Promise.resolve(userSettingsPath());
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

  addServer(): Promise<{ success: boolean }> {
    const binary = findClaudeBinary();
    if (!binary) return Promise.resolve({ success: false });

    try {
      this.registerMarketplace();
    } catch (err) {
      analytics.captureException(
        new Error(
          `Failed to register Amplitude plugin marketplace: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
      return Promise.resolve({ success: false });
    }

    const installResult = spawnSync(
      binary,
      ['plugin', 'install', PLUGIN_REF, '--scope', 'user'],
      { stdio: 'pipe' },
    );

    if (installResult.status !== 0) {
      const stderr = installResult.stderr?.toString() ?? '';
      if (/already installed/i.test(stderr)) {
        debug('  Amplitude plugin already installed — continuing.');
      } else {
        analytics.captureException(
          new Error(`Failed to install Amplitude plugin: ${stderr}`),
        );
        return Promise.resolve({ success: false });
      }
    }

    this.removeStaleMcpEntry(binary);
    return Promise.resolve({ success: true });
  }

  removeServer(): Promise<{ success: boolean }> {
    const binary = findClaudeBinary();
    if (!binary) return Promise.resolve({ success: false });

    const result = spawnSync(
      binary,
      ['plugin', 'uninstall', PLUGIN_REF, '--scope', 'user'],
      { stdio: 'pipe' },
    );

    if (result.status !== 0) {
      analytics.captureException(
        new Error(
          `Failed to uninstall Amplitude plugin: ${result.stderr?.toString()}`,
        ),
      );
      return Promise.resolve({ success: false });
    }
    return Promise.resolve({ success: true });
  }

  /**
   * Register `amplitude/mcp-marketplace` in the user's Claude settings.
   * Uses jsonc-parser to preserve existing keys, comments, and formatting.
   */
  private registerMarketplace(): void {
    const settingsPath = userSettingsPath();
    const settingsDir = path.dirname(settingsPath);
    fs.mkdirSync(settingsDir, { recursive: true });

    const existing = fs.existsSync(settingsPath)
      ? fs.readFileSync(settingsPath, 'utf8')
      : '';

    const marketplaceValue = {
      source: {
        source: 'github',
        repo: CLAUDE_PLUGIN_MARKETPLACE_REPO,
      },
    };

    const edits = jsonc.modify(
      existing,
      ['extraKnownMarketplaces', CLAUDE_PLUGIN_MARKETPLACE_NAME],
      marketplaceValue,
      { formattingOptions: { tabSize: 2, insertSpaces: true } },
    );

    const next =
      edits.length > 0 ? jsonc.applyEdits(existing, edits) : existing;
    // jsonc.applyEdits returns "" for an empty file if no edits; ensure valid JSON.
    const finalContent = next.trim() === '' ? '{}\n' : next;
    fs.writeFileSync(settingsPath, finalContent, { mode: 0o644 });
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
