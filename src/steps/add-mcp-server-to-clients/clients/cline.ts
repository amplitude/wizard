/**
 * Cline — DEPRECATED. Uninstall-only. Drop in next release.
 *
 * Existing users may have a stale `mcpServers.amplitude` entry in
 * `cline_mcp_settings.json` from a previous wizard install. We keep the
 * `removeServer` codepath alive so the wizard's uninstall flow can scrub it.
 * The install path (`addServer`) is intentionally a no-op — Cline is no
 * longer in `getSupportedClients()`.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClient } from '../MCPClient';

// Cline is a VS Code extension; its MCP settings live inside VS Code's
// globalStorage, keyed by the extension publisher + name.
const CLINE_EXTENSION_ID = 'saoudrizwan.claude-dev';

const getVSCodeUserDir = (): string | null => {
  const homeDir = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    return path.join(appData, 'Code', 'User');
  }
  if (process.platform === 'linux') {
    return path.join(homeDir, '.config', 'Code', 'User');
  }
  return null;
};

export class ClineMCPClient extends DefaultMCPClient {
  name = 'Cline';

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

  async getConfigPath(): Promise<string> {
    const userDir = getVSCodeUserDir();
    if (!userDir) {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }
    return Promise.resolve(
      path.join(
        userDir,
        'globalStorage',
        CLINE_EXTENSION_ID,
        'settings',
        'cline_mcp_settings.json',
      ),
    );
  }

  /** Install path retired — the wizard no longer offers Cline as a target. */
  addServer(): Promise<{ success: boolean }> {
    return Promise.resolve({ success: false });
  }
}
