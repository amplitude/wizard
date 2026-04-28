import { DefaultMCPClient } from '../MCPClient';
import { buildMCPUrl, DefaultMCPClientConfig } from '../defaults';
import { z } from 'zod';
import { spawnSync } from 'child_process';
import { analytics } from '../../../utils/analytics';
import { debug } from '../../../utils/debug';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export const ClaudeCodeMCPConfig = DefaultMCPClientConfig;

export type ClaudeCodeMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class ClaudeCodeMCPClient extends DefaultMCPClient {
  name = 'Claude Code';
  private claudeBinaryPath: string | null = null;

  constructor() {
    super();
  }

  private findClaudeBinary(): string | null {
    if (this.claudeBinaryPath) {
      return this.claudeBinaryPath;
    }

    // Common installation paths for Claude Code CLI
    const possiblePaths = [
      path.join(os.homedir(), '.local', 'bin', 'claude'),
      path.join(os.homedir(), '.claude', 'local', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
    ];

    for (const claudePath of possiblePaths) {
      if (fs.existsSync(claudePath)) {
        debug(`  Found claude binary at: ${claudePath}`);
        this.claudeBinaryPath = claudePath;
        return claudePath;
      }
    }

    // Search PATH directories manually — no exec, no tainted strings passed
    // to child_process.
    const pathDirs = (process.env.PATH ?? '').split(path.delimiter);
    for (const dir of pathDirs) {
      if (!dir) continue;
      const candidate = path.join(dir, 'claude');
      if (fs.existsSync(candidate)) {
        debug(`  Found claude in PATH: ${candidate}`);
        this.claudeBinaryPath = candidate;
        return candidate;
      }
    }

    return null;
  }

  isClientSupported(): Promise<boolean> {
    try {
      debug('  Checking for Claude Code...');
      const claudeBinary = this.findClaudeBinary();

      if (!claudeBinary) {
        debug('  Claude Code not found. Installation paths checked:');
        debug(`    - ${path.join(os.homedir(), '.local', 'bin', 'claude')}`);
        debug(`    - ${path.join(os.homedir(), '.claude', 'local', 'claude')}`);
        debug(`    - /usr/local/bin/claude`);
        debug(`    - /opt/homebrew/bin/claude`);
        debug(`    - PATH`);
        return Promise.resolve(false);
      }

      const result = spawnSync(claudeBinary, ['--version'], { stdio: 'pipe' });
      if (result.status !== 0) {
        return Promise.resolve(false);
      }
      const version = result.stdout.toString().trim();
      debug(`  Claude Code detected: ${version}`);
      return Promise.resolve(true);
    } catch (error) {
      debug(
        `  Claude Code check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return Promise.resolve(false);
    }
  }

  isServerInstalled(local?: boolean): Promise<boolean> {
    try {
      const claudeBinary = this.findClaudeBinary();
      if (!claudeBinary) {
        return Promise.resolve(false);
      }

      const result = spawnSync(claudeBinary, ['mcp', 'list'], {
        stdio: 'pipe',
      });
      const serverName = local ? 'amplitude-local' : 'amplitude';

      if (result.stdout.toString().includes(serverName)) {
        return Promise.resolve(true);
      }
    } catch {
      //
    }

    return Promise.resolve(false);
  }

  getConfigPath(): Promise<string> {
    throw new Error('Not implemented');
  }

  addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<{ success: boolean }> {
    const binary = this.findClaudeBinary();
    if (!binary) {
      return Promise.resolve({ success: false });
    }

    const serverName = local ? 'amplitude-local' : 'amplitude';
    const url = buildMCPUrl('streamable-http', selectedFeatures, local);

    // Build args array — no shell interpolation, no injection risk
    const addArgs = ['mcp', 'add', '--transport', 'http', serverName, url];
    if (apiKey) {
      addArgs.push('--header', `Authorization: Bearer ${apiKey}`);
    }
    addArgs.push('-s', 'user');

    let addResult = spawnSync(binary, addArgs, { stdio: 'pipe' });

    if (addResult.status !== 0) {
      const stderr = addResult.stderr?.toString() ?? '';
      // If the server already exists, remove and re-add so the config stays
      // current (e.g. URL params or auth changes).
      if (stderr.includes('already exists')) {
        const removeResult = spawnSync(
          binary,
          ['mcp', 'remove', '--scope', 'user', serverName],
          { stdio: 'pipe' },
        );
        if (removeResult.status !== 0) {
          analytics.captureException(
            new Error(
              `Failed to remove existing Claude Code MCP entry: ${removeResult.stderr?.toString()}`,
            ),
          );
          return Promise.resolve({ success: false });
        }
        addResult = spawnSync(binary, addArgs, { stdio: 'pipe' });
      }

      if (addResult.status !== 0) {
        analytics.captureException(
          new Error(
            `Failed to add server to Claude Code: ${addResult.stderr?.toString()}`,
          ),
        );
        return Promise.resolve({ success: false });
      }
    }

    return Promise.resolve({ success: true });
  }

  removeServer(local?: boolean): Promise<{ success: boolean }> {
    const binary = this.findClaudeBinary();
    if (!binary) {
      return Promise.resolve({ success: false });
    }

    const serverName = local ? 'amplitude-local' : 'amplitude';
    const result = spawnSync(
      binary,
      ['mcp', 'remove', '--scope', 'user', serverName],
      { stdio: 'pipe' },
    );

    if (result.status !== 0) {
      analytics.captureException(
        new Error(
          `Failed to remove server from Claude Code: ${result.stderr?.toString()}`,
        ),
      );
      return Promise.resolve({ success: false });
    }

    return Promise.resolve({ success: true });
  }
}
