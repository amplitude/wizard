/**
 * Deprecated MCP clients — uninstall-only. Drop in next release.
 *
 * Each of these clients was offered as an install target by an earlier wizard
 * version. The wizard no longer registers them in `getSupportedClients()`, but
 * users may still have a stale `<server-prop>.amplitude` entry in their
 * editor's settings file from a previous install. We keep the `removeServer`
 * codepath alive (inherited from `DefaultMCPClient`) so the uninstall flow
 * can scrub those entries — `addServer` is intentionally a no-op for every
 * client below.
 *
 * Five clients used to ship as five ~40-line files; the only thing that
 * varied across them was `name`, `getServerPropertyName()`, and
 * `getConfigPath()`. The factory below collapses that boilerplate into a
 * single declaration per client.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClient } from '../MCPClient';

interface DeprecatedClientSpec {
  /** Human-readable client name (surfaces in uninstall flow output). */
  name: string;
  /**
   * Top-level JSON key under which the client stores its MCP servers. Most
   * clients use `mcpServers`; Amp uses `amp.mcpServers` (flat dotted key,
   * not nested) and OpenCode uses `mcp`.
   */
  serverPropertyName: string;
  /**
   * Compute the absolute path to this client's settings file. Called at
   * call-time (not factory-time) so test platform overrides take effect.
   */
  resolveConfigPath: () => string | null;
}

class DeprecatedMCPClient extends DefaultMCPClient {
  private readonly spec: DeprecatedClientSpec;

  constructor(spec: DeprecatedClientSpec) {
    super();
    this.spec = spec;
    this.name = spec.name;
  }

  getServerPropertyName(): string {
    return this.spec.serverPropertyName;
  }

  /** Uninstall-only: returns true only when a stale config file exists. */
  async isClientSupported(): Promise<boolean> {
    try {
      const configPath = await this.getConfigPath();
      return fs.existsSync(configPath);
    } catch {
      return false;
    }
  }

  getConfigPath(): Promise<string> {
    const resolved = this.spec.resolveConfigPath();
    if (!resolved) {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }
    return Promise.resolve(resolved);
  }

  /** Install path retired — wizard no longer offers this client as a target. */
  addServer(): Promise<{ success: boolean }> {
    return Promise.resolve({ success: false });
  }
}

const homeJoin = (...parts: string[]): string =>
  path.join(os.homedir(), ...parts);

/** Cline — VS Code extension; settings live in VS Code's globalStorage. */
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

export class ClineMCPClient extends DeprecatedMCPClient {
  constructor() {
    super({
      name: 'Cline',
      serverPropertyName: 'mcpServers',
      resolveConfigPath: () => {
        const userDir = getVSCodeUserDir();
        if (!userDir) return null;
        return path.join(
          userDir,
          'globalStorage',
          CLINE_EXTENSION_ID,
          'settings',
          'cline_mcp_settings.json',
        );
      },
    });
  }
}

export class WindsurfMCPClient extends DeprecatedMCPClient {
  constructor() {
    super({
      name: 'Windsurf',
      serverPropertyName: 'mcpServers',
      resolveConfigPath: () =>
        homeJoin('.codeium', 'windsurf', 'mcp_config.json'),
    });
  }
}

export class GeminiCLIMCPClient extends DeprecatedMCPClient {
  constructor() {
    super({
      name: 'Gemini CLI',
      serverPropertyName: 'mcpServers',
      resolveConfigPath: () => homeJoin('.gemini', 'settings.json'),
    });
  }
}

export class AmpMCPClient extends DeprecatedMCPClient {
  constructor() {
    super({
      name: 'Amp',
      // Amp stores MCP servers under a flat, dotted key — not nested under
      // "amp". `DefaultMCPClient` looks this up verbatim in the parsed JSON.
      serverPropertyName: 'amp.mcpServers',
      resolveConfigPath: () => homeJoin('.config', 'amp', 'settings.json'),
    });
  }
}

export class OpenCodeMCPClient extends DeprecatedMCPClient {
  constructor() {
    super({
      name: 'OpenCode',
      // OpenCode uses the top-level `mcp` key (not `mcpServers`).
      serverPropertyName: 'mcp',
      resolveConfigPath: () => homeJoin('.config', 'opencode', 'opencode.json'),
    });
  }
}
