import * as fs from 'fs';
import * as path from 'path';
import { cleanupGit, revertLocalChanges, startWizardInstance } from './utils';
import {
  checkIfBuilds,
  checkIfRunsOnDevMode,
  checkIfRunsOnProdMode,
  checkPackageJson,
} from './utils';
import type { FrameworkTestConfig } from './utils/framework-test-types';
import { DEFAULT_WIZARD_STEPS } from './utils/framework-test-utils';
import { setCurrentFramework } from './mocks/fixture-tracker';
import type { NDJSONEvent } from '../src/ui/agent-ui';

/**
 * Resolve the directory that holds the test application.
 *
 * - If `config.workbenchApp` is set, use `$WIZARD_WORKBENCH_DIR/apps/<workbenchApp>`.
 *   Returns `{ skipReason }` when the env var is missing so the caller can
 *   skip the suite with a helpful message.
 * - Otherwise, use the in-repo `e2e-tests/test-applications/<projectDir>`.
 *
 * Throws if a resolved path doesn't exist on disk.
 */
function resolveProjectDir(config: FrameworkTestConfig): {
  projectDir?: string;
  skipReason?: string;
} {
  if (config.workbenchApp) {
    const workbenchDir = process.env.WIZARD_WORKBENCH_DIR;
    if (!workbenchDir) {
      return {
        skipReason: `${config.name}: set WIZARD_WORKBENCH_DIR to run this suite (wants workbench app "${config.workbenchApp}")`,
      };
    }
    const resolved = path.join(workbenchDir, 'apps', config.workbenchApp);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `${config.name}: workbench app not found at ${resolved}. Set $WIZARD_WORKBENCH_DIR to a valid checkout (currently "${workbenchDir}").`,
      );
    }
    return { projectDir: resolved };
  }

  const resolved = path.resolve(
    __dirname,
    'test-applications',
    config.projectDir,
  );
  return { projectDir: resolved };
}

export function createFrameworkTest(config: FrameworkTestConfig): void {
  const { projectDir, skipReason } = resolveProjectDir(config);

  if (!projectDir || skipReason) {
    describe.skip(config.name, () => {
      test(`skipped: ${skipReason ?? 'no project dir'}`, () => {
        // no-op; suite is skipped
      });
    });
    return;
  }

  // Treat this as a stable, narrowed reference for the closures below.
  const resolvedProjectDir = projectDir;

  describe(config.name, () => {
    // Track NDJSON events when running in agent mode so per-test assertions
    // can read from them after `beforeAll` finishes.
    const collectedEvents: NDJSONEvent[] = [];

    beforeAll(async () => {
      // Scope fixtures per-framework when the test opts in. When unset, the
      // fixture tracker falls back to the legacy flat layout for back-compat
      // with the existing nextjs-app-router / react-vite suites.
      if (config.fixtureFramework) {
        setCurrentFramework(config.fixtureFramework);
      }

      if (config.hooks?.beforeWizard) {
        await config.hooks.beforeWizard();
      }

      if (config.agentMode) {
        await runAgentMode(resolvedProjectDir, config, collectedEvents);
      } else {
        await runTuiMode(resolvedProjectDir, config);
      }

      if (config.hooks?.afterWizard) {
        await config.hooks.afterWizard();
      }
    });

    afterAll(async () => {
      if (config.hooks?.beforeTests) {
        await config.hooks.beforeTests();
      }
      revertLocalChanges(resolvedProjectDir);
      cleanupGit(resolvedProjectDir);
      if (config.hooks?.afterTests) {
        await config.hooks.afterTests();
      }
      if (config.fixtureFramework) {
        setCurrentFramework(null);
      }
    });

    // Standard tests
    if (config.tests?.packageJson && config.tests.packageJson.length > 0) {
      test('package.json is updated correctly', () => {
        const packageJsonTests = config.tests?.packageJson;
        if (packageJsonTests) {
          for (const packageName of packageJsonTests) {
            checkPackageJson(resolvedProjectDir, packageName);
          }
        }
      });
    }

    if (config.tests?.devMode !== false) {
      test('runs on dev mode correctly', async () => {
        await checkIfRunsOnDevMode(
          resolvedProjectDir,
          config.expectedOutput.dev,
        );
      });
    }

    if (config.tests?.build !== false) {
      test('builds correctly', async () => {
        await checkIfBuilds(resolvedProjectDir);
      });
    }

    if (config.tests?.prodMode !== false) {
      const prodCommand =
        typeof config.tests?.prodMode === 'string'
          ? config.tests.prodMode
          : 'start';
      const prodOutput =
        config.expectedOutput.prod || config.expectedOutput.dev;

      test('runs on prod mode correctly', async () => {
        await checkIfRunsOnProdMode(
          resolvedProjectDir,
          prodOutput,
          prodCommand,
        );
      });
    }

    // Custom tests
    if (config.customTests) {
      for (const customTest of config.customTests) {
        const testName = String(customTest.name);
        test(testName, async () => {
          await customTest.fn(resolvedProjectDir);
        });
      }
    }

    // Agent-mode assertions run as regular tests so failures attach to the
    // suite instead of blowing up beforeAll.
    if (config.agentMode && config.agentAssertions) {
      const { expectedFrameworkLabel, expectedEvents } = config.agentAssertions;

      if (expectedFrameworkLabel) {
        test(`detects framework as "${expectedFrameworkLabel}"`, () => {
          const match = collectedEvents.find(
            (e) =>
              e.type === 'session_state' &&
              (e.data as { field?: string; value?: string } | undefined)
                ?.field === 'detectedFramework' &&
              (e.data as { field?: string; value?: string } | undefined)
                ?.value === expectedFrameworkLabel,
          );
          expect(match).toBeDefined();
        });
      }

      if (expectedEvents && expectedEvents.length > 0) {
        expectedEvents.forEach((predicate, idx) => {
          test(`agent assertion #${idx + 1} matches an emitted event`, () => {
            expect(collectedEvents.some(predicate)).toBe(true);
          });
        });
      }
    }
  });
}

/**
 * Drive the wizard through the interactive TUI step sequence. Preserves the
 * original behavior — used when `config.agentMode` is not set.
 */
async function runTuiMode(
  projectDir: string,
  config: FrameworkTestConfig,
): Promise<void> {
  const wizardInstance = startWizardInstance(projectDir, true);

  // Get the wizard steps to execute
  const wizardSteps = config.customWizardSteps || DEFAULT_WIZARD_STEPS;

  // Insert additional steps if specified
  const finalSteps = [...wizardSteps];
  if (config.additionalSteps) {
    for (const addition of config.additionalSteps) {
      if (addition.before) {
        const index = finalSteps.findIndex(
          (step) => step.name === addition.before,
        );
        if (index !== -1) {
          finalSteps.splice(index, 0, ...addition.steps);
        }
      } else if (addition.after) {
        const index = finalSteps.findIndex(
          (step) => step.name === addition.after,
        );
        if (index !== -1) {
          finalSteps.splice(index + 1, 0, ...addition.steps);
        }
      }
    }
  }

  // Execute wizard steps
  for (const step of finalSteps) {
    if (step.condition && !step.condition(wizardInstance)) {
      continue;
    }

    const prompted = await wizardInstance.waitForOutput(step.waitFor, {
      timeout:
        step.timeout || process.env.RECORD_FIXTURES === 'true'
          ? 240 * 1000
          : 10 * 1000,
      optional: step.optional,
    });

    if (prompted && step.response) {
      if (step.responseWaitFor) {
        await wizardInstance.sendStdinAndWaitForOutput(
          step.response,
          step.responseWaitFor,
          {
            timeout:
              step.timeout || process.env.RECORD_FIXTURES === 'true'
                ? 240 * 1000
                : 10 * 1000,
          },
        );
      } else {
        wizardInstance.sendStdin(step.response);
      }
    }
  }

  wizardInstance.kill();
}

/**
 * Spawn the wizard in `--agent` mode, collect NDJSON events, and wait for
 * the run to terminate (outro success, error, or timeout).
 */
async function runAgentMode(
  projectDir: string,
  config: FrameworkTestConfig,
  collectedEvents: NDJSONEvent[],
): Promise<void> {
  const timeoutMs =
    process.env.RECORD_FIXTURES === 'true' ? 240 * 1000 : 60 * 1000;

  const wizardInstance = startWizardInstance(projectDir, {
    agentMode: true,
    debug: !!process.env.E2E_AGENT_DEBUG,
    // Scope fixtures for child processes too, in case the wizard itself hits
    // mocked endpoints.
    env: config.fixtureFramework
      ? { ...process.env, E2E_FIXTURE_FRAMEWORK: config.fixtureFramework }
      : process.env,
  });

  try {
    // Wait for: outro (success) OR error (failure). Either terminates the run.
    const terminal = await wizardInstance.waitForNDJSONEvent(
      (event) => {
        if (event.type === 'error') return true;
        if (
          event.type === 'lifecycle' &&
          (event.data as { event?: string } | undefined)?.event === 'outro'
        ) {
          return true;
        }
        return false;
      },
      { timeout: timeoutMs },
    );

    // Snapshot all events collected so the describe-level closures can run
    // agent assertions after beforeAll resolves. We don't throw on terminal
    // error events — the wizard may fail late (e.g. LLM gateway unreachable
    // in CI without fixtures) but framework detection and other pre-LLM
    // events still fire and should be assertable. Tests that require a
    // successful run can assert on outro via `expectedEvents`.
    collectedEvents.push(...wizardInstance.ndjsonEvents);

    if (terminal.type === 'error') {
      console.warn(
        `[createFrameworkTest] Agent run terminated with error: ${terminal.message}. ` +
          `Pre-error events are still available for assertions.`,
      );
    }
  } finally {
    wizardInstance.kill();
  }
}
