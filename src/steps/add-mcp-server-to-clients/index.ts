import type { Integration } from '../../lib/constants';
import { traceStep } from '../../telemetry';
import { analytics } from '../../utils/analytics';
import { getUI } from '../../ui';
import { MCPClient } from './MCPClient';
import { CursorMCPClient } from './clients/cursor';
import { ClaudeMCPClient } from './clients/claude';
import { ClaudeCodeMCPClient } from './clients/claude-code';
import { ClaudeCodePluginClient } from './clients/claude-code-plugin';
import { VisualStudioCodeClient } from './clients/visual-studio-code';
import { ZedClient } from './clients/zed';
import { CodexMCPClient } from './clients/codex';
import { ALL_FEATURE_VALUES } from './defaults';
import { debug } from '../../utils/debug';

export type ClaudeCodeInstallMode = 'plugin' | 'mcp';

/**
 * When Claude Code is in the list and the caller wants plugin install,
 * replace its MCP client with the plugin client. No-op for other editors.
 *
 * Async because the plugin client has to probe `claude plugin --help` to
 * confirm the subcommand exists — older Claude Code CLIs would accept the
 * --version check but fail opaquely during marketplace add. If plugin
 * support is missing we quietly keep the raw MCP client.
 */
export const resolveClientsForMode = async (
  clients: MCPClient[],
  mode: ClaudeCodeInstallMode,
): Promise<MCPClient[]> => {
  if (mode !== 'plugin') return clients;
  const plugin = new ClaudeCodePluginClient();
  const pluginSupported = await plugin.isClientSupported();
  if (!pluginSupported) return clients;
  return clients.map((c) =>
    c.name === 'Claude Code' && c instanceof ClaudeCodeMCPClient ? plugin : c,
  );
};

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
  // Parallelize — several clients shell out (claude --version, codex --version)
  // and a sequential loop adds up.
  const checks = await Promise.all(
    allClients.map(async (client) => {
      const isSupported = await client.isClientSupported();
      debug(
        `${client.name}: ${isSupported ? '✓ supported' : '✗ not supported'}`,
      );
      return { client, isSupported };
    }),
  );
  // Preserve the declared order so the "Found:" list is stable.
  const supportedClients = checks
    .filter((c) => c.isSupported)
    .map((c) => c.client);
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
  claudeCodeMode,
}: {
  integration?: Integration;
  local?: boolean;
  ci?: boolean;
  claudeCodeMode?: ClaudeCodeInstallMode;
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

  // Default 'mcp' for the non-interactive entry point — this fallback runs
  // when the TUI isn't available, so the user never saw the plugin picker.
  // Silently installing the plugin would surprise them. `--local-mcp` also
  // forces MCP mode (the plugin hardcodes the prod URL).
  const mode: ClaudeCodeInstallMode = local ? 'mcp' : claudeCodeMode ?? 'mcp';
  const clientsToInstall = await resolveClientsForMode(supportedClients, mode);

  // Auto-install to all supported clients
  await traceStep('adding mcp servers', async () => {
    await addMCPServer(
      clientsToInstall,
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
  const clients = await getSupportedClients();
  const installedClients: MCPClient[] = [];

  for (const client of clients) {
    // Claude Code can be installed two different ways — bare MCP entry
    // (ClaudeCodeMCPClient) or the Amplitude plugin (ClaudeCodePluginClient).
    // Detection-time only creates ClaudeCodeMCPClient, so probe for a plugin
    // install separately and substitute the plugin client when appropriate.
    // Without this, `wizard mcp remove` can never uninstall the plugin.
    //
    // Skip the plugin probe when --local is set — the plugin only ever
    // registers the production MCP, so a `remove --local` must target the
    // bare ClaudeCodeMCPClient (which is the only path that knows about
    // `amplitude-local`). Otherwise we'd uninstall the prod plugin in
    // response to a local-scoped remove request.
    if (!local && client instanceof ClaudeCodeMCPClient) {
      const plugin = new ClaudeCodePluginClient();
      if (await plugin.isServerInstalled()) {
        installedClients.push(plugin);
        continue;
      }
    }
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
