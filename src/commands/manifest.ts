import type { CommandModule } from 'yargs';

export const manifestCommand: CommandModule = {
  command: 'manifest',
  describe: 'Print a machine-readable description of the CLI (for AI agents)',
  builder: (yargs) => yargs,
  handler: () => {
    void (async () => {
      const { getAgentManifest } = await import('../lib/agent-manifest.js');
      process.stdout.write(JSON.stringify(getAgentManifest(), null, 2) + '\n');
      process.exit(0);
    })();
  },
};
