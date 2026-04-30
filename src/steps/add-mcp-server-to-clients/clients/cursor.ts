import { DefaultMCPClient, MCPServerConfig } from '../MCPClient';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClientConfig, getNativeHTTPServerConfig } from '../defaults';
import type { CloudRegion } from '../../../utils/types';
import { z } from 'zod';

export const CursorMCPConfig = DefaultMCPClientConfig;

export type CursorMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class CursorMCPClient extends DefaultMCPClient {
  name = 'Cursor';

  constructor() {
    super();
  }

  async isClientSupported(): Promise<boolean> {
    // Cursor ships on macOS, Windows, and Linux (AppImage). Per
    // https://cursor.com/docs the global MCP config lives at
    // `~/.cursor/mcp.json` on every platform, so we treat all three as
    // supported. Cursor creates ~/.cursor/ on first launch; absence ==
    // not installed.
    if (
      process.platform !== 'darwin' &&
      process.platform !== 'win32' &&
      process.platform !== 'linux'
    ) {
      return Promise.resolve(false);
    }
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
    zone: CloudRegion = 'us',
  ): MCPServerConfig {
    const config = getNativeHTTPServerConfig(
      apiKey,
      type,
      selectedFeatures,
      local,
      zone,
    );
    // Cursor requires an explicit transport field to use streamable-http
    return { ...config, transport: 'streamable-http' };
  }

  async addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
    zone: CloudRegion = 'us',
  ): Promise<{ success: boolean }> {
    return this._addServerType(
      apiKey,
      'streamable-http',
      selectedFeatures,
      local,
      zone,
    );
  }
}
