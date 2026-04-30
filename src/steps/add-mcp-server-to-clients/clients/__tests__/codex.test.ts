import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { CodexMCPClient } from '../codex';
import { execSync } from 'node:child_process';
// `spawnSync` is now imported from the cross-platform wrapper to fix
// Windows `.cmd` shim resolution; mock the wrapper, not bare child_process.
import { spawnSync } from '../../../../utils/cross-platform-spawn';
import { analytics } from '../../../../utils/analytics';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../../../utils/cross-platform-spawn', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('../../../../utils/analytics', () => ({
  analytics: {
    captureException: vi.fn(),
  },
}));

describe('CodexMCPClient', () => {
  const spawnSyncMock = spawnSync as Mock;
  const execSyncMock = execSync as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isClientSupported', () => {
    it('returns true when codex binary is available', async () => {
      execSyncMock.mockReturnValue(undefined);

      const client = new CodexMCPClient();
      await expect(client.isClientSupported()).resolves.toBe(true);
      expect(execSyncMock).toHaveBeenCalledWith('codex --version', {
        stdio: 'ignore',
      });
    });

    it('returns false when codex binary is missing', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });

      const client = new CodexMCPClient();
      await expect(client.isClientSupported()).resolves.toBe(false);
    });
  });

  describe('isServerInstalled', () => {
    it('returns true when amplitude server exists', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: JSON.stringify([{ name: 'amplitude' }, { name: 'other' }]),
      });

      const client = new CodexMCPClient();
      await expect(client.isServerInstalled()).resolves.toBe(true);
    });

    it('returns false when command fails', async () => {
      spawnSyncMock.mockReturnValue({ status: 1, stdout: '' });

      const client = new CodexMCPClient();
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });
  });

  describe('addServer', () => {
    it('invokes codex mcp add with --url and --bearer-token-env-var', async () => {
      spawnSyncMock.mockReturnValue({ status: 0 });

      const client = new CodexMCPClient();
      const result = await client.addServer('phx_example');

      expect(result).toEqual({ success: true });
      expect(spawnSyncMock).toHaveBeenCalledWith(
        'codex',
        [
          'mcp',
          'add',
          'amplitude',
          '--url',
          'https://mcp.amplitude.com/mcp',
          '--bearer-token-env-var',
          'AMPLITUDE_API_KEY',
        ],
        expect.objectContaining({
          stdio: 'ignore',
          env: expect.objectContaining({
            AMPLITUDE_API_KEY: 'phx_example',
          }),
        }),
      );
    });

    it('omits auth in OAuth mode', async () => {
      spawnSyncMock.mockReturnValue({ status: 0 });

      const client = new CodexMCPClient();
      const result = await client.addServer(undefined);

      expect(result).toEqual({ success: true });
      expect(spawnSyncMock).toHaveBeenCalledWith(
        'codex',
        ['mcp', 'add', 'amplitude', '--url', 'https://mcp.amplitude.com/mcp'],
        expect.objectContaining({ stdio: 'ignore' }),
      );
    });

    it('returns false and captures exception on failure', async () => {
      spawnSyncMock.mockReturnValue({ status: 1 });

      const client = new CodexMCPClient();
      const result = await client.addServer('phx_example');

      expect(result).toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalled();
    });
  });

  describe('removeServer', () => {
    it('invokes codex mcp remove and returns success', async () => {
      spawnSyncMock.mockReturnValue({ status: 0 });

      const client = new CodexMCPClient();
      const result = await client.removeServer();

      expect(result).toEqual({ success: true });
      expect(spawnSyncMock).toHaveBeenCalledWith(
        'codex',
        ['mcp', 'remove', 'amplitude'],
        {
          stdio: 'ignore',
        },
      );
    });

    it('returns false and captures exception on failure', async () => {
      spawnSyncMock.mockReturnValue({ status: 1 });

      const client = new CodexMCPClient();
      const result = await client.removeServer();

      expect(result).toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalled();
    });
  });
});
