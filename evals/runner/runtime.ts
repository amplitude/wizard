/**
 * Layer 4 — runtime probe.
 *
 * Boots the post-wizard working tree in a headless browser, navigates
 * to a known route, and captures:
 *   - the top-level navigation status code
 *   - any uncaught console errors
 *   - outbound requests to the Amplitude ingestion endpoint family
 *
 * The probe **intercepts** Amplitude requests rather than forwarding
 * them — Layer 5 (ingestion verification, blocked on the eval-only
 * project per open decision #2) is the layer that grades real
 * end-to-end ingestion. Layer 4 only proves "the integration boots and
 * the SDK fired at least one request."
 *
 * Playwright is loaded via dynamic import so the eval framework
 * compiles and tests cleanly without it. Callers that don't pass
 * `runtime` get no Layer 4 coverage (skip-pass with weight 0); callers
 * that do but haven't installed playwright get a clear "playwright not
 * installed" detail on the result.
 *
 * Why dynamic import: playwright weighs ~150MB unpacked plus browser
 * binaries. Forcing every developer + CI runner to install it before
 * the eval suite can compile would be a regression. Nightly runners
 * opt in by adding `playwright` to their installer step.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import type { RuntimeResult, Scenario } from './types.js';

/**
 * Hosts the Amplitude ingestion endpoint family lives on. Used to
 * decide whether an outbound request is "the SDK fired" vs. just the
 * page's normal traffic.
 */
const AMPLITUDE_HOST_PATTERN =
  /^https?:\/\/(api2|api|api\.eu|api3)\.amplitude\.com\//i;

const AMPLITUDE_REQUEST_CAP = 5;
const DEFAULT_BOOT_TIMEOUT_MS = 60_000;
const NAV_TIMEOUT_MS = 10_000;

/**
 * Wait for `http://localhost:<port>/` to respond before navigating.
 * Polls every 250ms up to `bootTimeoutMs`.
 */
async function waitForServer(
  port: number,
  bootTimeoutMs: number,
): Promise<{ ok: boolean; reason?: string }> {
  const deadline = Date.now() + bootTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/`, {
        signal: AbortSignal.timeout(2_000),
      });
      // Any HTTP response — even 404 or a Vite-generated index — means
      // the server is listening. The probe distinguishes "couldn't
      // connect" from "server returned 5xx" downstream.
      if (res.status > 0) return { ok: true };
    } catch {
      // ECONNREFUSED, abort, or other transient failure — retry until
      // the deadline.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return {
    ok: false,
    reason: `dev server did not respond on port ${port} within ${bootTimeoutMs}ms`,
  };
}

interface ConsoleMsg {
  type: () => string;
  text: () => string;
}

interface PlaywrightRequest {
  url: () => string;
}

interface PlaywrightRoute {
  fulfill: (v: { status?: number; body?: string }) => Promise<void>;
}

interface PlaywrightResponse {
  status: () => number;
}

interface PlaywrightPage {
  on: (
    event: 'console' | 'pageerror' | 'request',
    handler: (arg: ConsoleMsg | Error | PlaywrightRequest) => void,
  ) => void;
  route: (
    pattern: RegExp,
    handler: (route: PlaywrightRoute) => Promise<void> | void,
  ) => Promise<void>;
  goto: (
    url: string,
    opts?: { timeout?: number; waitUntil?: string },
  ) => Promise<PlaywrightResponse | null>;
}

interface PlaywrightBrowser {
  newPage: () => Promise<PlaywrightPage>;
  close: () => Promise<void>;
}

interface DynamicPlaywright {
  chromium: {
    launch: (opts?: { headless?: boolean }) => Promise<PlaywrightBrowser>;
  };
}

/**
 * Try to dynamic-import `playwright`. Returns null if not installed —
 * the caller falls back to a skip-pass with a clear detail.
 */
async function loadPlaywright(): Promise<DynamicPlaywright | null> {
  try {
    return (await import(
      /* @vite-ignore */ 'playwright'
    )) as unknown as DynamicPlaywright;
  } catch {
    return null;
  }
}

export interface RunRuntimeProbeOptions {
  scenario: Scenario;
  /** Absolute path to the post-wizard working tree. */
  workingDir: string;
}

/**
 * Run the Layer 4 runtime probe against `workingDir`. Returns a
 * {@link RuntimeResult} regardless of outcome — the scorer interprets
 * the `ok` flag and the count fields to decide pass/fail.
 *
 * Behavior:
 *   - No `runtimeProbe` on the scenario → returns a sentinel result
 *     with `ok: false` and detail `skipped: scenario opted out`.
 *   - playwright not installed → `ok: false`, detail names the missing
 *     package.
 *   - dev server fails to boot within timeout → `ok: false`, detail
 *     names the port + timeout.
 *   - Successful navigation → `ok: true`, counts populated.
 */
export async function runRuntimeProbe(
  options: RunRuntimeProbeOptions,
): Promise<RuntimeResult> {
  const start = Date.now();
  const { scenario, workingDir } = options;
  const probe = scenario.runtimeProbe;
  if (!probe) {
    return {
      url: '',
      pageStatusCode: 0,
      consoleErrors: [],
      amplitudeRequestCount: 0,
      amplitudeRequestPaths: [],
      ok: false,
      detail: 'skipped: scenario does not declare runtimeProbe',
      durationMs: Date.now() - start,
    };
  }

  const playwright = await loadPlaywright();
  if (!playwright) {
    return {
      url: '',
      pageStatusCode: 0,
      consoleErrors: [],
      amplitudeRequestCount: 0,
      amplitudeRequestPaths: [],
      ok: false,
      detail:
        'skipped: playwright not installed (pnpm add -D playwright; pnpm exec playwright install chromium)',
      durationMs: Date.now() - start,
    };
  }

  const [cmd, ...args] = probe.devCommand;
  let server: ChildProcess | null = null;
  const consoleErrors: string[] = [];
  const amplitudePaths: string[] = [];
  let amplitudeCount = 0;
  let pageStatusCode = 0;
  let detail: string | undefined;
  let ok = false;
  const url = `http://localhost:${probe.port}${
    probe.route.startsWith('/') ? probe.route : '/' + probe.route
  }`;

  try {
    server = spawn(cmd, args, {
      cwd: workingDir,
      env: { ...process.env, BROWSER: 'none', CI: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    server.on('error', (err) => {
      detail = `failed to spawn dev server: ${err.message}`;
    });

    const wait = await waitForServer(
      probe.port,
      probe.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS,
    );
    if (!wait.ok) {
      detail = wait.reason;
      return {
        url,
        pageStatusCode: 0,
        consoleErrors,
        amplitudeRequestCount: 0,
        amplitudeRequestPaths: [],
        ok: false,
        detail,
        durationMs: Date.now() - start,
      };
    }

    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      page.on('console', (msg) => {
        const m = msg as ConsoleMsg;
        if (m.type() === 'error') consoleErrors.push(m.text());
      });
      page.on('pageerror', (err) => {
        consoleErrors.push((err as Error).message);
      });
      page.on('request', (req) => {
        const reqUrl = (req as PlaywrightRequest).url();
        if (AMPLITUDE_HOST_PATTERN.test(reqUrl)) {
          amplitudeCount += 1;
          if (amplitudePaths.length < AMPLITUDE_REQUEST_CAP) {
            amplitudePaths.push(reqUrl);
          }
        }
      });
      // Intercept Amplitude requests so the probe never forwards real
      // events at the live Amplitude ingestion. Layer 5 is the only
      // path that's allowed to hit the real endpoint.
      await page.route(AMPLITUDE_HOST_PATTERN, (route) =>
        route.fulfill({ status: 200, body: '{"code":200}' }),
      );
      const response = await page.goto(url, {
        timeout: NAV_TIMEOUT_MS,
        waitUntil: 'networkidle',
      });
      pageStatusCode = response?.status() ?? 0;
      ok = consoleErrors.length === 0 && pageStatusCode > 0;
    } finally {
      await browser.close();
    }
  } catch (err) {
    detail = `runtime probe threw: ${
      err instanceof Error ? err.message : 'unknown'
    }`;
  } finally {
    if (server && !server.killed) {
      server.kill('SIGTERM');
    }
  }

  return {
    url,
    pageStatusCode,
    consoleErrors,
    amplitudeRequestCount: amplitudeCount,
    amplitudeRequestPaths: amplitudePaths,
    ok,
    detail,
    durationMs: Date.now() - start,
  };
}
