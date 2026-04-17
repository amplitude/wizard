import { type WizardSession, buildSession } from './lib/wizard-session';

import { Integration, DETECTION_TIMEOUT_MS } from './lib/constants';
import { readEnvironment } from './utils/environment';
import { getUI } from './ui';
import path from 'path';
import fs from 'node:fs/promises';
import { FRAMEWORK_REGISTRY } from './lib/registry';
import { analytics } from './utils/analytics';
import { runAgentWizard } from './lib/agent-runner';
import { EventEmitter } from 'events';
import chalk from 'chalk';
import { logToFile } from './utils/debug';
import { wizardAbort } from './utils/wizard-abort';
import { getVersionCheckInfo } from './lib/version-check';

EventEmitter.defaultMaxListeners = 50;

type Args = {
  integration?: Integration;
  debug?: boolean;
  forceInstall?: boolean;
  installDir?: string;
  default?: boolean;
  signup?: boolean;
  localMcp?: boolean;
  ci?: boolean;
  apiKey?: string;
  projectId?: string;
  menu?: boolean;
  benchmark?: boolean;
};

export async function runWizard(argv: Args, session?: WizardSession) {
  const finalArgs = {
    ...argv,
    ...readEnvironment(),
  };

  let resolvedInstallDir: string;
  if (finalArgs.installDir) {
    if (path.isAbsolute(finalArgs.installDir)) {
      resolvedInstallDir = finalArgs.installDir;
    } else {
      resolvedInstallDir = path.join(process.cwd(), finalArgs.installDir);
    }
  } else {
    resolvedInstallDir = process.cwd();
  }

  // Build session if not provided (CI mode passes one pre-built)
  if (!session) {
    session = buildSession({
      debug: finalArgs.debug,
      forceInstall: finalArgs.forceInstall,
      installDir: resolvedInstallDir,
      ci: finalArgs.ci,
      signup: finalArgs.signup,
      localMcp: finalArgs.localMcp,
      apiKey: finalArgs.apiKey,
      menu: finalArgs.menu,
      integration: finalArgs.integration,
      benchmark: finalArgs.benchmark,
      projectId: finalArgs.projectId,
    });
  }

  session.installDir = resolvedInstallDir;

  getUI().intro(`Welcome to the Amplitude setup wizard`);

  if (session.ci) {
    getUI().log.info(chalk.dim('Running in CI mode'));
  }

  const integration =
    session.integration ?? (await detectAndResolveIntegration(session));

  session.integration = integration;
  analytics.setSessionProperty('integration', integration);
  analytics.wizardCapture('session started', {
    integration,
    ci: session.ci ?? false,
  });

  const config = FRAMEWORK_REGISTRY[integration];
  session.frameworkConfig = config;

  // Run gatherContext if the framework has it and it hasn't already run
  // (bin.ts runs it early so IntroScreen can show the friendly label)
  const contextAlreadyGathered =
    Object.keys(session.frameworkContext).length > 0;
  if (config.metadata.gatherContext && !contextAlreadyGathered) {
    try {
      const context = await config.metadata.gatherContext({
        installDir: session.installDir,
        debug: session.debug,
        forceInstall: session.forceInstall,
        default: false,
        signup: session.signup,
        localMcp: session.localMcp,
        ci: session.ci,
        menu: session.menu,
        benchmark: session.benchmark,
      });
      for (const [key, value] of Object.entries(context)) {
        if (!(key in session.frameworkContext)) {
          session.frameworkContext[key] = value;
        }
      }
    } catch {
      // Detection failed — SetupScreen or agent will handle it
    }
  }

  let retry = true;
  while (retry) {
    try {
      await runAgentWizard(config, session);
      retry = false;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack =
        error instanceof Error && error.stack ? error.stack : undefined;

      logToFile(`[Wizard run.ts] ERROR MESSAGE: ${errorMessage} `);
      if (errorStack) {
        logToFile(`[Wizard run.ts] ERROR STACK: ${errorStack}`);
      }

      const debugInfo = session.debug && errorStack ? `\n\n${errorStack}` : '';

      retry = await getUI().setRunError(error as Error);
      if (!retry) {
        await wizardAbort({
          message: `Something went wrong: ${errorMessage}\n\nYou can read the documentation at ${config.metadata.docsUrl} to set up Amplitude manually.${debugInfo}`,
          error: error as Error,
        });
      }
    }
  }
}

/**
 * Result of a single framework's detection attempt.
 */
export interface DetectionResult {
  integration: Integration;
  detected: boolean;
  durationMs: number;
  timedOut: boolean;
  error?: string;
  /** Installed version (if detected and getInstalledVersion is defined). */
  version?: string;
}

/**
 * Run all framework detectors in parallel and return the full results array.
 * The winner is the first detected framework in Integration enum order
 * (preserving the existing priority behavior).
 */
export async function detectAllFrameworks(
  installDir: string,
  timeoutMs: number = DETECTION_TIMEOUT_MS,
): Promise<DetectionResult[]> {
  // Pre-validate installDir — fail fast instead of running 18 detectors
  try {
    await fs.access(installDir, fs.constants.R_OK);
  } catch {
    logToFile(`[detection] installDir is not readable: ${installDir}`);
    return Object.values(Integration).map((integration) => ({
      integration,
      detected: false,
      durationMs: 0,
      timedOut: false,
      error: 'installDir not readable',
    }));
  }

  const integrations = Object.values(Integration);

  const promises = integrations.map(
    async (integration): Promise<DetectionResult> => {
      const config = FRAMEWORK_REGISTRY[integration];
      const start = performance.now();

      // Both detect() and version check run inside a single Promise.race
      // so a slow getInstalledVersion can't hang the entire detection.
      const work = async (): Promise<DetectionResult> => {
        const detected = await config.detection.detect({ installDir });
        const result: DetectionResult = {
          integration,
          detected: Boolean(detected),
          durationMs: Math.round(performance.now() - start),
          timedOut: false,
        };

        // Capture version for diagnostics (agent-runner handles version warnings)
        if (
          result.detected &&
          (config.detection.getInstalledVersion ||
            config.detection.getVersionCheckInfo)
        ) {
          try {
            const versionCheckInfo = await getVersionCheckInfo(
              config.detection,
              {
                installDir,
                debug: false,
                forceInstall: false,
                default: false,
                signup: false,
                localMcp: false,
                ci: false,
                menu: false,
                benchmark: false,
              },
            );
            if (versionCheckInfo.version) {
              result.version = versionCheckInfo.version;
            }
          } catch (err) {
            logToFile(
              `[detection] ${integration} version check failed: ${
                err instanceof Error ? err.message : err
              }`,
            );
          }
        }

        result.durationMs = Math.round(performance.now() - start);
        return result;
      };

      try {
        const result = await Promise.race([
          work(),
          new Promise<'timeout'>((resolve) =>
            setTimeout(() => resolve('timeout'), timeoutMs),
          ),
        ]);

        if (result === 'timeout') {
          const durationMs = Math.round(performance.now() - start);
          logToFile(
            `[detection] ${integration} timed out after ${durationMs}ms`,
          );
          return {
            integration,
            detected: false,
            durationMs,
            timedOut: true,
          };
        }

        return result;
      } catch (err) {
        const durationMs = Math.round(performance.now() - start);
        const errorMsg = err instanceof Error ? err.message : String(err);
        logToFile(
          `[detection] ${integration} failed after ${durationMs}ms: ${errorMsg}`,
        );
        return {
          integration,
          detected: false,
          durationMs,
          timedOut: false,
          error: errorMsg,
        };
      }
    },
  );

  return Promise.all(promises);
}

async function detectAndResolveIntegration(
  session: WizardSession,
): Promise<Integration> {
  if (!session.menu) {
    const results = await detectAllFrameworks(session.installDir);
    session.detectionResults = results;

    const detected = results.filter((r) => r.detected);
    const winner = detected[0];

    // Analytics: capture detection metrics
    analytics.wizardCapture('framework detection complete', {
      winner: winner?.integration ?? 'none',
      'match count': detected.length,
      'duration ms': Math.max(...results.map((r) => r.durationMs)),
      'error count': results.filter((r) => r.error).length,
      'timed out count': results.filter((r) => r.timedOut).length,
    });

    if (winner) {
      getUI().setDetectedFramework(
        FRAMEWORK_REGISTRY[winner.integration].metadata.name,
      );
      return winner.integration;
    }

    // Framework not detected — fall back to generic Amplitude quickstart.
    getUI().log.warn(
      "Couldn't detect your framework. Falling back to the Amplitude quickstart guide.",
    );

    return Integration.generic;
  }

  // Fallback: in TUI mode the IntroScreen would handle this,
  // but for CI mode or when detection fails, abort with guidance.
  return wizardAbort({
    message:
      'Could not auto-detect your framework. Please specify --integration on the command line.',
  });
}
