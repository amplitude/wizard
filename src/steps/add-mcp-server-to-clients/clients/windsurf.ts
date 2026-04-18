import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClient, MCPServerConfig } from '../MCPClient';
import { buildMCPUrl } from '../defaults';

export const WindsurfMCPConfig = z
  .object({
    mcpServers: z.record(
      z.string(),
      z.union([
        z.object({
          serverUrl: z.string().optional(),
          headers: z.record(z.string(), z.string()).optional(),
        }),
        z.object({
          command: z.string().optional(),
          args: z.array(z.string()).optional(),
          env: z.record(z.string(), z.string()).optional(),
        }),
      ]),
    ),
  })
  .passthrough();

export type WindsurfMCPConfig = z.infer<typeof WindsurfMCPConfig>;

export class WindsurfMCPClient extends DefaultMCPClient {
  name = 'Windsurf';

  getServerPropertyName(): string {
    return 'mcpServers';
  }

  isClientSupported(): Promise<boolean> {
    // Windsurf creates ~/.codeium/windsurf/ on first launch.
    return Promise.resolve(
      fs.existsSync(path.join(os.homedir(), '.codeium', 'windsurf')),
    );
  }

  getConfigPath(): Promise<string> {
    return Promise.resolve(
      path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
    );
  }

  getServerConfig(
    apiKey: string | undefined,
    type: 'sse' | 'streamable-http',
    selectedFeatures?: string[],
    local?: boolean,
  ): MCPServerConfig {
    // Windsurf uses `serverUrl` (not `url`) for remote MCP servers.
    const config: MCPServerConfig = {
      serverUrl: buildMCPUrl(type, selectedFeatures, local),
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
