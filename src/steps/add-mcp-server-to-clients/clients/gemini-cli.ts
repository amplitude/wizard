import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClient, MCPServerConfig } from '../MCPClient';
import { getNativeHTTPServerConfig } from '../defaults';

export const GeminiCLIMCPConfig = z
  .object({
    mcpServers: z.record(
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
    ),
  })
  .passthrough();

export type GeminiCLIMCPConfig = z.infer<typeof GeminiCLIMCPConfig>;

export class GeminiCLIMCPClient extends DefaultMCPClient {
  name = 'Gemini CLI';

  getServerPropertyName(): string {
    return 'mcpServers';
  }

  isClientSupported(): Promise<boolean> {
    return Promise.resolve(fs.existsSync(path.join(os.homedir(), '.gemini')));
  }

  getConfigPath(): Promise<string> {
    return Promise.resolve(path.join(os.homedir(), '.gemini', 'settings.json'));
  }

  getServerConfig(
    apiKey: string | undefined,
    type: 'sse' | 'streamable-http',
    selectedFeatures?: string[],
    local?: boolean,
  ): MCPServerConfig {
    return getNativeHTTPServerConfig(apiKey, type, selectedFeatures, local);
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
