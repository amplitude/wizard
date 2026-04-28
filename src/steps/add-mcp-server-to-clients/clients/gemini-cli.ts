/**
 * Gemini CLI — DEPRECATED. Uninstall-only. Drop in next release.
 *
 * Keeps `removeServer` alive so users with a stale `~/.gemini/settings.json`
 * `mcpServers.amplitude` entry from a previous wizard install can scrub it
 * via the uninstall flow. Not registered in `getSupportedClients()` —
 * install path is a no-op.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClient } from '../MCPClient';

export class GeminiCLIMCPClient extends DefaultMCPClient {
  name = 'Gemini CLI';

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
    return Promise.resolve(path.join(os.homedir(), '.gemini', 'settings.json'));
  }

  addServer(): Promise<{ success: boolean }> {
    return Promise.resolve({ success: false });
  }
}
