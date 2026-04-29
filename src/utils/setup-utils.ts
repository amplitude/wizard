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
import {
  DEFAULT_HOST_URL,
  DEFAULT_AMPLITUDE_ZONE,
  OUTBOUND_URLS,
} from '../lib/constants';
import { analytics } from './analytics';
import { getUI } from '../ui';
import { performAmplitudeAuth } from './oauth';
import { resolveStoredExpiryMs } from './jwt-exp';
import { fetchAmplitudeUser, type AmplitudeOrg } from '../lib/api';
import { type AppId, toCredentialAppId } from '../lib/wizard-session';
import { storeToken } from './ampli-settings';
import { detectRegionFromToken } from './urls';
import { fulfillsVersionRange } from './semver';
import { wizardAbort } from './wizard-abort';
import {
  ensureDir,
  getInstallationErrorLogFile,
  getRunDir,
} from './storage-paths';

interface ProjectData {
  projectApiKey: string;
  accessToken: string;
  host: string;
  distinctId: string;
  /** Branded `AppId` once known; `0` when the env hasn't been picked yet. */
  appId: AppId | 0;
  cloudRegion: CloudRegion;
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

    // Captured by the exec callback below; read in the catch arm to surface
    // the path in the user-facing error message. Typed as a wide union so
    // TypeScript doesn't narrow it to the initializer once a static-analysis
    // pass concludes the closure can't mutate it.
    const installErrorState: { logPath: string | null } = { logPath: null };
    try {
      // SECURITY: use execFile (no shell). The package name is wizard-derived
      // (not user-supplied) but we still build the argv from a tokenised list
      // so a future regression — e.g. a manifest field that ever lands in
      // `installCommand` — can't introduce shell injection. installCommand is
      // a multi-word string like "bun add" / "yarn add", so split on
      // whitespace to derive [executable, ...subcommandArgs].
      const [installExe, ...installArgs] = pkgManager.installCommand
        .trim()
        .split(/\s+/);
      const flagArgs = pkgManager.flags ? pkgManager.flags.split(/\s+/) : [];
      const forceArgs =
        forceInstall && pkgManager.forceInstallFlag
          ? pkgManager.forceInstallFlag.split(/\s+/)
          : [];
      const legacyArgs = legacyPeerDepsFlag
        ? legacyPeerDepsFlag.split(/\s+/)
        : [];

      await new Promise<void>((resolve, reject) => {
        childProcess.execFile(
          installExe,
          [
            ...installArgs,
            packageName,
            ...flagArgs,
            ...forceArgs,
            ...legacyArgs,
          ],
          { cwd: installDir },
          (err: Error | null, stdout, stderr) => {
            if (err) {
              // Land the error log under `~/.amplitude/wizard/runs/<hash>/`
              // so it (a) doesn't litter the user's project root and (b)
              // gets picked up by `/diagnostics --bundle`. Falls back to
              // the installation dir if the cache root mkdir fails.
              ensureDir(getRunDir(installDir));
              const logPath = getInstallationErrorLogFile(installDir);
              try {
                fs.writeFileSync(logPath, JSON.stringify({ stdout, stderr }), {
                  encoding: 'utf8',
                });
                installErrorState.logPath = logPath;
              } catch {
                // Best-effort — the underlying npm error is what really
                // matters; logging is supplementary.
              }

              reject(err);
            } else {
              resolve();
            }
          },
        );
      });
    } catch (e) {
      sdkInstallSpinner.stop('Installation failed.');
      const logHint = installErrorState.logPath
        ? `The wizard has saved the install error to:\n  ${installErrorState.logPath}\n\nIf you think this issue is caused by the Amplitude wizard, create an issue on GitHub and include the log file's content:\n${OUTBOUND_URLS.githubIssues}`
        : `If you think this issue is caused by the Amplitude wizard, create an issue on GitHub:\n${OUTBOUND_URLS.githubIssues}`;
      getUI().log.error(
        `${chalk.red(
          'Encountered the following error during installation:',
        )}\n\n${e}\n\n${chalk.dim(logHint)}`,
      );
      await abort();
    }

    sdkInstallSpinner.stop(
      `${alreadyInstalled ? 'Updated' : 'Installed'} ${chalk.bold.cyan(
        packageNameDisplayLabel ?? packageName,
      )} with ${chalk.bold(pkgManager.label)}.`,
    );

    analytics.wizardCapture('package installed', {
      'package name': packageName,
      'package manager': pkgManager.name,
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
    analytics.setSessionProperty('package manager', selected.name);
    return selected;
  }

  // No package manager detected — default to npm
  analytics.setSessionProperty('package manager', npm.name);
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
 * Best-effort credentials for `--ci` when `--api-key` / AMPLITUDE_WIZARD_API_KEY
 * is not set: locally stored key (.env.local / per-user cache), then OAuth id token from
 * ~/.ampli.json plus org/project from ampli.json (same resolution as interactive bootstrap).
 */
export async function tryResolveCredentialsForCi(installDir: string): Promise<{
  host: string;
  projectApiKey: string;
  accessToken: string;
  cloudRegion: CloudRegion;
} | null> {
  const { readApiKeyWithSource } = await import('./api-key-store.js');
  const local = readApiKeyWithSource(installDir);
  if (local) {
    return {
      host: DEFAULT_HOST_URL,
      projectApiKey: local.key,
      accessToken: local.key,
      cloudRegion: 'us',
    };
  }

  const { getStoredUser, getStoredToken } = await import('./ampli-settings.js');
  const { readAmpliConfig } = await import('../lib/ampli-config.js');
  const { getAPIKey } = await import('./get-api-key.js');
  const { getHostFromRegion } = await import('./urls.js');

  const storedUser = getStoredUser();
  const realUser =
    storedUser && storedUser.id !== 'pending' ? storedUser : null;
  const projectConfig = readAmpliConfig(installDir);
  const projectZone = projectConfig.ok ? projectConfig.config.Zone : undefined;
  const zone = realUser?.zone ?? projectZone ?? DEFAULT_AMPLITUDE_ZONE;

  const storedToken = realUser
    ? getStoredToken(realUser.id, realUser.zone)
    : getStoredToken(undefined, zone);

  if (!storedToken?.idToken) {
    return null;
  }

  const projectId = projectConfig.ok
    ? projectConfig.config.ProjectId
    : undefined;

  const projectApiKey = await getAPIKey({
    installDir,
    idToken: storedToken.idToken,
    zone,
    projectId,
  });

  if (!projectApiKey) {
    return null;
  }

  const cloudRegion: CloudRegion = zone === 'eu' ? 'eu' : 'us';

  return {
    host: getHostFromRegion(cloudRegion),
    projectApiKey,
    accessToken: storedToken.accessToken,
    cloudRegion,
  };
}

/**
 * Get project data for the wizard via Amplitude OAuth or CI API key.
 *
 * Pass installDir to enable fresh-auth detection: when no local ampli.json
 * exists, the cached ~/.ampli.json token is bypassed so the user explicitly
 * authenticates and picks the right Amplitude account for this project.
 */
export async function getOrAskForProjectData(
  _options: Pick<WizardOptions, 'signup' | 'ci' | 'apiKey' | 'appId'> & {
    installDir?: string;
  },
): Promise<{
  host: string;
  projectApiKey: string;
  accessToken: string;
  /** Branded `AppId` once known; `0` when the env hasn't been picked yet. */
  appId: AppId | 0;
  cloudRegion: CloudRegion;
}> {
  // If an API key is provided (via --api-key flag, any mode), bypass OAuth entirely.
  if (_options.apiKey) {
    if (_options.ci) {
      getUI().log.info('Using provided API key (CI mode - OAuth bypassed)');
    }
    return {
      host: DEFAULT_HOST_URL,
      projectApiKey: _options.apiKey,
      accessToken: _options.apiKey,
      appId: toCredentialAppId(_options.appId),
      cloudRegion: 'us',
    };
  }

  if (_options.ci) {
    const ciInstallDir = _options.installDir;
    if (!ciInstallDir) {
      getUI().log.error(
        chalk.red(
          'CI mode requires --install-dir (or AMPLITUDE_WIZARD_INSTALL_DIR).',
        ),
      );
      await wizardAbort({
        message: 'CI mode requires an install directory.',
      });
    } else {
      const resolved = await tryResolveCredentialsForCi(ciInstallDir);
      if (resolved) {
        getUI().log.info(
          chalk.dim('Resolved Amplitude API key non-interactively (CI mode).'),
        );
        return {
          host: resolved.host,
          projectApiKey: resolved.projectApiKey,
          accessToken: resolved.accessToken,
          appId: toCredentialAppId(_options.appId),
          cloudRegion: resolved.cloudRegion,
        };
      }

      getUI().log.error(
        chalk.red(
          'CI mode could not resolve a project API key. Pass --api-key or AMPLITUDE_WIZARD_API_KEY, store a key in the project (.env.local) or run the wizard interactively once to populate the per-user cache, or ensure ~/.ampli.json has a valid OAuth session (and ampli.json includes ProjectId if needed).',
        ),
      );
      await wizardAbort({
        message:
          'CI mode requires a project API key or resolvable Amplitude credentials.',
      });
    }
  }

  // Force fresh OAuth for projects that haven't been set up yet — no local
  // ampli.json means we don't know which Amplitude org this project belongs to.
  let forceFresh = false;
  if (_options.installDir) {
    const { ampliConfigExists } = await import('../lib/ampli-config.js');
    forceFresh = !ampliConfigExists(_options.installDir);
    if (forceFresh) {
      getUI().log.info(
        chalk.dim(
          'No ampli.json found — starting fresh Amplitude authentication for this project.',
        ),
      );
    }
  }

  const result = await traceStep('login', () =>
    askForWizardLogin({ forceFresh, installDir: _options.installDir }),
  );

  return {
    accessToken: result.accessToken,
    host: DEFAULT_HOST_URL,
    projectApiKey: result.projectApiKey,
    appId: result.appId,
    cloudRegion: result.cloudRegion,
  };
}

async function askForWizardLogin(
  opts: {
    forceFresh?: boolean;
    installDir?: string;
  } = {},
): Promise<ProjectData> {
  // ── 1. Authenticate via Amplitude OAuth (reuses ampli CLI session) ──
  const auth = await performAmplitudeAuth({
    zone: DEFAULT_AMPLITUDE_ZONE,
    forceFresh: opts.forceFresh,
  });

  // ── 2. Detect actual cloud region (EU users auth via US endpoint but
  //       their data lives on EU servers — detectRegionFromToken probes both) ──
  let cloudRegion: CloudRegion = 'us';
  try {
    cloudRegion = await detectRegionFromToken(auth.accessToken);
  } catch {
    // Fall back to 'us' if region detection fails
  }

  // ── 3. Fetch user info from Amplitude Data API ────────────────────
  let userInfo: Awaited<ReturnType<typeof fetchAmplitudeUser>> | undefined;
  try {
    userInfo = await fetchAmplitudeUser(
      auth.idToken,
      cloudRegion as typeof auth.zone,
    );
  } catch {
    // Could not fetch user info — warn and continue without it
    getUI().log.warn(
      chalk.yellow(
        'Could not fetch user info from Amplitude. Continuing without it.',
      ),
    );
  }

  let selectedOrg: AmplitudeOrg | undefined;

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
        // Stored `expiresAt` tracks id_token TTL (binding constraint
        // for API calls) — see `src/utils/jwt-exp.ts`.
        expiresAt: new Date(
          resolveStoredExpiryMs({ idToken: auth.idToken }),
        ).toISOString(),
      },
    );

    // ── 4. Org resolution (flowchart: sign-in → determine destination org) ──
    if (userInfo.orgs.length === 0) {
      // New user who hasn't created an org yet — direct them to the browser
      getUI().log.error(
        `${chalk.red('No Amplitude organization found.')}\n\n` +
          chalk.dim(
            'Your account has no organizations. Please complete signup at ' +
              chalk.cyan('https://app.amplitude.com') +
              ' and create an organization, then re-run the wizard.',
          ),
      );
      await abort();
    } else if (userInfo.orgs.length === 1) {
      selectedOrg = userInfo.orgs[0];
    } else {
      // Multiple orgs — prompt the user to pick one
      const { select } = await import('@inquirer/prompts');
      selectedOrg = await select<AmplitudeOrg>({
        message: 'Select an Amplitude organization:',
        choices: userInfo.orgs.map((org) => ({ name: org.name, value: org })),
      });
    }

    getUI().log.success(
      `Logged in as ${chalk.bold(userInfo.email)}${
        selectedOrg ? ` (${selectedOrg.name})` : ''
      }`,
    );
    analytics.setDistinctId(userInfo.email);
    analytics.identifyUser({
      email: userInfo.email,
      org_id: selectedOrg?.id,
      org_name: selectedOrg?.name,
    });
    analytics.wizardCapture('wizard link opened');
  }

  // ── 4b. Project selection ─────────────────────────────────────────
  type Project = AmplitudeOrg['projects'][number];
  let selectedProject: Project | undefined;
  if (selectedOrg) {
    if (selectedOrg.projects.length === 1) {
      selectedProject = selectedOrg.projects[0];
    } else if (selectedOrg.projects.length > 1) {
      const { select } = await import('@inquirer/prompts');
      selectedProject = await select<Project>({
        message: `Select a project in ${selectedOrg.name}:`,
        choices: selectedOrg.projects.map((project) => ({
          name: project.name,
          value: project,
        })),
      });
    }

    // Write ~/.ampli.json so future runs recognise this project
    if (opts.installDir && selectedProject) {
      const { writeAmpliConfig } = await import('../lib/ampli-config.js');
      writeAmpliConfig(opts.installDir, {
        OrgId: selectedOrg.id,
        ProjectId: selectedProject.id,
        Zone: cloudRegion as import('../lib/constants.js').AmplitudeZone,
      });
    }
  }

  // ── 5. Get the Amplitude project API key ─────────────────────────
  // The Data API returns apiKey on the Environment → App type, so we
  // can grab it directly from the project data we already fetched.
  // Falls back to manual prompt if not found.
  let projectApiKey: string | undefined;
  let selectedAppId: string | null = null;

  if (selectedProject) {
    // Get environments that have an app with an API key, sorted by rank (lowest = primary)
    const envsWithKey = (selectedProject.environments ?? [])
      .filter((env) => env.app?.apiKey)
      .sort((a, b) => a.rank - b.rank);

    if (envsWithKey.length === 1) {
      projectApiKey = envsWithKey[0].app!.apiKey!;
      selectedAppId = envsWithKey[0].app?.id ?? null;
      getUI().log.success(
        chalk.dim(
          `Retrieved API key for ${chalk.bold(
            envsWithKey[0].name,
          )} environment`,
        ),
      );
    } else if (envsWithKey.length > 1) {
      const { select } = await import('@inquirer/prompts');
      const selectedEnv = await select({
        message: 'Select an environment:',
        choices: envsWithKey.map((env) => ({
          name: `${env.name} (${env.app!.id})`,
          value: env,
        })),
      });

      projectApiKey = selectedEnv.app!.apiKey!;
      selectedAppId = selectedEnv.app?.id ?? null;
      getUI().log.success(
        chalk.dim(
          `Retrieved API key for ${chalk.bold(selectedEnv.name)} environment`,
        ),
      );
    }

    // Persist so future runs don't need to fetch again
    if (projectApiKey && opts.installDir) {
      const { persistApiKey } = await import('./api-key-store.js');
      const source = persistApiKey(projectApiKey, opts.installDir);
      getUI().log.success(
        chalk.dim(
          source === 'cache'
            ? 'API key saved'
            : 'API key saved to .env.local (added to .gitignore)',
        ),
      );
    }
  }

  // Fall back to manual prompt if auto-fetch didn't work
  if (!projectApiKey) {
    projectApiKey = await askForAmplitudeApiKey(opts.installDir);
  }

  return {
    accessToken: auth.accessToken,
    projectApiKey,
    host: DEFAULT_HOST_URL,
    distinctId: userInfo?.id ?? 'unknown',
    appId: toCredentialAppId(selectedAppId),
    cloudRegion,
  };
}

async function askForAmplitudeApiKey(installDir?: string): Promise<string> {
  const { readApiKeyWithSource, persistApiKey } = await import(
    './api-key-store.js'
  );

  // Return saved key if available
  if (installDir) {
    const result = readApiKeyWithSource(installDir);
    if (result) {
      getUI().log.success(
        chalk.dim(
          result.source === 'cache'
            ? 'Using saved Amplitude API key'
            : 'Using saved Amplitude API key from .env.local',
        ),
      );
      return result.key;
    }
  }

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

  const trimmed = apiKey.trim();

  // Persist so the user doesn't have to enter it again
  if (installDir) {
    const source = persistApiKey(trimmed, installDir);
    getUI().log.success(
      chalk.dim(
        source === 'cache'
          ? 'API key saved'
          : 'API key saved to .env.local (added to .gitignore)',
      ),
    );
  }

  return trimmed;
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
