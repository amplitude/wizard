import type { Integration } from '../../lib/constants';
import { traceStep } from '../../telemetry';
import { analytics } from '../../utils/analytics';
import { getUI } from '../../ui';
import { MCPClient } from './MCPClient';
import { CursorMCPClient } from './clients/cursor';
import { ClaudeMCPClient } from './clients/claude';
import { ClaudeCodeMCPClient } from './clients/claude-code';
import { VisualStudioCodeClient } from './clients/visual-studio-code';
import { ZedClient } from './clients/zed';
import { CodexMCPClient } from './clients/codex';
import { ClineMCPClient } from './clients/cline';
import { WindsurfMCPClient } from './clients/windsurf';
import { GeminiCLIMCPClient } from './clients/gemini-cli';
import { AmpMCPClient } from './clients/amp';
import { OpenCodeMCPClient } from './clients/opencode';
import { ClaudeCodePluginClient } from './clients/claude-code-plugin';
import { ALL_FEATURE_VALUES } from './defaults';
import { debug } from '../../utils/debug';

/**
 * Deprecated clients — uninstall-only. Drop in next release.
 *
 * These clients are no longer offered for install, but the wizard still
 * needs to be able to scrub stale `mcpServers.amplitude` entries that
 * previous wizard versions wrote to their settings files. Their
 * `addServer` is a no-op; only `removeServer` does real work.
 */
const getDeprecatedUninstallOnlyClients = (): MCPClient[] => [
  new ClineMCPClient(),
  new WindsurfMCPClient(),
  new GeminiCLIMCPClient(),
  new AmpMCPClient(),
  new OpenCodeMCPClient(),
  new ClaudeCodePluginClient(),
];

export const getSupportedClients = async (): Promise<MCPClient[]> => {
  const allClients = [
    new CursorMCPClient(),
    new ClaudeMCPClient(),
    new ClaudeCodeMCPClient(),
    new VisualStudioCodeClient(),
    new ZedClient(),
    new CodexMCPClient(),
  ];
  debug('Checking for supported MCP clients...');
  // Run support checks in parallel — Claude Code + Codex shell out via
  // spawnSync/execSync, so doing them sequentially doubles wall-clock time.
  const supportFlags = await Promise.all(
    allClients.map(async (client) => {
      const isSupported = await client.isClientSupported();
      debug(
        `${client.name}: ${isSupported ? '✓ supported' : '✗ not supported'}`,
      );
      return isSupported;
    }),
  );
  const supportedClients = allClients.filter((_, i) => supportFlags[i]);
  debug(
    `Found ${supportedClients.length} supported client(s): ${supportedClients
      .map((c) => c.name)
      .join(', ')}`,
  );

  return supportedClients;
};

/**
 * Add MCP server to clients. No prompts — pure orchestration.
 * Prompts are handled by McpScreen (TUI) or auto-accepted (CI).
 */
export const addMCPServerToClientsStep = async ({
  integration,
  local = false,
  ci = false,
}: {
  integration?: Integration;
  local?: boolean;
  ci?: boolean;
}): Promise<string[]> => {
  const ui = getUI();

  // CI mode: skip MCP installation entirely
  if (ci) {
    ui.log.info('Skipping MCP installation (CI mode)');
    return [];
  }

  const supportedClients = await getSupportedClients();

  if (supportedClients.length === 0) {
    ui.log.info(
      'No supported MCP clients detected. Skipping MCP installation.',
    );
    return [];
  }

  // Auto-install to all supported clients
  await traceStep('adding mcp servers', async () => {
    await addMCPServer(
      supportedClients,
      undefined,
      [...ALL_FEATURE_VALUES],
      local,
    );
  });

  ui.log.success(
    `Added the MCP server to:
  ${supportedClients.map((c) => `- ${c.name}`).join('\n  ')} `,
  );

  analytics.wizardCapture('MCP Servers Added', {
    clients: supportedClients.map((c) => c.name),
    integration,
  });

  return supportedClients.map((c) => c.name);
};

export const removeMCPServerFromClientsStep = async ({
  integration,
  local = false,
}: {
  integration?: Integration;
  local?: boolean;
}): Promise<string[]> => {
  const installedClients = await getInstalledClients(local);
  if (installedClients.length === 0) {
    analytics.wizardCapture('MCP No Servers To Remove', {
      integration,
    });
    return [];
  }

  // Auto-remove from all installed clients
  const results = await traceStep('removing mcp servers', async () => {
    await removeMCPServer(installedClients, local);
    return installedClients.map((c) => c.name);
  });

  analytics.wizardCapture('MCP Servers Removed', {
    clients: results,
    integration,
  });

  return results;
};

export const getInstalledClients = async (
  local?: boolean,
): Promise<MCPClient[]> => {
  // Include deprecated uninstall-only clients here so the uninstall flow
  // can scrub stale config entries left over from previous wizard versions.
  // These clients aren't returned by getSupportedClients() (no install path),
  // but their isServerInstalled() probe still detects existing entries.
  const clients = [
    ...(await getSupportedClients()),
    ...getDeprecatedUninstallOnlyClients(),
  ];
  const installedClients: MCPClient[] = [];

  for (const client of clients) {
    if (await client.isServerInstalled(local)) {
      installedClients.push(client);
    }
  }

  return installedClients;
};

export const addMCPServer = async (
  clients: MCPClient[],
  personalApiKey?: string,
  selectedFeatures?: string[],
  local?: boolean,
): Promise<void> => {
  for (const client of clients) {
    await client.addServer(personalApiKey, selectedFeatures, local);
  }
};

export const removeMCPServer = async (
  clients: MCPClient[],
  local?: boolean,
): Promise<void> => {
  for (const client of clients) {
    await client.removeServer(local);
  }
};
