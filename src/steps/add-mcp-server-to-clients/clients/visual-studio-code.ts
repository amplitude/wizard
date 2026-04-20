import z from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClient, MCPServerConfig } from '../MCPClient';
import { buildMCPUrl } from '../defaults';

export const VisualStudioCodeMCPConfig = z
  .object({
    servers: z.record(
      z.string(),
      z.union([
        z.object({
          command: z.string().optional(),
          args: z.array(z.string()).optional(),
          env: z.record(z.string(), z.string()).optional(),
        }),
        z.object({
          type: z.enum(['http', 'sse']),
          url: z.string(),
          headers: z.record(z.string(), z.string()).optional(),
        }),
      ]),
    ),
  })
  .passthrough();

export type VisualStudioCodeMCPConfig = z.infer<
  typeof VisualStudioCodeMCPConfig
>;

export class VisualStudioCodeClient extends DefaultMCPClient {
  name = 'Visual Studio Code';

  getServerPropertyName(): string {
    return 'servers';
  }

  isClientSupported(): Promise<boolean> {
    // VS Code creates Code/User/ on first launch — absence == not installed.
    const homeDir = os.homedir();
    if (process.platform === 'darwin') {
      return Promise.resolve(
        fs.existsSync(
          path.join(homeDir, 'Library', 'Application Support', 'Code'),
        ),
      );
    }
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA;
      if (!appData) return Promise.resolve(false);
      return Promise.resolve(fs.existsSync(path.join(appData, 'Code')));
    }
    if (process.platform === 'linux') {
      return Promise.resolve(
        fs.existsSync(path.join(homeDir, '.config', 'Code')),
      );
    }
    return Promise.resolve(false);
  }

  async getConfigPath(): Promise<string> {
    const homeDir = os.homedir();
    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const isLinux = process.platform === 'linux';

    if (isMac) {
      return Promise.resolve(
        path.join(
          homeDir,
          'Library',
          'Application Support',
          'Code',
          'User',
          'mcp.json',
        ),
      );
    }

    if (isWindows) {
      return Promise.resolve(
        path.join(process.env.APPDATA || '', 'Code', 'User', 'mcp.json'),
      );
    }

    if (isLinux) {
      return Promise.resolve(
        path.join(homeDir, '.config', 'Code', 'User', 'mcp.json'),
      );
    }

    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  getServerConfig(
    apiKey: string | undefined,
    type: 'sse' | 'streamable-http',
    selectedFeatures?: string[],
    local?: boolean,
  ): MCPServerConfig {
    const config: MCPServerConfig = {
      type: 'http',
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
