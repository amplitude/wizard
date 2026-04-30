import { type WizardSession, buildSession } from './lib/wizard-session';

import { Integration, DETECTION_TIMEOUT_MS } from './lib/constants';
import { readEnvironment } from './utils/environment';
import { resolveInstallDir } from './utils/install-dir';
import { getUI } from './ui';
import fs from 'node:fs/promises';
import { FRAMEWORK_REGISTRY } from './lib/registry';
import { analytics } from './utils/analytics';
import { runAgentWizard } from './lib/agent-runner';
import { EventEmitter } from 'events';
import chalk from 'chalk';
import { logToFile } from './utils/debug';
import { wizardAbort } from './utils/wizard-abort';
import { NoOrgsError } from './utils/zone-probe';
import { getVersionCheckInfo } from './lib/version-check';
import { initFeatureFlags } from './lib/feature-flags';
import { autoEnableOptInFeatures } from './lib/feature-discovery';

EventEmitter.defaultMaxListeners = 50;

type Args = {
  integration?: Integration;
  debug?: boolean;
  forceInstall?: boolean;
  installDir?: string;
  default?: boolean;
  signup?: boolean;
  signupEmail?: string;
  signupFullName?: string;
  localMcp?: boolean;
  ci?: boolean;
  apiKey?: string;
  appId?: string;
  menu?: boolean;
  benchmark?: boolean;
  region?: 'us' | 'eu';
};

export async function runWizard(
  argv: Args,
  session?: WizardSession,
  getAdditionalFeatureQueue?: () => readonly import('./lib/wizard-session').AdditionalFeature[],
  featureProgress?: {
    onFeatureStart?: (
      feature: import('./lib/wizard-session').AdditionalFeature,
    ) => void;
    onFeatureComplete?: (
      feature: import('./lib/wizard-session').AdditionalFeature,
    ) => void;
  },
) {
  const finalArgs = {
    ...argv,
    ...readEnvironment(),
  };

  // installDir precedence (highest wins):
  //   1. TUI directory picker — already mutated session.installDir via
  //      store.changeInstallDir() before runWizard is called.
  //   2. --install-dir / AMPLITUDE_WIZARD_INSTALL_DIR — flowed into the
  //      session at buildSession() time.
  //   3. process.cwd() — buildSession's default.
  //
  // Trust the session as the single source of truth. Only the fresh-
  // session path needs to resolve from CLI args — and buildSession does
  // that via its zod schema (resolveInstallDir handles `~` expansion).
  // The previous code unconditionally re-assigned session.installDir
  // from finalArgs.installDir, which silently reverted any TUI
  // directory change back to the original CLI value.
  if (!session) {
    session = buildSession({
      debug: finalArgs.debug,
      forceInstall: finalArgs.forceInstall,
      installDir: resolveInstallDir(finalArgs.installDir),
      ci: finalArgs.ci,
      signup: finalArgs.signup,
      signupEmail: finalArgs.signupEmail,
      signupFullName: finalArgs.signupFullName,
      localMcp: finalArgs.localMcp,
      apiKey: finalArgs.apiKey,
      menu: finalArgs.menu,
      integration: finalArgs.integration,
      benchmark: finalArgs.benchmark,
      appId: finalArgs.appId,
      region: finalArgs.region,
    });
  }

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
    signup: session.signup ?? false,
  });

  // Non-interactive modes (CI / agent) auto-enable every discovered
  // opt-in feature here so the agent run gets the same SR + G&S + LLM
  // coverage as an interactive TUI run (bin.ts handles the TUI side via
  // store.autoEnableInlineAddons). Both paths converge on the same set
  // of inline addons — there is no picker in either flow.
  if ((session.ci || session.agent) && !session.optInFeaturesComplete) {
    await initFeatureFlags().catch(() => {
      // Flag init failure is non-fatal — LLM gate just stays off
    });
    autoEnableOptInFeatures(session, session.agent ? 'auto-agent' : 'auto-ci');
  }

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
      await runAgentWizard(
        config,
        session,
        getAdditionalFeatureQueue,
        featureProgress,
      );
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

      // NoOrgsError is a terminal condition — the user's account literally
      // has no organizations on this zone. Re-running the same wizard with
      // the same auth and zone will produce the same result, so offering
      // a "press R to retry" is misleading. Route straight through abort()
      // so registered cleanup, analytics, and Sentry capture all run, and
      // the process exits with the standard contract instead of looping
      // back through setRunError → setRunError → setRunError forever.
      if (error instanceof NoOrgsError) {
        await wizardAbort({
          message: errorMessage,
          error: error as Error,
        });
        return;
      }

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
 * Race a promise against a timeout, returning the resolved value on the
 * win path or the literal `'timeout'` sentinel if the deadline fires first.
 *
 * Unlike a bare `Promise.race([work(), setTimeout(resolve('timeout'), ms)])`,
 * this clears the timer when `work()` wins so the timer callback never fires
 * after detection completes. Across ~18 frameworks racing in parallel that
 * leak adds up to ~18 stranded timers per detection cycle, each holding the
 * resolved closure (and the framework's installDir reference) alive until
 * `timeoutMs` elapses.
 *
 * Rejections from `work()` propagate to the caller — only timeouts surface
 * as the sentinel value, matching the previous behavior.
 */
async function raceWithTimeoutSentinel<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
        const result = await raceWithTimeoutSentinel(work(), timeoutMs);

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
