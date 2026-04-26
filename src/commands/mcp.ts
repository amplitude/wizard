import type { CommandModule } from 'yargs';
import { setUI, LoggingUI } from './helpers';
import { CLI_INVOCATION, IS_WIZARD_DEV, WIZARD_VERSION } from './context';

export const mcpCommand: CommandModule = {
  command: 'mcp <command>',
  describe: 'Manage the Amplitude MCP server',
  builder: (yargs) =>
    yargs
      .command(
        'add',
        'Install the Amplitude MCP server into your editor',
        (yargs) =>
          yargs.options({
            local: {
              default: false,
              describe: 'use a local MCP server for development',
              type: 'boolean',
              hidden: !IS_WIZARD_DEV,
            },
          }),
        (argv) => {
          const options = { ...argv };
          void (async () => {
            try {
              const { startTUI } = await import('../ui/tui/start-tui.js');
              const { buildSession } = await import('../lib/wizard-session.js');

              const { Flow } = await import('../ui/tui/router.js');
              const tui = startTUI(WIZARD_VERSION, Flow.McpAdd);
              const session = buildSession({
                debug: options.debug as boolean | undefined,
                localMcp: options.local as boolean | undefined,
              });
              tui.store.session = session;
            } catch {
              // TUI unavailable — fallback to logging
              setUI(new LoggingUI());
              const { addMCPServerToClientsStep } = await import(
                '../steps/add-mcp-server-to-clients/index.js'
              );
              await addMCPServerToClientsStep({
                local: options.local as boolean | undefined,
              });
            }
          })();
        },
      )
      .command(
        'remove',
        'Remove the Amplitude MCP server from your editor',
        (yargs) =>
          yargs.options({
            local: {
              default: false,
              describe: 'remove a local MCP server',
              type: 'boolean',
              hidden: !IS_WIZARD_DEV,
            },
          }),
        (argv) => {
          const options = { ...argv };
          void (async () => {
            try {
              const { startTUI } = await import('../ui/tui/start-tui.js');
              const { buildSession } = await import('../lib/wizard-session.js');

              const { Flow } = await import('../ui/tui/router.js');
              const tui = startTUI(WIZARD_VERSION, Flow.McpRemove);
              const session = buildSession({
                debug: options.debug as boolean | undefined,
                localMcp: options.local as boolean | undefined,
              });
              tui.store.session = session;
            } catch {
              // TUI unavailable — fallback to logging
              setUI(new LoggingUI());
              const { removeMCPServerFromClientsStep } = await import(
                '../steps/add-mcp-server-to-clients/index.js'
              );
              await removeMCPServerFromClientsStep({
                local: options.local as boolean | undefined,
              });
            }
          })();
        },
      )
      .command(
        'serve',
        'Run the Amplitude wizard MCP server on stdio (for AI coding agents)',
        () => {},
        () => {
          void (async () => {
            try {
              const { startAgentMcpServer } = await import(
                '../lib/wizard-mcp-server.js'
              );
              await startAgentMcpServer();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              process.stderr.write(
                `${CLI_INVOCATION} mcp serve: failed to start: ${msg}\n`,
              );
              process.exit(1);
            }
          })();
        },
      )
      .demandCommand(1, 'You must specify a subcommand (add, remove, or serve)')
      .help(),
  handler: () => {},
};
