import { DefaultMCPClient, MCPServerConfig } from '../MCPClient';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClientConfig, getNativeHTTPServerConfig } from '../defaults';
import { z } from 'zod';

export const CursorMCPConfig = DefaultMCPClientConfig;

export type CursorMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class CursorMCPClient extends DefaultMCPClient {
  name = 'Cursor';

  constructor() {
    super();
  }

  isClientSupported(): Promise<boolean> {
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      return Promise.resolve(false);
    }
    // Cursor creates ~/.cursor/ on first launch; absence == not installed.
    return Promise.resolve(fs.existsSync(path.join(os.homedir(), '.cursor')));
  }

  async getConfigPath(): Promise<string> {
    return Promise.resolve(path.join(os.homedir(), '.cursor', 'mcp.json'));
  }

  getServerConfig(
    apiKey: string | undefined,
    type: 'sse' | 'streamable-http',
    selectedFeatures?: string[],
    local?: boolean,
  ): MCPServerConfig {
    const config = getNativeHTTPServerConfig(
      apiKey,
      type,
      selectedFeatures,
      local,
    );
    // Cursor requires an explicit transport field to use streamable-http
    return { ...config, transport: 'streamable-http' };
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
