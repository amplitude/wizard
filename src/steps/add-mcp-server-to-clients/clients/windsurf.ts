/**
 * Windsurf — DEPRECATED. Uninstall-only. Drop in next release.
 *
 * Keeps `removeServer` alive so users with a stale `~/.codeium/windsurf/
 * mcp_config.json` `mcpServers.amplitude` entry from a previous wizard
 * install can scrub it via the uninstall flow. Not registered in
 * `getSupportedClients()` — install path is a no-op.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClient } from '../MCPClient';

export class WindsurfMCPClient extends DefaultMCPClient {
  name = 'Windsurf';

  getServerPropertyName(): string {
    return 'mcpServers';
  }

  /** Uninstall-only: returns true only when a stale config file exists. */
  async isClientSupported(): Promise<boolean> {
    try {
      const configPath = await this.getConfigPath();
      return fs.existsSync(configPath);
    } catch {
      return false;
    }
  }

  getConfigPath(): Promise<string> {
    return Promise.resolve(
      path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
    );
  }

  addServer(): Promise<{ success: boolean }> {
    return Promise.resolve({ success: false });
  }
}
