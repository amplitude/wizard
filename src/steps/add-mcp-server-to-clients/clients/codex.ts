import { z } from 'zod';
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { DefaultMCPClient } from '../MCPClient';
import { buildMCPUrl, DefaultMCPClientConfig } from '../defaults';

import { analytics } from '../../../utils/analytics';

export const CodexMCPConfig = DefaultMCPClientConfig;

export type CodexMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class CodexMCPClient extends DefaultMCPClient {
  name = 'Codex';

  constructor() {
    super();
  }

  isClientSupported(): Promise<boolean> {
    // Require the binary on PATH, the ~/.codex/ user-data dir, AND that
    // the binary wasn't silently bundled by an outer tool (Conductor et al.
    // ship their own `codex`; the user didn't install it and would be
    // surprised to see Codex pop up in the wizard's picker).
    let resolved: string;
    try {
      resolved = execSync('command -v codex', { encoding: 'utf8' }).trim();
    } catch {
      return Promise.resolve(false);
    }
    if (!resolved) return Promise.resolve(false);
    // Anything inside an app bundle / Application Support is almost
    // certainly a host app bundling the CLI, not a user install.
    if (/\/Library\/Application Support\//i.test(resolved)) {
      return Promise.resolve(false);
    }
    return Promise.resolve(fs.existsSync(path.join(os.homedir(), '.codex')));
  }

  getConfigPath(): Promise<string> {
    throw new Error('Not implemented');
  }

  isServerInstalled(local?: boolean): Promise<boolean> {
    const serverName = local ? 'amplitude-local' : 'amplitude';

    try {
      const result = spawnSync('codex', ['mcp', 'list', '--json'], {
        encoding: 'utf-8',
      });

      if (result.error || result.status !== 0) {
        return Promise.resolve(false);
      }

      const stdout = result.stdout?.trim();
      if (!stdout) {
        return Promise.resolve(false);
      }

      const CodexServerListSchema = z.array(
        z.object({ name: z.string() }).passthrough(),
      );
      const servers = CodexServerListSchema.parse(JSON.parse(stdout));
      return Promise.resolve(
        servers.some((server) => server.name === serverName),
      );
    } catch {
      return Promise.resolve(false);
    }
  }

  addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<{ success: boolean }> {
    const serverName = local ? 'amplitude-local' : 'amplitude';
    const url = buildMCPUrl('streamable-http', selectedFeatures, local);

    const args = ['mcp', 'add', serverName, '--url', url];

    const env = { ...process.env };
    if (apiKey) {
      env.AMPLITUDE_API_KEY = apiKey;
      args.push('--bearer-token-env-var', 'AMPLITUDE_API_KEY');
    }

    const result = spawnSync('codex', args, { stdio: 'ignore', env });

    if (result.error || result.status !== 0) {
      analytics.captureException(
        new Error('Failed to add server to Codex CLI.'),
      );
      return Promise.resolve({ success: false });
    }

    return Promise.resolve({ success: true });
  }

  removeServer(local?: boolean): Promise<{ success: boolean }> {
    const serverName = local ? 'amplitude-local' : 'amplitude';
    const result = spawnSync('codex', ['mcp', 'remove', serverName], {
      stdio: 'ignore',
    });

    if (result.error || result.status !== 0) {
      analytics.captureException(
        new Error('Failed to remove server from Codex CLI.'),
      );
      return Promise.resolve({ success: false });
    }

    return Promise.resolve({ success: true });
  }
}

export default CodexMCPClient;
