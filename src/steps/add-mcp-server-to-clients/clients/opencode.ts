import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClient, MCPServerConfig } from '../MCPClient';
import { buildMCPUrl } from '../defaults';

export const OpenCodeMCPConfig = z
  .object({
    mcp: z
      .record(
        z.string(),
        z.union([
          z.object({
            type: z.literal('remote'),
            url: z.string(),
            headers: z.record(z.string(), z.string()).optional(),
          }),
          z.object({
            type: z.literal('local'),
            command: z.array(z.string()),
            environment: z.record(z.string(), z.string()).optional(),
          }),
        ]),
      )
      .optional(),
  })
  .passthrough();

export type OpenCodeMCPConfig = z.infer<typeof OpenCodeMCPConfig>;

export class OpenCodeMCPClient extends DefaultMCPClient {
  name = 'OpenCode';

  getServerPropertyName(): string {
    // OpenCode uses the top-level `mcp` key (not `mcpServers`).
    return 'mcp';
  }

  isClientSupported(): Promise<boolean> {
    return Promise.resolve(
      fs.existsSync(path.join(os.homedir(), '.config', 'opencode')),
    );
  }

  getConfigPath(): Promise<string> {
    return Promise.resolve(
      path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
    );
  }

  getServerConfig(
    apiKey: string | undefined,
    type: 'sse' | 'streamable-http',
    selectedFeatures?: string[],
    local?: boolean,
  ): MCPServerConfig {
    // OpenCode distinguishes remote vs local servers via an explicit `type`
    // discriminator and uses `headers` on remote entries.
    const config: MCPServerConfig = {
      type: 'remote',
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
