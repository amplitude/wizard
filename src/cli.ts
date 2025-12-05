/**
 * CLI interface using Commander
 */
import { Command } from 'commander';
import path from 'path';
import type { WizardOptions } from './types/index.js';

export async function createCLI(): Promise<Command> {
  const program = new Command();

  program
    .name('amplitude-wizard')
    .description(
      'AI-powered CLI wizard to integrate Amplitude Unified SDK into your project',
    )
    .version('0.1.0');

  program
    .option(
      '--install-dir <path>',
      'Directory to install Amplitude SDK',
      process.cwd(),
    )
    .option('--api-key <key>', 'Amplitude API key')
    .option('--deployment-key <key>', 'Amplitude Deployment key (for Experiment)')
    .option('--anthropic-api-key <key>', 'Anthropic API key for Claude')
    .option('--debug', 'Enable debug logging', false)
    .option(
      '--default',
      'Non-interactive mode (use defaults for all prompts)',
      false,
    )
    .option('--dry-run', 'Show what would be changed without making changes', false)
    .action(async (options) => {
      // Debug: Check if environment variable is available
      if (options.debug) {
        console.log('[DEBUG] ANTHROPIC_API_KEY from env:', process.env.ANTHROPIC_API_KEY ? 'Found' : 'Not found');
        console.log('[DEBUG] anthropic-api-key from CLI:', options.anthropicApiKey ? 'Provided' : 'Not provided');
      }

      const wizardOptions: WizardOptions = {
        installDir: path.resolve(options.installDir),
        apiKey: options.apiKey,
        deploymentKey: options.deploymentKey,
        anthropicApiKey: options.anthropicApiKey || process.env.ANTHROPIC_API_KEY,
        debug: options.debug,
        default: options.default,
        dryRun: options.dryRun,
      };

      // Lazy load wizard to speed up CLI startup
      if (options.debug) {
        console.log('[DEBUG] About to load wizard module...');
        const startLoad = performance.now();
        const { runWizard } = await import('./wizard.js');
        console.log(`[DEBUG] Loaded wizard module in ${(performance.now() - startLoad).toFixed(2)}ms`);
        await runWizard(wizardOptions);
      } else {
        const { runWizard } = await import('./wizard.js');
        await runWizard(wizardOptions);
      }
    });

  return program;
}
