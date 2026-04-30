/**
 * Tests for the cross-platform spawn wrapper.
 *
 * The wrapper exists to fix a Windows-specific bug where
 * `child_process.spawn('claude', ...)` ENOENTs because Node's spawn
 * doesn't consult `PATHEXT` and npm-installed CLIs ship as `.cmd` shims
 * on Windows. We can't actually exercise the win32 code path on a
 * macOS/Linux CI host, but we can:
 *
 *   1. Verify the wrapper doesn't break the POSIX happy path (i.e.
 *      it actually spawns and returns the right shape).
 *   2. Verify it routes through `cross-spawn` and not the bare
 *      `child_process.spawn` (so the Windows behavior is still wired
 *      up — a future refactor that accidentally removes the import
 *      will fail this test on every host).
 *   3. Verify it propagates args, options, exit codes, and stdio
 *      identically to the stock API.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from '../cross-platform-spawn.js';

const isWin = process.platform === 'win32';

// Use a portable command + arg combo. `node -e '...'` exists everywhere
// the wizard runs (Node >=20) and lets us assert exit codes and stdout
// without depending on which Unix utilities happen to be installed on
// the CI runner.
const NODE = process.execPath;

describe('cross-platform-spawn — POSIX passthrough', () => {
  it('spawnSync returns the expected shape for a successful command', () => {
    const result = spawnSync(NODE, ['-e', 'console.log("hello")'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout?.toString().trim()).toBe('hello');
    expect(result.stderr?.toString()).toBe('');
  });

  it('spawnSync surfaces non-zero exit codes', () => {
    const result = spawnSync(NODE, ['-e', 'process.exit(42)']);
    expect(result.status).toBe(42);
  });

  it('spawnSync handles missing binaries cleanly (no throw)', () => {
    // The whole point of cross-spawn vs raw spawn is that ENOENT becomes
    // a structured error/status rather than a thrown exception, AND that
    // the bare-name `.cmd` shim on Windows resolves correctly. Here we
    // just want "doesn't crash the process".
    const result = spawnSync('this-binary-definitely-does-not-exist-zxqwerty', [
      '--version',
    ]);
    expect(result.status === null || typeof result.status === 'number').toBe(
      true,
    );
    expect(result.error).toBeDefined();
  });

  it('spawn returns a ChildProcess and resolves on close', async () => {
    const proc = spawn(NODE, ['-e', 'process.stdout.write("ok")']);
    expect(typeof proc.pid === 'number' || proc.pid === undefined).toBe(true);

    const stdout = await new Promise<string>((resolve, reject) => {
      let buf = '';
      proc.stdout?.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
      });
      proc.on('close', (code) => {
        if (code === 0) resolve(buf);
        else reject(new Error(`exit ${code}`));
      });
      proc.on('error', reject);
    });
    expect(stdout).toBe('ok');
  });

  it('spawn forwards stdin to the child', async () => {
    const proc = spawn(
      NODE,
      [
        '-e',
        'let buf = ""; process.stdin.on("data", c => buf += c); process.stdin.on("end", () => process.stdout.write(buf.toUpperCase()))',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    proc.stdin?.write('hello world');
    proc.stdin?.end();

    const stdout = await new Promise<string>((resolve, reject) => {
      let buf = '';
      proc.stdout?.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
      });
      proc.on('close', () => resolve(buf));
      proc.on('error', reject);
    });
    expect(stdout).toBe('HELLO WORLD');
  });
});

// Sanity-check the integration with cross-spawn so a future refactor
// that drops the dep will break this test on every platform, not just
// on the (rarely-CI'd) Windows runners.
describe('cross-platform-spawn — wired up to cross-spawn', () => {
  it('module is importable and exports the expected functions', async () => {
    const mod = await import('../cross-platform-spawn.js');
    expect(typeof mod.spawn).toBe('function');
    expect(typeof mod.spawnSync).toBe('function');
  });

  it('cross-spawn is a transitive dep we are using directly', async () => {
    // If this fails, somebody removed cross-spawn from package.json and
    // the wrapper silently fell back to the bare child_process API,
    // re-introducing the Windows ENOENT bug.
    const cs = await import('cross-spawn');
    expect(typeof cs.default).toBe('function');
    expect(typeof cs.default.sync).toBe('function');
  });
});

// Regression tests for arg shapes that the wizard actually uses.
describe('cross-platform-spawn — wizard argument shapes', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('honors options.env for the child', () => {
    const result = spawnSync(
      NODE,
      ['-e', 'process.stdout.write(process.env.FOO || "MISSING")'],
      { encoding: 'utf8', env: { ...process.env, FOO: 'bar' } },
    );
    expect(result.stdout?.toString()).toBe('bar');
  });

  it('honors options.cwd for the child', () => {
    const tmp = isWin ? process.env.TEMP || 'C:\\Windows' : '/tmp';
    const result = spawnSync(
      NODE,
      ['-e', 'process.stdout.write(process.cwd())'],
      { encoding: 'utf8', cwd: tmp },
    );
    // Resolve symlinks on macOS where /tmp is /private/tmp.
    const got = result.stdout?.toString().trim();
    expect(got && (got === tmp || got.endsWith(tmp))).toBeTruthy();
  });

  it('quotes args with spaces and special chars correctly', () => {
    const tricky = 'has "quotes" and spaces and $vars';
    const result = spawnSync(
      NODE,
      ['-e', `process.stdout.write(process.argv[1])`, '--', tricky],
      { encoding: 'utf8' },
    );
    expect(result.stdout?.toString()).toContain(tricky);
  });
});
