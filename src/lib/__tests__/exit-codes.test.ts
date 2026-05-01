/**
 * exit-codes — contract tests.
 *
 * The exit-code surface is part of the wizard's public API for
 * orchestrators (Claude Code, Cursor, CI pipelines, custom scripts).
 * These tests pin every code's numeric value and ensure the codes are
 * mutually exclusive — orchestrators that branch on the integer must
 * never see a collision when a new code is added.
 */

import { describe, it, expect } from 'vitest';
import { ExitCode } from '../exit-codes';

describe('ExitCode contract', () => {
  it('pins canonical exit codes — orchestrators script against these numbers', () => {
    expect(ExitCode.SUCCESS).toBe(0);
    expect(ExitCode.GENERAL_ERROR).toBe(1);
    expect(ExitCode.INVALID_ARGS).toBe(2);
    expect(ExitCode.AUTH_REQUIRED).toBe(3);
    expect(ExitCode.NETWORK_ERROR).toBe(4);
    expect(ExitCode.AGENT_FAILED).toBe(10);
    expect(ExitCode.PROJECT_NAME_TAKEN).toBe(11);
    expect(ExitCode.INPUT_REQUIRED).toBe(12);
    expect(ExitCode.WRITE_REFUSED).toBe(13);
    expect(ExitCode.INTERNAL_ERROR).toBe(20);
    expect(ExitCode.USER_CANCELLED).toBe(130);
  });

  it('every exit code is unique — no two semantic conditions share a number', () => {
    const codes = Object.values(ExitCode) as number[];
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it('INTERNAL_ERROR is distinct from AGENT_FAILED — wizard bugs vs legitimate agent failures', () => {
    // The whole point of adding INTERNAL_ERROR was so orchestrators can
    // tell "the wizard itself crashed" from "the agent run failed for
    // a real reason" (model overload, tool denial, network blip, etc.).
    // If these codes ever collapse to the same number, the distinction
    // disappears and orchestrators can't route bug reports correctly.
    expect(ExitCode.INTERNAL_ERROR).not.toBe(ExitCode.AGENT_FAILED);
    expect(ExitCode.INTERNAL_ERROR).not.toBe(ExitCode.GENERAL_ERROR);
  });
});
