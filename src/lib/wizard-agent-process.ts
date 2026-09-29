import { spawn } from 'child_process';
import type { Options } from '@anthropic-ai/claude-agent-sdk' assert { 'resolution-mode': 'import' };
import type { AgentDriver } from './agent-driver.js';
import { createLogger } from './observability/logger.js';

const log = createLogger('agent-process');

export const WIZARD_PROCESS_NAME = 'amplitude-wizard';

export function wizardAgentEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Apply at the spawn boundary, after nested-Claude env sanitization.
  return { ...env, CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1' };
}

export function wizardAgentSpawner(
  stderr?: (data: string) => void,
): NonNullable<Options['spawnClaudeCodeProcess']> {
  return (options) => {
    // iTerm's Claude integration matches the foreground job's argv[0].
    // Keep the SDK-selected executable, but identify its job as the wizard.
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: wizardAgentEnv(options.env),
      signal: options.signal,
      argv0: WIZARD_PROCESS_NAME,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    // A custom SDK spawner owns stderr: always drain it to avoid blocking,
    // decode across chunk boundaries, and preserve the caller's log filter.
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (data: string) => {
      if (stderr) stderr(data);
      else log.debug('Agent stderr', { data });
    });
    child.stderr.on('error', (error: Error) => {
      log.debug('Could not read agent stderr', { message: error.message });
    });
    return child;
  };
}

export function withWizardProcessIdentity(driver: AgentDriver): AgentDriver {
  return ({ prompt, options }) =>
    driver({
      prompt,
      options: {
        ...options,
        spawnClaudeCodeProcess: wizardAgentSpawner(
          options?.stderr as Options['stderr'],
        ),
      },
    });
}
