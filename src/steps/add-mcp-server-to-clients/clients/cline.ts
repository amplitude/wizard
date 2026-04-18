import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClient, MCPServerConfig } from '../MCPClient';
import { buildMCPUrl, DefaultMCPClientConfig } from '../defaults';

export const ClineMCPConfig = DefaultMCPClientConfig;

export type ClineMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

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

  isClientSupported(): Promise<boolean> {
    const userDir = getVSCodeUserDir();
    if (!userDir) return Promise.resolve(false);
    // Cline creates its globalStorage dir on first activation; its absence
    // means the extension isn't installed (or never run).
    return Promise.resolve(
      fs.existsSync(path.join(userDir, 'globalStorage', CLINE_EXTENSION_ID)),
    );
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

  getServerConfig(
    apiKey: string | undefined,
    type: 'sse' | 'streamable-http',
    selectedFeatures?: string[],
    local?: boolean,
  ): MCPServerConfig {
    const config: MCPServerConfig = {
      url: buildMCPUrl(type, selectedFeatures, local),
    };
    if (apiKey) {
      config.headers = { Authorization: `Bearer ${apiKey}` };
    }
    return config;
  }

  async addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<{ success: boolean }> {
    return this._addServerType(
      apiKey,
      'streamable-http',
      selectedFeatures,
      local,
    );
  }
}
