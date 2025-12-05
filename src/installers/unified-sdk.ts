/**
 * Package installation utilities
 */
import { execa } from 'execa';
import ora from 'ora';
import chalk from 'chalk';
import { PackageManager } from '../types/index.js';
import type { Logger } from '../utils/logger.js';

const AMPLITUDE_PACKAGE = '@amplitude/unified';
const AMPLITUDE_PYTHON_PACKAGE = 'amplitude-analytics';

/**
 * Check if a package manager is for Python
 */
function isPythonPackageManager(packageManager: PackageManager): boolean {
  return (
    packageManager === PackageManager.PIP ||
    packageManager === PackageManager.POETRY ||
    packageManager === PackageManager.PIPENV
  );
}

/**
 * Install the Amplitude Unified SDK package
 */
export async function installAmplitudeSDK(
  installDir: string,
  packageManager: PackageManager,
  logger: Logger,
): Promise<void> {
  const isPython = isPythonPackageManager(packageManager);
  const packageName = isPython ? AMPLITUDE_PYTHON_PACKAGE : AMPLITUDE_PACKAGE;

  const spinner = ora(`Installing ${packageName}...`).start();

  try {
    const commands: Record<PackageManager, { command: string; args: string[] }> = {
      [PackageManager.NPM]: {
        command: 'npm',
        args: ['install', AMPLITUDE_PACKAGE],
      },
      [PackageManager.YARN]: {
        command: 'yarn',
        args: ['add', AMPLITUDE_PACKAGE],
      },
      [PackageManager.PNPM]: {
        command: 'pnpm',
        args: ['add', AMPLITUDE_PACKAGE],
      },
      [PackageManager.PIP]: {
        command: 'pip',
        args: ['install', AMPLITUDE_PYTHON_PACKAGE],
      },
      [PackageManager.POETRY]: {
        command: 'poetry',
        args: ['add', AMPLITUDE_PYTHON_PACKAGE],
      },
      [PackageManager.PIPENV]: {
        command: 'pipenv',
        args: ['install', AMPLITUDE_PYTHON_PACKAGE],
      },
    };

    const { command, args } = commands[packageManager];

    logger.debugLog(`Running: ${command} ${args.join(' ')}`);

    // Run the package manager command
    await execa(command, args, {
      cwd: installDir,
      stdio: 'pipe',
    });

    spinner.succeed(`Installed ${packageName}`);
  } catch (error: any) {
    spinner.fail(`Failed to install ${packageName}`);

    // Provide helpful error messages
    if (error.code === 'ENOENT') {
      // Command not found
      if (isPython) {
        await logger.newLine();
        await logger.error(
          `${chalk.red('✗')} ${chalk.bold(`${packageManager}` + ' command not found')}`,
        );
        await logger.newLine();
        await logger.info(
          chalk.dim('To use Python packages, you need to activate your Python environment:'),
        );
        await logger.newLine();

        if (packageManager === PackageManager.PIP) {
          await logger.info(chalk.dim('  # If using venv:'));
          await logger.info(chalk.cyan('  source venv/bin/activate'));
          await logger.info(chalk.dim('  # Or on Windows:'));
          await logger.info(chalk.cyan('  .\\venv\\Scripts\\activate'));
        } else if (packageManager === PackageManager.POETRY) {
          await logger.info(chalk.dim('  # Activate poetry shell:'));
          await logger.info(chalk.cyan('  poetry shell'));
        } else if (packageManager === PackageManager.PIPENV) {
          await logger.info(chalk.dim('  # Activate pipenv shell:'));
          await logger.info(chalk.cyan('  pipenv shell'));
        }

        await logger.newLine();
        await logger.info(chalk.dim('Then run the wizard again.'));
        await logger.newLine();
      } else {
        await logger.error(
          `${chalk.red('✗')} ${packageManager} command not found. Please install it first.`,
        );
      }
    } else {
      // Other errors
      await logger.error(`Installation error: ${error.message}`);
    }

    throw new Error(`Failed to install ${packageName}: ${error.message}`);
  }
}

/**
 * Check if Amplitude Unified SDK is already installed
 */
export function getPackageManagerCommand(
  packageManager: PackageManager,
  command: 'install' | 'run',
): string {
  switch (packageManager) {
    case PackageManager.NPM:
      return command === 'install' ? 'npm install' : 'npm run';
    case PackageManager.YARN:
      return command === 'install' ? 'yarn add' : 'yarn';
    case PackageManager.PNPM:
      return command === 'install' ? 'pnpm add' : 'pnpm';
    case PackageManager.PIP:
      return command === 'install' ? 'pip install' : 'python';
    case PackageManager.POETRY:
      return command === 'install' ? 'poetry add' : 'poetry run';
    case PackageManager.PIPENV:
      return command === 'install' ? 'pipenv install' : 'pipenv run';
  }
}
