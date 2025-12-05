/**
 * Amplitude MCP server installation utilities
 */
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { Logger } from './logger.js';
import chalk from 'chalk';

const AMPLITUDE_MCP_URL = 'https://mcp.amplitude.com/mcp';
const AMPLITUDE_MCP_EU_URL = 'https://mcp.eu.amplitude.com/mcp';

interface MCPClient {
  name: string;
  configPath: string;
  isSupported: () => boolean;
}

/**
 * Get Cursor config path based on platform
 */
function getCursorConfigPath(): string {
  return path.join(os.homedir(), '.cursor', 'mcp.json');
}

/**
 * Get VSCode config path based on platform
 */
function getVSCodeConfigPath(): string {
  const homeDir = os.homedir();

  if (process.platform === 'darwin') {
    return path.join(
      homeDir,
      'Library',
      'Application Support',
      'Code',
      'User',
      'mcp.json',
    );
  }

  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Code', 'User', 'mcp.json');
  }

  // Linux
  return path.join(homeDir, '.config', 'Code', 'User', 'mcp.json');
}

/**
 * Get all supported IDE clients
 */
export function getSupportedClients(): MCPClient[] {
  const clients: MCPClient[] = [];

  // Cursor (macOS and Windows only)
  if (process.platform === 'darwin' || process.platform === 'win32') {
    clients.push({
      name: 'Cursor',
      configPath: getCursorConfigPath(),
      isSupported: () =>
        process.platform === 'darwin' || process.platform === 'win32',
    });
  }

  // VSCode (all platforms)
  clients.push({
    name: 'VSCode',
    configPath: getVSCodeConfigPath(),
    isSupported: () => true,
  });

  return clients;
}

/**
 * Check if Amplitude MCP is already configured for an IDE
 */
export async function isAmplitudeMCPConfigured(
  configPath: string,
): Promise<boolean> {
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    // Check for Amplitude in mcpServers (Cursor) or servers (VSCode)
    const servers = config.mcpServers || config.servers || {};
    return 'Amplitude' in servers || 'amplitude' in servers;
  } catch {
    return false;
  }
}

/**
 * Add Amplitude MCP configuration to an IDE
 */
export async function addAmplitudeMCPToIDE(
  client: MCPClient,
  isEU: boolean,
  logger: Logger,
): Promise<void> {
  const mcpUrl = isEU ? AMPLITUDE_MCP_EU_URL : AMPLITUDE_MCP_URL;
  const configPath = client.configPath;

  try {
    // Ensure directory exists
    const configDir = path.dirname(configPath);
    await fs.mkdir(configDir, { recursive: true });

    // Read existing config or create new one
    let config: any = {};
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      config = JSON.parse(content);
    } catch {
      // File doesn't exist or invalid JSON, start fresh
      config = {};
    }

    // Add Amplitude configuration
    if (client.name === 'Cursor') {
      // Cursor uses mcpServers with streamable-http transport
      if (!config.mcpServers) {
        config.mcpServers = {};
      }
      config.mcpServers.Amplitude = {
        url: mcpUrl,
        transport: 'streamable-http',
      };
    } else {
      // VSCode uses servers property
      if (!config.servers) {
        config.servers = {};
      }
      config.servers.Amplitude = {
        url: mcpUrl,
        transport: 'streamable-http',
      };
    }

    // Write updated config
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    logger.debugLog(`Added Amplitude MCP to ${client.name} at ${configPath}`);
  } catch (error: any) {
    throw new Error(
      `Failed to configure ${client.name}: ${error.message}`,
    );
  }
}
