/**
 * Regression coverage for the `wizard apply` lock-held exit path.
 *
 * Apply uses a per-project file lock so only one `wizard apply` runs
 * against an install directory at a time. The handler in
 * `src/commands/apply.ts` was exiting with `ExitCode.INVALID_ARGS=2`
 * on a collision, which orchestrators routinely interpret as "bad
 * flags" and don't retry. The fix moved the collision path to a
 * dedicated `ExitCode.LOCK_HELD=14` and emits a terminal
 * `run_completed: error, reason: 'lock_held'` envelope so an
 * orchestrator can detect lock contention and automatically back off.
 *
 * These tests are tight in scope:
 *
 *   1. The numeric code is 14 (orchestrator contract — bumping this
 *      is a breaking change).
 *   2. `acquireApplyLock` (the function the handler consults) returns
 *      a holder shape compatible with the wire format the handler
 *      ships in the `apply_refused` envelope.
 *
 * Test the actual apply handler end-to-end would require lifting
 * yargs + spawn out of the module entry point — out of scope for
 * this PR. The exit-code constant + the upstream lock primitive are
 * the two pieces the regression cared about.
 */
process.env.AMPLITUDE_WIZARD_SKIP_BOOTSTRAP = '1';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExitCode } from '../../lib/exit-codes';
import { acquireApplyLock } from '../../utils/apply-lock';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('apply lock-held wiring', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), 'wizard-apply-lock-test-'));
  });

  afterEach(() => {
    try {
      rmSync(installDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('LOCK_HELD is a stable exit code of 14 (orchestrator contract)', () => {
    expect(ExitCode.LOCK_HELD).toBe(14);
  });

  it('a second acquireApplyLock against the same install dir surfaces the holder shape that apply.ts ships', () => {
    const first = acquireApplyLock(installDir, 'plan-1');
    expect(first.ok).toBe(true);
    if (!first.ok) return; // type narrow

    const second = acquireApplyLock(installDir, 'plan-2');
    expect(second.ok).toBe(false);
    if (second.ok) {
      first.release();
      throw new Error('expected second acquireApplyLock to fail');
    }

    // The handler in `apply.ts` ships `holder` verbatim in the
    // `apply_refused` envelope. Lock contracts in the holder shape
    // (pid, planId, startedAt) must remain stable so an orchestrator
    // parsing the envelope can render a useful "blocked by pid X"
    // message and back off.
    expect(second.holder).toMatchObject({
      pid: expect.any(Number),
      planId: 'plan-1',
      startedAt: expect.any(String),
    });

    first.release();
  });
});
