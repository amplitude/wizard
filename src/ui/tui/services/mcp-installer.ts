/**
 * McpInstaller — service layer between McpScreen and MCP business logic.
 *
 * Decouples the screen from step internals. Testable, swappable,
 * no dynamic imports in React components.
 */

import { z } from 'zod';
import {
  getSupportedClients,
  removeMCPServer,
  getInstalledClients,
} from '../../../steps/add-mcp-server-to-clients/index.js';
import { ALL_FEATURE_VALUES } from '../../../steps/add-mcp-server-to-clients/defaults.js';
import type { CloudRegion } from '../../../utils/types.js';
import { logToFile } from '../../../utils/debug.js';

const RawMCPClientSchema = z
  .object({
    name: z.string(),
    addServer: z.unknown(),
  })
  .refine((obj) => typeof obj.addServer === 'function', {
    message: 'addServer must be a function',
  });

interface RawMCPClient {
  name: string;
  addServer(
    apiKey: string | undefined,
    features: string[],
    local: boolean,
    zone: CloudRegion,
  ): Promise<{ success: boolean } | undefined>;
}

export interface McpClientInfo {
  name: string;
}

export interface McpInstaller {
  /** Detect which MCP-capable editors are available on this machine. */
  detectClients(): Promise<McpClientInfo[]>;

  /**
   * Install the Amplitude MCP server to the given clients.
   *
   * `zone` is read at install-time (not at construction) because the user's
   * region isn't known when the installer is created at app mount — it's
   * picked on RegionSelect later. The MCP URL written into each editor's
   * config persists past the wizard run, so passing the wrong zone leaves
   * an EU user pointed at the US MCP host forever. Defaults to 'us' for
   * test stubs and rare callers without zone context.
   *
   * Returns names of successfully installed clients.
   */
  install(clientNames: string[], zone?: CloudRegion): Promise<string[]>;

  /** Remove the Amplitude MCP server from all installed clients. Returns names of removed clients. */
  remove(): Promise<string[]>;
}

/**
 * Production McpInstaller backed by real MCP client detection and installation.
 *
 * @param local - When true, installs/removes the local development server
 *   (http://localhost:8787) instead of the production server. Mirrors the
 *   --local-mcp CLI flag and session.localMcp.
 */
export function createMcpInstaller(local = false): McpInstaller {
  // Cache the raw MCPClient objects so install() can reference them by name
  let cachedClients: Array<{ name: string; raw: unknown }> = [];

  return {
    async detectClients(): Promise<McpClientInfo[]> {
      const supported = await getSupportedClients();
      cachedClients = supported.map((c) => ({ name: c.name, raw: c }));
      return supported.map((c) => ({ name: c.name }));
    },

    async install(
      clientNames: string[],
      zone: CloudRegion = 'us',
    ): Promise<string[]> {
      const features = [...ALL_FEATURE_VALUES];

      // No access token — write URL only and let each editor handle OAuth on
      // first use. Pre-populating a token would break after 24 hours.
      const accessToken: string | undefined = undefined;

      const toInstall: RawMCPClient[] = [];
      for (const c of cachedClients) {
        if (!clientNames.includes(c.name)) continue;
        const parsed = RawMCPClientSchema.safeParse(c.raw);
        if (!parsed.success) {
          logToFile(
            `[McpInstaller] Skipping invalid client ${c.name}: ${parsed.error.message}`,
          );
          continue;
        }
        // Use the original instance, not parsed.data — Zod creates a plain-object
        // copy which strips the prototype chain and breaks `this` inside class methods.
        toInstall.push(c.raw as RawMCPClient);
      }

      if (toInstall.length === 0) {
        logToFile(
          `[McpInstaller] No clients matched. clientNames=${JSON.stringify(
            clientNames,
          )}, cached=${JSON.stringify(cachedClients.map((c) => c.name))}`,
        );
        return [];
      }

      const installed: string[] = [];
      for (const client of toInstall) {
        try {
          const result = await client.addServer(
            accessToken,
            features,
            local,
            zone,
          );
          if (result?.success) {
            installed.push(client.name);
          } else {
            logToFile(
              `[McpInstaller] addServer returned success=false for ${client.name}`,
            );
          }
        } catch (err) {
          logToFile(
            `[McpInstaller] addServer threw for ${client.name}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      return installed;
    },

    async remove(): Promise<string[]> {
      const installed = await getInstalledClients(local);
      if (installed.length === 0) return [];
      await removeMCPServer(installed, local);
      return installed.map((c) => c.name);
    },
  };
}
