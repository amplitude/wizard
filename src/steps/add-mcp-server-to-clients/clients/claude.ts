import { DefaultMCPClient } from '../MCPClient';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClientConfig } from '../defaults';
import { z } from 'zod';

export const ClaudeMCPConfig = DefaultMCPClientConfig;

export type ClaudeMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class ClaudeMCPClient extends DefaultMCPClient {
  name = 'Claude Desktop';

  constructor() {
    super();
  }

  async isClientSupported(): Promise<boolean> {
    return Promise.resolve(
      process.platform === 'darwin' || process.platform === 'win32',
    );
  }

  async getConfigPath(): Promise<string> {
    const homeDir = os.homedir();
    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    if (isMac) {
      return Promise.resolve(
        path.join(
          homeDir,
          'Library',
          'Application Support',
          'Claude',
          'claude_desktop_config.json',
        ),
      );
    }

    if (isWindows) {
      return Promise.resolve(
        path.join(
          process.env.APPDATA || '',
          'Claude',
          'claude_desktop_config.json',
        ),
      );
    }

    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  async addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<{ success: boolean }> {
    // Claude Desktop config uses stdio transport, so we need mcp-remote
    // to bridge to the remote streamable-http server. Use 'streamable-http'
    // type so the URL points to /mcp (the documented endpoint), not /sse.
    return this._addServerType(
      apiKey,
      'streamable-http',
      selectedFeatures,
      local,
    );
  }
}
