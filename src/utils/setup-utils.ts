import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import chalk from 'chalk';
import { traceStep } from '../telemetry';
import { debug } from './debug';
import type { PackageDotJson } from './package-json';
import {
  type PackageManager,
  detectAllPackageManagers,
  NPM as npm,
} from './package-manager';
import type { CloudRegion, WizardOptions } from './types';
import { getPackageVersion } from './package-json';
import { DEFAULT_HOST_URL, ISSUES_URL } from '../lib/constants';
import { analytics } from './analytics';
import { getUI } from '../ui';
import { performAmplitudeAuth } from './oauth';
import { fetchAmplitudeUser } from '../lib/api';
import { storeToken } from './ampli-settings';
import { DEFAULT_AMPLITUDE_ZONE } from '../lib/constants';
import { fulfillsVersionRange } from './semver';
import { wizardAbort } from './wizard-abort';

interface ProjectData {
  projectApiKey: string;
  accessToken: string;
  host: string;
  distinctId: string;
  projectId: number;
}

export interface CliSetupConfig {
  filename: string;
  name: string;
  gitignore: boolean;

  likelyAlreadyHasAuthToken(contents: string): boolean;
  tokenContent(authToken: string): string;

  likelyAlreadyHasOrgAndProject(contents: string): boolean;
  orgAndProjContent(org: string, project: string): string;

  likelyAlreadyHasUrl?(contents: string): boolean;
  urlContent?(url: string): string;
}

export interface CliSetupConfigContent {
  authToken: string;
  org?: string;
  project?: string;
  url?: string;
}

/** @deprecated Use wizardAbort() directly for new code. */
export async function abort(message?: string, status?: number): Promise<never> {
  return wizardAbort({ message, exitCode: status });
}

export function isInGitRepo() {
  try {
    childProcess.execSync('git rev-parse --is-inside-work-tree', {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export function getUncommittedOrUntrackedFiles(): string[] {
  try {
    const gitStatus = childProcess
      .execSync('git status --porcelain=v1', {
        // we only care about stdout
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .toString();

    const files = gitStatus
      .split(os.EOL)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((f) => `- ${f.split(/\s+/)[1]}`);

    return files;
  } catch {
    return [];
  }
}

export async function isReact19Installed({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<boolean> {
  try {
    const packageJson = await tryGetPackageJson({ installDir });
    if (!packageJson) return false;
    const reactVersion = getPackageVersion('react', packageJson);

    if (!reactVersion) {
      return false;
    }

    return fulfillsVersionRange({
      version: reactVersion,
      acceptableVersions: '>=19.0.0',
      canBeLatest: true,
    });
  } catch {
    return false;
  }
}

/**
 * Installs or updates a package with the user's package manager.
 *
 * IMPORTANT: This function modifies the `package.json`! Be sure to re-read
 * it if you make additional modifications to it after calling this function!
 */
export async function installPackage({
  packageName,
  alreadyInstalled,
  packageNameDisplayLabel,
  packageManager,
  forceInstall = false,
  integration,
  installDir,
}: {
  packageName: string;
  alreadyInstalled: boolean;
  packageNameDisplayLabel?: string;
  packageManager?: PackageManager;
  forceInstall?: boolean;
  integration?: string;
  installDir: string;
}): Promise<{ packageManager?: PackageManager }> {
  return traceStep('install-package', async () => {
    const sdkInstallSpinner = getUI().spinner();

    const pkgManager =
      packageManager || (await getPackageManager({ installDir }));

    const isReact19 = await isReact19Installed({ installDir });
    const legacyPeerDepsFlag =
      isReact19 && pkgManager.name === 'npm' ? '--legacy-peer-deps' : '';

    sdkInstallSpinner.start(
      `${alreadyInstalled ? 'Updating' : 'Installing'} ${chalk.bold.cyan(
        packageNameDisplayLabel ?? packageName,
      )} with ${chalk.bold(pkgManager.label)}.`,
    );

    try {
      await new Promise<void>((resolve, reject) => {
        childProcess.exec(
          `${pkgManager.installCommand} ${packageName} ${pkgManager.flags} ${
            forceInstall ? pkgManager.forceInstallFlag : ''
          } ${legacyPeerDepsFlag}`.trim(),
          { cwd: installDir },
          (err, stdout, stderr) => {
            if (err) {
              fs.writeFileSync(
                join(
                  process.cwd(),
                  `amplitude-wizard-installation-error-${Date.now()}.log`,
                ),
                JSON.stringify({
                  stdout,
                  stderr,
                }),
                { encoding: 'utf8' },
              );

              reject(err);
            } else {
              resolve();
            }
          },
        );
      });
    } catch (e) {
      sdkInstallSpinner.stop('Installation failed.');
      getUI().log.error(
        `${chalk.red(
          'Encountered the following error during installation:',
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        )}\n\n${e}\n\n${chalk.dim(
          `The wizard has created a \`amplitude-wizard-installation-error-*.log\` file. If you think this issue is caused by the Amplitude wizard, create an issue on GitHub and include the log file's content:\n${ISSUES_URL}`,
        )}`,
      );
      await abort();
    }

    sdkInstallSpinner.stop(
      `${alreadyInstalled ? 'Updated' : 'Installed'} ${chalk.bold.cyan(
        packageNameDisplayLabel ?? packageName,
      )} with ${chalk.bold(pkgManager.label)}.`,
    );

    analytics.wizardCapture('package installed', {
      package_name: packageName,
      package_manager: pkgManager.name,
      integration,
    });

    return { packageManager: pkgManager };
  });
}

/**
 * Get package.json or abort the wizard if not found.
 * Only use where package.json is required (e.g., package install, overrides).
 * For detection/version-checks, use tryGetPackageJson() instead.
 */
export async function getPackageDotJson({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<PackageDotJson> {
  const packageJsonFileContents = await fs.promises
    .readFile(join(installDir, 'package.json'), 'utf8')
    .catch(() => {
      getUI().log.error(
        'Could not find package.json. Make sure to run the wizard in the root of your app!',
      );
      return abort();
    });

  let packageJson: PackageDotJson | undefined = undefined;

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    packageJson = JSON.parse(packageJsonFileContents);
  } catch {
    getUI().log.error(
      `Unable to parse your ${chalk.cyan(
        'package.json',
      )}. Make sure it has a valid format!`,
    );

    await abort();
  }

  return packageJson || {};
}

/**
 * Try to get package.json, returning null if it doesn't exist.
 * Use this for detection purposes where missing package.json is expected (e.g., Python projects).
 */
export async function tryGetPackageJson({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<PackageDotJson | null> {
  try {
    const packageJsonFileContents = await fs.promises.readFile(
      join(installDir, 'package.json'),
      'utf8',
    );
    return JSON.parse(packageJsonFileContents) as PackageDotJson;
  } catch {
    return null;
  }
}

export async function updatePackageDotJson(
  packageDotJson: PackageDotJson,
  { installDir }: Pick<WizardOptions, 'installDir'>,
): Promise<void> {
  try {
    await fs.promises.writeFile(
      join(installDir, 'package.json'),
      JSON.stringify(packageDotJson, null, 2),
      {
        encoding: 'utf8',
        flag: 'w',
      },
    );
  } catch {
    getUI().log.error(`Unable to update your ${chalk.cyan('package.json')}.`);

    await abort();
  }
}

/**
 * Detect and return the package manager. Pure — no prompts.
 * Falls back to first detected or npm if ambiguous.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function getPackageManager(
  options: Pick<WizardOptions, 'installDir'> & { ci?: boolean },
): Promise<PackageManager> {
  const detectedPackageManagers = detectAllPackageManagers({
    installDir: options.installDir,
  });

  if (detectedPackageManagers.length >= 1) {
    const selected = detectedPackageManagers[0];
    analytics.setTag('package-manager', selected.name);
    return selected;
  }

  // No package manager detected — default to npm
  analytics.setTag('package-manager', npm.name);
  return npm;
}

export function isUsingTypeScript({
  installDir,
}: Pick<WizardOptions, 'installDir'>) {
  try {
    return fs.existsSync(join(installDir, 'tsconfig.json'));
  } catch {
    return false;
  }
}

/**
 * Get project data for the wizard via Amplitude OAuth or CI API key.
 */
export async function getOrAskForProjectData(
  _options: Pick<WizardOptions, 'signup' | 'ci' | 'apiKey' | 'projectId'>,
): Promise<{
  host: string;
  projectApiKey: string;
  accessToken: string;
  projectId: number;
  cloudRegion: CloudRegion;
}> {
  // CI mode: bypass OAuth, use a pre-supplied Amplitude API key
  if (_options.ci && _options.apiKey) {
    getUI().log.info('Using provided API key (CI mode - OAuth bypassed)');
    return {
      host: DEFAULT_HOST_URL,
      projectApiKey: _options.apiKey,
      accessToken: _options.apiKey,
      projectId: _options.projectId ?? 0,
      cloudRegion: 'us',
    };
  }

  const result = await traceStep('login', () => askForWizardLogin());

  return {
    accessToken: result.accessToken,
    host: DEFAULT_HOST_URL,
    projectApiKey: result.projectApiKey,
    projectId: result.projectId,
    cloudRegion: 'us',
  };
}

async function askForWizardLogin(): Promise<ProjectData> {
  // ── 1. Authenticate via Amplitude OAuth (reuses ampli CLI session) ──
  const auth = await performAmplitudeAuth({ zone: DEFAULT_AMPLITUDE_ZONE });

  // ── 2. Fetch user info from Amplitude Data API ────────────────────
  let userInfo;
  try {
    userInfo = await fetchAmplitudeUser(auth.idToken, auth.zone);
  } catch {
    getUI().log.warn(
      chalk.yellow(
        'Could not fetch your Amplitude account details. Continuing without them.',
      ),
    );
  }

  if (userInfo) {
    // Persist user details back to ~/.ampli.json (replaces the "pending" entry)
    storeToken(
      {
        id: userInfo.id,
        firstName: userInfo.firstName,
        lastName: userInfo.lastName,
        email: userInfo.email,
        zone: auth.zone,
      },
      {
        accessToken: auth.accessToken,
        idToken: auth.idToken,
        refreshToken: auth.refreshToken,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      },
    );

    const orgName = userInfo.orgs[0]?.name ?? 'your org';
    getUI().log.success(
      `Logged in as ${chalk.bold(userInfo.email)} (${orgName})`,
    );
    analytics.setDistinctId(userInfo.id);
    analytics.setTag('opened-wizard-link', true);
  }

  // ── 3. Ask for the Amplitude project API key ─────────────────────
  // The analytics write key is not exposed via the Data API and must be
  // copied from Amplitude project settings.
  const projectApiKey = await askForAmplitudeApiKey();

  return {
    accessToken: auth.idToken,
    projectApiKey,
    host: DEFAULT_HOST_URL,
    distinctId: userInfo?.id ?? 'unknown',
    projectId: 0, // Amplitude doesn't use a numeric project ID in the same way
  };
}

async function askForAmplitudeApiKey(): Promise<string> {
  const { input } = await import('@inquirer/prompts');

  getUI().log.info(
    `\nTo finish setup, enter your Amplitude project ${chalk.bold(
      'API Key',
    )}.\n` +
      chalk.dim(
        `Find it at: Amplitude → Settings → Projects → [your project] → API Keys\n`,
      ),
  );

  const apiKey = await input({
    message: 'Amplitude API Key:',
    validate: (v: string) => v.trim().length > 0 || 'API key cannot be empty',
  });

  return apiKey.trim();
}

/**
 * Creates a new config file with the given filepath and codeSnippet.
 */
export async function createNewConfigFile(
  filepath: string,
  codeSnippet: string,
  { installDir }: Pick<WizardOptions, 'installDir'>,
  moreInformation?: string,
): Promise<boolean> {
  if (!isAbsolute(filepath)) {
    debug(`createNewConfigFile: filepath is not absolute: ${filepath}`);
    return false;
  }

  const prettyFilename = chalk.cyan(relative(installDir, filepath));

  try {
    await fs.promises.writeFile(filepath, codeSnippet);

    getUI().log.success(`Added new ${prettyFilename} file.`);

    if (moreInformation) {
      getUI().log.info(chalk.gray(moreInformation));
    }

    return true;
  } catch (e) {
    debug(e);
    getUI().log.warn(
      `Could not create a new ${prettyFilename} file. Please create one manually and follow the instructions below.`,
    );
  }

  return false;
}
