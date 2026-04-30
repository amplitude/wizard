import * as fs from 'fs';
import * as path from 'path';
import * as jsonc from 'jsonc-parser';
import { z } from 'zod';
import type { CloudRegion } from '../../utils/types';
import { getDefaultServerConfig } from './defaults';

export type MCPServerConfig = Record<string, unknown>;

const MCPConfigSchema = z.record(z.string(), z.record(z.string(), z.unknown()));

export abstract class MCPClient {
  name: string;
  abstract getConfigPath(): Promise<string>;
  abstract getServerPropertyName(): string;
  abstract isServerInstalled(local?: boolean): Promise<boolean>;
  // `zone` defaults to 'us' for backward compat with the existing call
  // sites and tests. EU users SHOULD pass their resolved zone — the URL
  // gets baked into editor configs (Claude Code, Cursor, VS Code) and
  // persists past the wizard run.
  abstract addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
    zone?: CloudRegion,
  ): Promise<{ success: boolean }>;
  abstract removeServer(local?: boolean): Promise<{ success: boolean }>;
  abstract isClientSupported(): Promise<boolean>;
}

export abstract class DefaultMCPClient extends MCPClient {
  name = 'Default';

  constructor() {
    super();
  }

  getServerPropertyName(): string {
    return 'mcpServers';
  }

  getServerConfig(
    apiKey: string | undefined,
    type: 'sse' | 'streamable-http',
    selectedFeatures?: string[],
    local?: boolean,
    zone: CloudRegion = 'us',
  ): MCPServerConfig {
    return getDefaultServerConfig(apiKey, type, selectedFeatures, local, zone);
  }

  async isServerInstalled(local?: boolean): Promise<boolean> {
    try {
      const configPath = await this.getConfigPath();

      if (!fs.existsSync(configPath)) {
        return false;
      }

      const configContent = await fs.promises.readFile(configPath, 'utf8');
      const parsed = MCPConfigSchema.safeParse(jsonc.parse(configContent));
      const config = parsed.success ? parsed.data : {};
      const serverPropertyName = this.getServerPropertyName();
      const serverName = local ? 'amplitude-local' : 'amplitude';

      return (
        serverPropertyName in config && serverName in config[serverPropertyName]
      );
    } catch {
      return false;
    }
  }

  async addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
    zone: CloudRegion = 'us',
  ): Promise<{ success: boolean }> {
    return this._addServerType(apiKey, 'sse', selectedFeatures, local, zone);
  }

  async _addServerType(
    apiKey: string | undefined,
    type: 'sse' | 'streamable-http',
    selectedFeatures?: string[],
    local?: boolean,
    zone: CloudRegion = 'us',
  ): Promise<{ success: boolean }> {
    try {
      const configPath = await this.getConfigPath();
      const configDir = path.dirname(configPath);

      await fs.promises.mkdir(configDir, { recursive: true });

      const serverPropertyName = this.getServerPropertyName();
      let configContent = '';
      let existingConfig: Record<string, Record<string, unknown>> = {};

      if (fs.existsSync(configPath)) {
        configContent = await fs.promises.readFile(configPath, 'utf8');
        const parsed = MCPConfigSchema.safeParse(jsonc.parse(configContent));
        existingConfig = parsed.success ? parsed.data : {};
      }

      const newServerConfig = this.getServerConfig(
        apiKey,
        type,
        selectedFeatures,
        local,
        zone,
      );
      if (!existingConfig[serverPropertyName]) {
        existingConfig[serverPropertyName] = {};
      }
      const serverName = local ? 'amplitude-local' : 'amplitude';
      existingConfig[serverPropertyName][serverName] = newServerConfig;

      const edits = jsonc.modify(
        configContent,
        [serverPropertyName, serverName],
        newServerConfig,
        {
          formattingOptions: {
            tabSize: 2,
            insertSpaces: true,
          },
        },
      );

      const modifiedContent = jsonc.applyEdits(configContent, edits);

      await fs.promises.writeFile(configPath, modifiedContent, 'utf8');

      return { success: true };
    } catch {
      return { success: false };
    }
  }

  async removeServer(local?: boolean): Promise<{ success: boolean }> {
    try {
      const configPath = await this.getConfigPath();

      if (!fs.existsSync(configPath)) {
        return { success: false };
      }

      const configContent = await fs.promises.readFile(configPath, 'utf8');
      const parsed = MCPConfigSchema.safeParse(jsonc.parse(configContent));
      const config = parsed.success ? parsed.data : {};
      const serverPropertyName = this.getServerPropertyName();

      const serverName = local ? 'amplitude-local' : 'amplitude';

      if (
        serverPropertyName in config &&
        serverName in config[serverPropertyName]
      ) {
        const edits = jsonc.modify(
          configContent,
          [serverPropertyName, serverName],
          undefined,
          {
            formattingOptions: {
              tabSize: 2,
              insertSpaces: true,
            },
          },
        );

        const modifiedContent = jsonc.applyEdits(configContent, edits);

        await fs.promises.writeFile(configPath, modifiedContent, 'utf8');

        return { success: true };
      }
    } catch {
      //
    }

    return { success: false };
  }
}
