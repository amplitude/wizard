/**
 * Focused integration test for `--agent` NDJSON mode.
 *
 * Validates the agent-mode machinery (envelope shape, correlation IDs,
 * credential redaction, framework detection emission) WITHOUT running a
 * full framework setup. Uses `--api-key` to skip OAuth, spawns the wizard
 * in an ephemeral temp dir, waits for early-boot NDJSON events, then kills
 * the process before the agent does any real work. Does NOT rely on LLM
 * fixtures — only the first ~1s of wizard lifecycle is observed.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { startWizardInstance } from '../utils';
import type { WizardTestEnv } from '../utils';
import type { NDJSONEvent } from '../../src/ui/agent-ui';

const REDACTION_SENTINEL = 'REDACTION_TEST_KEY_SENTINEL_abc123';
const BOOT_TIMEOUT = 10_000;
const DETECTION_TIMEOUT = 15_000;

const mkTempDir = (suffix: string): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), `amp-wizard-agent-${suffix}-`));

const isIntro = (e: NDJSONEvent): boolean =>
  e.type === 'lifecycle' &&
  (e.data as { event?: string } | undefined)?.event === 'intro';

/**
 * Assert the NDJSON envelope required by the `--agent` contract:
 * v:1, @timestamp, type, message, session_id, run_id all present.
 */
function assertValidEnvelope(event: NDJSONEvent): void {
  expect(event.v).toBe(1);
  expect(typeof event['@timestamp']).toBe('string');
  expect(Number.isNaN(new Date(event['@timestamp']).getTime())).toBe(false);
  expect(typeof event.type).toBe('string');
  expect(event.type.length).toBeGreaterThan(0);
  expect(typeof event.message).toBe('string');
  expect(event.session_id?.length ?? 0).toBeGreaterThan(0);
  expect(event.run_id?.length ?? 0).toBeGreaterThan(0);
}

describe('agent mode (NDJSON)', () => {
  const spawned: WizardTestEnv[] = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    while (spawned.length > 0) {
      try {
        spawned.pop()?.kill();
      } catch {
        /* already dead */
      }
    }
  });

  afterAll(() => {
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (!d) continue;
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  function spawnAgent(
    projectDir: string,
    opts: { apiKey?: string } = {},
  ): WizardTestEnv {
    const w = startWizardInstance(projectDir, {
      agentMode: true,
      apiKey: opts.apiKey,
      extraArgs: ['--install-dir', projectDir],
      debug: !!process.env.E2E_AGENT_DEBUG,
    });
    spawned.push(w);
    return w;
  }

  test(
    'boot emits intro lifecycle with valid envelope + correlation ids',
    async () => {
      const dir = mkTempDir('boot');
      tempDirs.push(dir);
      const wiz = spawnAgent(dir);

      const intro = await wiz.waitForNDJSONEvent(isIntro, {
        timeout: BOOT_TIMEOUT,
      });
      assertValidEnvelope(intro);

      // Every event collected must also be well-formed
      for (const e of wiz.ndjsonEvents) {
        assertValidEnvelope(e);
      }

      // session_id is anonymousId — stable across the CLI invocation
      const sessionIds = new Set(wiz.ndjsonEvents.map((e) => e.session_id));
      expect(sessionIds.size).toBe(1);
    },
    BOOT_TIMEOUT + 5_000,
  );

  test(
    'emits session_state detectedFramework for a Next.js project',
    async () => {
      const dir = mkTempDir('next');
      tempDirs.push(dir);

      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({
          name: 'agent-mode-next-fixture',
          version: '0.0.1',
          // 15.3.0+ satisfies the wizard's min-version gate so detection
          // reaches setDetectedFramework (older emits an early cancel).
          dependencies: {
            next: '^15.3.0',
            react: '^18.0.0',
            'react-dom': '^18.0.0',
          },
        }),
      );

      const wiz = spawnAgent(dir);
      const detected = await wiz.waitForNDJSONEvent(
        (e) => {
          if (e.type !== 'session_state') return false;
          const d = e.data as { field?: string; value?: string } | undefined;
          return (
            d?.field === 'detectedFramework' &&
            typeof d.value === 'string' &&
            d.value.toLowerCase().includes('next')
          );
        },
        { timeout: DETECTION_TIMEOUT },
      );
      assertValidEnvelope(detected);
    },
    DETECTION_TIMEOUT + 5_000,
  );

  test(
    'never leaks --api-key value or emits raw credentials in stream',
    async () => {
      const dir = mkTempDir('redact');
      tempDirs.push(dir);
      const wiz = spawnAgent(dir, { apiKey: REDACTION_SENTINEL });

      await wiz.waitForNDJSONEvent(isIntro, { timeout: BOOT_TIMEOUT });
      // Grace period for post-intro events (startRun, setCredentials, etc.)
      await new Promise((r) => setTimeout(r, 1_500));
      wiz.kill();

      // Sentinel must NOT appear anywhere — JSON bodies or stray lines
      const allLines = [
        ...wiz.ndjsonEvents.map((e) => JSON.stringify(e)),
        ...wiz.ndjsonNonJsonLines,
      ];
      for (const line of allLines) {
        expect(line).not.toContain(REDACTION_SENTINEL);
      }

      // Any credentials session_state event must be sanitized
      const credEvents = wiz.ndjsonEvents.filter(
        (e) =>
          e.type === 'session_state' &&
          (e.data as { field?: string } | undefined)?.field === 'credentials',
      );
      for (const evt of credEvents) {
        const d = evt.data as Record<string, unknown>;
        expect(d).not.toHaveProperty('accessToken');
        expect(d).not.toHaveProperty('projectApiKey');
      }
    },
    BOOT_TIMEOUT + 10_000,
  );

  test(
    'prompt events carry autoResult so the stream never blocks on stdin',
    async () => {
      const dir = mkTempDir('prompt');
      tempDirs.push(dir);
      const wiz = spawnAgent(dir);

      await wiz.waitForNDJSONEvent(isIntro, { timeout: BOOT_TIMEOUT });
      await new Promise((r) => setTimeout(r, 2_000));
      wiz.kill();

      const prompts = wiz.ndjsonEvents.filter((e) => e.type === 'prompt');
      if (prompts.length === 0) {
        // Prompts fire deep in the agent flow, after detection + env setup.
        // In this narrow early-boot window we may see zero — fall back to
        // `AgentUI` unit tests (`src/ui/__tests__/agent-ui.test.ts`) for
        // the autoResult contract.

        console.warn(
          '[agent-mode] no prompt in early-boot window — unit tests cover autoResult contract',
        );
        return;
      }
      for (const evt of prompts) {
        assertValidEnvelope(evt);
        const d = evt.data as
          | { promptType?: string; autoResult?: unknown }
          | undefined;
        expect(d?.promptType).toBeDefined();
        expect(d?.autoResult).toBeDefined();
      }
    },
    BOOT_TIMEOUT + 10_000,
  );
});
