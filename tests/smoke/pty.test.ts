/**
 * PTY smoke tests — spawn the wizard CLI under a real pseudo-terminal so
 * regressions in raw-mode handling, TTY detection, signal forwarding, and
 * stdout flush behavior surface here even if the unit suite passes.
 *
 * Why a separate lane:
 *   - The unit lane (`pnpm test`) runs everything in-process via vitest.
 *     That's fast but hides whole categories of bugs — Ink only enters raw
 *     mode against a real `isTTY` stdin, signals only fire on real OS
 *     processes, and `process.stdout.write` only EPIPE-aborts on a real
 *     closed pipe.
 *   - Keeping the lane small (one or two scenarios) is intentional. PTY
 *     tests are 10-50× slower per case than in-process tests; scaling them
 *     past a smoke layer destroys the development feedback loop. For
 *     deterministic scenario coverage, use `ScriptedAgentDriver`
 *     in-process; for agent-quality coverage, use the eval lane (Phase 4).
 *
 * Skip in unit `pnpm test`. Run via `pnpm test:smoke:pty`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// node-pty is a native module. On hosts without a toolchain (or without a
// prebuild for the host arch — node-pty 1.1.0 ships darwin/windows but not
// linux-x64) it fails to load. We try a dynamic import and gracefully
// `describe.skip` the suite when it's unavailable rather than crashing the
// whole vitest run. CI is responsible for ensuring the toolchain is
// present so this lane actually exercises real PTY behavior there.
let pty: typeof import('node-pty') | null = null;
try {
  pty = (await import('node-pty')) as unknown as typeof import('node-pty');
} catch (err) {
  console.warn(
    'node-pty failed to load — PTY smoke tests will be skipped.',
    (err as Error).message,
  );
}

interface PtyResult {
  output: string;
  exitCode: number;
}

/**
 * Spawn `argv` under a PTY rooted at the wizard repo, capture all output,
 * and resolve when the process exits or the timeout trips. Throws on
 * timeout — silent hangs are exactly what this lane is supposed to catch.
 */
function runUnderPty(
  argv: readonly string[],
  options: { cols?: number; rows?: number; timeoutMs?: number } = {},
): Promise<PtyResult> {
  if (!pty) throw new Error('node-pty unavailable in this environment');
  const { cols = 100, rows = 40, timeoutMs = 30_000 } = options;
  return new Promise<PtyResult>((resolve, reject) => {
    const child = pty!.spawn('node', ['--no-warnings', ...argv], {
      cols,
      rows,
      cwd: REPO_ROOT,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`PTY child timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.onData((data) => {
      output += data;
    });
    child.onExit(({ exitCode }) => {
      clearTimeout(timer);
      resolve({ output, exitCode });
    });
  });
}

const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const WIZARD_ENTRY = path.join(REPO_ROOT, 'bin.ts');

const describeIfPty = pty ? describe : describe.skip;

describeIfPty('wizard CLI under a real PTY', () => {
  let exits: Array<() => void> = [];
  afterEach(() => {
    for (const fn of exits) fn();
    exits = [];
  });

  it('--version prints the wizard version and exits 0', async () => {
    const { output, exitCode } = await runUnderPty([
      TSX_BIN,
      WIZARD_ENTRY,
      '--version',
    ]);
    // Strip ANSI just in case FORCE_COLOR=0 misses something.
    // eslint-disable-next-line no-control-regex
    const stripped = output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
    // Major.minor.patch — match against a reasonable shape rather than
    // pinning the exact version (which churns every release).
    expect(stripped).toMatch(/^\d+\.\d+\.\d+/);
    expect(exitCode).toBe(0);
  }, 60_000);

  it('--help prints the top-level usage banner and exits 0', async () => {
    const { output, exitCode } = await runUnderPty([
      TSX_BIN,
      WIZARD_ENTRY,
      '--help',
    ]);
    expect(output).toContain('Amplitude');
    // yargs help mentions "Commands:" — proves the parser wired up; if
    // bin.ts threw before yargs could register, this would fail.
    expect(output).toContain('Commands:');
    expect(exitCode).toBe(0);
  }, 60_000);
});
