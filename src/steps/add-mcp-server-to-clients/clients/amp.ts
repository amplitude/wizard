import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClient, MCPServerConfig } from '../MCPClient';
import { buildMCPUrl } from '../defaults';

export const AmpMCPConfig = z
  .object({
    'amp.mcpServers': z
      .record(
        z.string(),
        z.union([
          z.object({
            url: z.string().optional(),
            headers: z.record(z.string(), z.string()).optional(),
          }),
          z.object({
            command: z.string().optional(),
            args: z.array(z.string()).optional(),
            env: z.record(z.string(), z.string()).optional(),
          }),
        ]),
      )
      .optional(),
  })
  .passthrough();

export type AmpMCPConfig = z.infer<typeof AmpMCPConfig>;

export class AmpMCPClient extends DefaultMCPClient {
  name = 'Amp';

  getServerPropertyName(): string {
    // Amp stores MCP servers under a flat, dotted key — not nested under "amp".
    return 'amp.mcpServers';
  }

  isClientSupported(): Promise<boolean> {
    return Promise.resolve(
      fs.existsSync(path.join(os.homedir(), '.config', 'amp')),
    );
  }

  getConfigPath(): Promise<string> {
    return Promise.resolve(
      path.join(os.homedir(), '.config', 'amp', 'settings.json'),
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
