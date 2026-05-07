/**
 * Unit tests for `amplitude-wizard ci-bootstrap`.
 *
 * `runCiBootstrap` takes injected deps (`loadSession` / `setSecret` /
 * `confirm`), so we don't need to mock `child_process.spawnSync` or the
 * file system — the CLI handler thinly wires the real implementations
 * around the tested core.
 */

process.env.AMPLITUDE_WIZARD_SKIP_BOOTSTRAP = '1';

import { describe, it, expect, vi } from 'vitest';
import {
  runCiBootstrap,
  type CiBootstrapDeps,
  type CiBootstrapSession,
} from '../ci-bootstrap';
import { ExitCode } from '../../lib/exit-codes';

function makeSession(
  overrides: Partial<CiBootstrapSession> = {},
): CiBootstrapSession {
  return {
    accessToken: 'access-123',
    refreshToken: 'refresh-456',
    expiresAt: '2026-05-07T01:23:45.000Z',
    zone: 'us',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<CiBootstrapDeps> = {}): {
  deps: CiBootstrapDeps;
  setSecret: ReturnType<typeof vi.fn>;
  setVariable: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
} {
  const setSecret = vi.fn();
  const setVariable = vi.fn();
  const info = vi.fn();
  const error = vi.fn();
  const confirm = vi.fn().mockResolvedValue(true);
  return {
    deps: {
      loadSession: () => makeSession(),
      setSecret,
      setVariable,
      confirm,
      info,
      error,
      ...overrides,
    },
    setSecret,
    setVariable,
    info,
    error,
    confirm,
  };
}

describe('runCiBootstrap', () => {
  it('writes three secrets + one variable in the expected order with --yes', async () => {
    const { deps, setSecret, setVariable, confirm } = makeDeps();
    const code = await runCiBootstrap(deps, {
      repo: 'amplitude/wizard',
      yes: true,
    });
    expect(code).toBe(ExitCode.SUCCESS);
    expect(confirm).not.toHaveBeenCalled();
    expect(setSecret.mock.calls).toEqual([
      ['WIZARD_OAUTH_TOKEN', 'access-123', 'amplitude/wizard'],
      ['WIZARD_REFRESH_TOKEN', 'refresh-456', 'amplitude/wizard'],
      ['WIZARD_EXPIRES_AT', '2026-05-07T01:23:45.000Z', 'amplitude/wizard'],
    ]);
    expect(setVariable.mock.calls).toEqual([
      ['WIZARD_ZONE', 'us', 'amplitude/wizard'],
    ]);
  });

  it('prompts for confirmation when --yes is not set', async () => {
    const { deps, setSecret, setVariable, confirm } = makeDeps();
    confirm.mockResolvedValueOnce(true);
    const code = await runCiBootstrap(deps, {
      repo: 'amplitude/wizard',
      yes: false,
    });
    expect(code).toBe(ExitCode.SUCCESS);
    expect(confirm).toHaveBeenCalledOnce();
    expect(setSecret).toHaveBeenCalledTimes(3);
    expect(setVariable).toHaveBeenCalledTimes(1);
  });

  it('aborts cleanly when the user declines the confirmation', async () => {
    const { deps, setSecret, confirm, info } = makeDeps();
    confirm.mockResolvedValueOnce(false);
    const code = await runCiBootstrap(deps, {
      repo: 'amplitude/wizard',
      yes: false,
    });
    expect(code).toBe(ExitCode.SUCCESS);
    expect(setSecret).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.stringMatching(/no secrets were written/i),
    );
  });

  it('exits AUTH_REQUIRED when no session is on disk', async () => {
    const { deps, error } = makeDeps({ loadSession: () => null });
    const code = await runCiBootstrap(deps, {
      repo: 'amplitude/wizard',
      yes: true,
    });
    expect(code).toBe(ExitCode.AUTH_REQUIRED);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/login/));
  });

  it('exits AUTH_REQUIRED when the session has no refresh token', async () => {
    const { deps, error } = makeDeps({
      loadSession: () => makeSession({ refreshToken: '' }),
    });
    const code = await runCiBootstrap(deps, {
      repo: 'amplitude/wizard',
      yes: true,
    });
    expect(code).toBe(ExitCode.AUTH_REQUIRED);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/refresh token/));
  });

  it('returns NETWORK_ERROR when gh secret set fails', async () => {
    const { deps, error } = makeDeps({
      setSecret: vi.fn().mockImplementation(() => {
        throw new Error('gh: command not found');
      }),
    });
    const code = await runCiBootstrap(deps, {
      repo: 'amplitude/wizard',
      yes: true,
    });
    expect(code).toBe(ExitCode.NETWORK_ERROR);
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to write secret.*gh: command not found/),
    );
  });

  it('honours a custom --repo target', async () => {
    const { deps, setSecret, setVariable } = makeDeps();
    await runCiBootstrap(deps, {
      repo: 'kelson/wizard-fork',
      yes: true,
    });
    for (const call of [...setSecret.mock.calls, ...setVariable.mock.calls]) {
      expect(call[2]).toBe('kelson/wizard-fork');
    }
  });

  it('passes through the EU zone value when stored that way', async () => {
    const { deps, setVariable } = makeDeps({
      loadSession: () => makeSession({ zone: 'eu' }),
    });
    await runCiBootstrap(deps, {
      repo: 'amplitude/wizard',
      yes: true,
    });
    const zoneCall = setVariable.mock.calls.find(
      (c: unknown[]) => c[0] === 'WIZARD_ZONE',
    );
    expect(zoneCall?.[1]).toBe('eu');
  });
});
