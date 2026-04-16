import * as fs from 'fs';
import * as path from 'path';

import { spawn, execSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { dim, green, red } from '../../src/utils/logging';
import type { NDJSONEvent } from '../../src/ui/agent-ui';

export const KEYS = {
  UP: '\u001b[A',
  DOWN: '\u001b[B',
  LEFT: '\u001b[D',
  RIGHT: '\u001b[C',
  ENTER: '\r',
  SPACE: ' ',
};

export const TEST_ARGS = {};

export const log = {
  success: (message: string) => {
    green(`[SUCCESS] ${message}`);
  },
  info: (message: string) => {
    dim(`[INFO] ${message}`);
  },
  error: (message: string) => {
    red(`[ERROR] ${message}`);
  },
};

export class WizardTestEnv {
  taskHandle: ChildProcess;

  /**
   * Every NDJSON event observed on stdout, in order. Populated when the
   * wizard is spawned with `--agent` so callers can assert against the
   * stream after the run terminates.
   */
  ndjsonEvents: NDJSONEvent[] = [];

  /** Raw stdout lines that could not be parsed as NDJSON (kept for debugging). */
  ndjsonNonJsonLines: string[] = [];

  private ndjsonBuffer = '';
  private ndjsonListeners: Array<(event: NDJSONEvent) => void> = [];

  constructor(
    cmd: string,
    args: string[],
    opts?: {
      cwd?: string;
      debug?: boolean;
      env?: NodeJS.ProcessEnv;
    },
  ) {
    this.taskHandle = spawn(cmd, args, {
      cwd: opts?.cwd,
      stdio: 'pipe',
      env: opts?.env ?? process.env,
    });

    if (opts?.debug) {
      this.taskHandle.stdout?.pipe(process.stdout);
      this.taskHandle.stderr?.pipe(process.stderr);
    }

    // Always attach an NDJSON parser. For non-agent runs the buffer just
    // accumulates non-JSON output and we skip it.
    this.taskHandle.stdout?.on('data', (chunk: Buffer | string) => {
      this.ndjsonBuffer += chunk.toString();
      let newlineIdx: number;
      while ((newlineIdx = this.ndjsonBuffer.indexOf('\n')) !== -1) {
        const line = this.ndjsonBuffer.slice(0, newlineIdx).trim();
        this.ndjsonBuffer = this.ndjsonBuffer.slice(newlineIdx + 1);
        if (!line) continue;
        if (line.startsWith('{')) {
          try {
            const event = JSON.parse(line) as NDJSONEvent;
            this.ndjsonEvents.push(event);
            for (const listener of this.ndjsonListeners) {
              listener(event);
            }
            continue;
          } catch {
            // Fall through — log as non-JSON
          }
        }
        this.ndjsonNonJsonLines.push(line);
      }
    });
  }

  sendStdin(input: string | string[]) {
    if (Array.isArray(input)) {
      for (const i of input) {
        this.taskHandle.stdin?.write(i);
      }
    } else {
      this.taskHandle.stdin?.write(input);
    }
  }

  /**
   * Sends the input and waits for the output.
   * @returns a promise that resolves when the output was found
   * @throws an error when the output was not found within the timeout
   */
  sendStdinAndWaitForOutput(
    input: string | string[],
    output: string,
    options?: { timeout?: number; optional?: boolean },
  ) {
    const outputPromise = this.waitForOutput(output, options);

    if (Array.isArray(input)) {
      for (const i of input) {
        this.sendStdin(i);
      }
    } else {
      this.sendStdin(input);
    }
    return outputPromise;
  }

  /**
   * Waits for the task to exit with a given `statusCode`.
   *
   * @returns a promise that resolves to `true` if the run ends with the status
   * code, or it rejects when the `timeout` was reached.
   */
  waitForStatusCode(
    statusCode: number | null,
    options: {
      /** Timeout in ms */
      timeout?: number;
    } = {},
  ) {
    const { timeout } = {
      timeout: 60_000,
      ...options,
    };

    return new Promise<boolean>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(
          new Error(`Timeout waiting for status code: ${String(statusCode)}`),
        );
      }, timeout);

      this.taskHandle.on('exit', (code: number | null) => {
        clearTimeout(timeoutId);
        resolve(code === statusCode);
      });
    });
  }

  /**
   * Waits for the provided output with `.includes()` logic.
   *
   * @returns a promise that resolves to `true` if the output was found, `false` if the output was not found within the
   * timeout and `optional: true` is set, or it rejects when the timeout was reached with `optional: false`
   */
  waitForOutput(
    output: string,
    options: {
      /** Timeout in ms */
      timeout?: number;
      /** Whether to always resolve after the timeout, no matter whether the input was actually found or not. */
      optional?: boolean;
    } = {},
  ) {
    const { timeout, optional } = {
      timeout: 60_000,
      optional: false,
      ...options,
    };

    return new Promise<boolean>((resolve, reject) => {
      let outputBuffer = '';
      const timeoutId = setTimeout(() => {
        if (optional) {
          // The output is not found but it's optional so we can resolve the promise with false
          resolve(false);
        } else {
          reject(new Error(`Timeout waiting for output: ${output}`));
        }
      }, timeout);

      this.taskHandle.stdout?.on('data', (data) => {
        outputBuffer += data;
        if (outputBuffer.includes(output)) {
          clearTimeout(timeoutId);
          // The output is found so we can resolve the promise with true
          resolve(true);
        }
      });
    });
  }

  /**
   * Wait for an NDJSON event matching `predicate`. Resolves to the matching
   * event, or rejects if the timeout elapses without a match.
   *
   * If a matching event has already been observed, resolves synchronously
   * on the next microtask.
   */
  waitForNDJSONEvent(
    predicate: (event: NDJSONEvent) => boolean,
    options: { timeout?: number } = {},
  ): Promise<NDJSONEvent> {
    const { timeout } = { timeout: 60_000, ...options };

    // Fast path: check already-seen events
    const existing = this.ndjsonEvents.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise<NDJSONEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.ndjsonListeners.indexOf(listener);
        if (idx >= 0) this.ndjsonListeners.splice(idx, 1);
        reject(
          new Error(
            `Timeout (${timeout}ms) waiting for NDJSON event. Saw ${this.ndjsonEvents.length} events.`,
          ),
        );
      }, timeout);

      const listener = (event: NDJSONEvent) => {
        if (predicate(event)) {
          clearTimeout(timer);
          const idx = this.ndjsonListeners.indexOf(listener);
          if (idx >= 0) this.ndjsonListeners.splice(idx, 1);
          resolve(event);
        }
      };

      this.ndjsonListeners.push(listener);
    });
  }

  kill() {
    this.taskHandle.stdin?.destroy();
    this.taskHandle.stderr?.destroy();
    this.taskHandle.stdout?.destroy();
    this.taskHandle.kill('SIGINT');
    this.taskHandle.unref();
  }
}

/**
 * Initialize a git repository in the given directory
 * @param projectDir
 */
export function initGit(projectDir: string): void {
  try {
    execSync('git init', { cwd: projectDir });
    // Add all files to the git repo
    execSync('git add -A', { cwd: projectDir });
    // Add author info to avoid git commit error
    execSync('git config user.email test@test.amplitude.com', {
      cwd: projectDir,
    });
    execSync('git config user.name Test', { cwd: projectDir });
    execSync('git commit -m init', { cwd: projectDir });
  } catch (e) {
    log.error('Error initializing git');
    log.error(e);
  }
}

/**
 * Cleanup the git repository in the given directory
 *
 * Caution! Make sure `projectDir` is a test project directory,
 * if in doubt, please commit your local non-test changes first!
 * @param projectDir
 */
export function cleanupGit(projectDir: string): void {
  try {
    // Remove the .git directory
    execSync(`rm -rf ${projectDir}/.git`);
  } catch (e) {
    log.error('Error cleaning up git');
    log.error(e);
  }
}

/**
 * Revert local changes in the given directory
 *
 * Caution! Make sure `projectDir` is a test project directory,
 * if in doubt, please commit your local non-test changes first!
 *
 * @param projectDir
 */
export function revertLocalChanges(projectDir: string): void {
  try {
    // Revert tracked files
    execSync('git checkout .', { cwd: projectDir });
    // Revert untracked files
    execSync('git clean -fd .', { cwd: projectDir });
  } catch (e) {
    log.error('Error reverting local changes');
    log.error(e);
  }
}

export interface StartWizardOptions {
  debug?: boolean;
  /** When true, spawn the wizard in agent mode (`--agent`) with a test API key. */
  agentMode?: boolean;
  /** API key passed via `--api-key`. Only used in agent mode. Defaults to a test key. */
  apiKey?: string;
  /** Extra args to forward to the wizard binary. */
  extraArgs?: string[];
  /** Extra env vars to set on the spawned process. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Start the wizard instance with the given project directory.
 *
 * By default spawns the interactive TUI with `--debug`. Pass `agentMode: true`
 * to run via NDJSON streaming — this also skips re-initializing git so the
 * caller can manage fixtures however they like.
 *
 * @returns WizardTestEnv
 */
export function startWizardInstance(
  projectDir: string,
  debugOrOptions: boolean | StartWizardOptions = false,
): WizardTestEnv {
  const binPath = path.join(__dirname, '../../dist/bin.js');

  const options: StartWizardOptions =
    typeof debugOrOptions === 'boolean'
      ? { debug: debugOrOptions }
      : debugOrOptions;

  revertLocalChanges(projectDir);
  cleanupGit(projectDir);
  initGit(projectDir);

  const args: string[] = options.agentMode
    ? [
        binPath,
        '--agent',
        '--api-key',
        options.apiKey ?? 'test-api-key',
        ...(options.extraArgs ?? []),
      ]
    : [binPath, '--debug', ...(options.extraArgs ?? [])];

  return new WizardTestEnv('node', args, {
    cwd: projectDir,
    debug: options.debug,
    env: options.env,
  });
}

/**
 * Create a file with the given content
 *
 * @param filePath
 * @param content
 */
export function createFile(filePath: string, content?: string) {
  return fs.writeFileSync(filePath, content || '');
}

/**
 * Modify the file with the new content
 *
 * @param filePath
 * @param oldContent
 * @param newContent
 */
export function modifyFile(
  filePath: string,
  replaceMap: Record<string, string>,
) {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  let newFileContent = fileContent;

  for (const [oldContent, newContent] of Object.entries(replaceMap)) {
    newFileContent = newFileContent.replace(oldContent, newContent);
  }

  fs.writeFileSync(filePath, newFileContent);
}

/**
 * Read the file contents and check if it contains the given content
 *
 * @param {string} filePath
 * @param {(string | string[])} content
 */
export function checkFileContents(
  filePath: string,
  content: string | string[],
) {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const contentArray = Array.isArray(content) ? content : [content];

  for (const c of contentArray) {
    expect(fileContent).toContain(c);
  }
}

/**
 * Check if the file exists
 *
 * @param filePath
 */
export function checkFileExists(filePath: string) {
  expect(fs.existsSync(filePath)).toBe(true);
}

/**
 * Check if the package.json contains the given integration
 *
 * @param projectDir
 * @param packageName
 */
export function checkPackageJson(projectDir: string, packageName: string) {
  checkFileContents(`${projectDir}/package.json`, packageName);
}

/**
 * Check if the project builds
 * Check if the project builds and ends with status code 0.
 * @param projectDir
 */
export async function checkIfBuilds(projectDir: string) {
  const testEnv = new WizardTestEnv('npm', ['run', 'build'], {
    cwd: projectDir,
  });

  await expect(
    testEnv.waitForStatusCode(0, {
      timeout: 120_000,
    }),
  ).resolves.toBe(true);
}

/**
 * Check if the project runs on dev mode
 * @param projectDir
 * @param expectedOutput
 */
export async function checkIfRunsOnDevMode(
  projectDir: string,
  expectedOutput: string,
) {
  const testEnv = new WizardTestEnv('npm', ['run', 'dev'], { cwd: projectDir });

  await expect(
    testEnv.waitForOutput(expectedOutput, {
      timeout: 120_000,
    }),
  ).resolves.toBe(true);
  testEnv.kill();
}

/**
 * Check if the project runs on prod mode
 * @param projectDir
 * @param expectedOutput
 */
export async function checkIfRunsOnProdMode(
  projectDir: string,
  expectedOutput: string,
  startCommand = 'start',
) {
  const testEnv = new WizardTestEnv('npm', ['run', startCommand], {
    cwd: projectDir,
  });

  await expect(
    testEnv.waitForOutput(expectedOutput, {
      timeout: 120_000,
    }),
  ).resolves.toBe(true);
  testEnv.kill();
}
