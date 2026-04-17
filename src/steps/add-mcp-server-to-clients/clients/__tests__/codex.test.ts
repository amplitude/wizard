import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { CodexMCPClient } from '../codex';
import { execSync, spawnSync } from 'node:child_process';
import { analytics } from '../../../../utils/analytics';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn(() => true) };
});

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
    it('returns true when codex binary is at a user path and ~/.codex exists', async () => {
      execSyncMock.mockReturnValue('/opt/homebrew/bin/codex\n');
      const client = new CodexMCPClient();
      await expect(client.isClientSupported()).resolves.toBe(true);
    });

    it('returns false when codex binary is missing', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });

      const client = new CodexMCPClient();
      await expect(client.isClientSupported()).resolves.toBe(false);
    });

    it('returns false when codex is bundled under /Library/Application Support (e.g. Conductor)', async () => {
      // macOS-only guard — on Linux CI runners, process.platform !== 'darwin'
      // so the /Library/Application Support/ check is skipped and detection
      // falls through to the ~/.codex existence check (mocked true).
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
      execSyncMock.mockReturnValue(
        '/Users/u/Library/Application Support/com.conductor.app/bin/codex\n',
      );
      try {
        const client = new CodexMCPClient();
        await expect(client.isClientSupported()).resolves.toBe(false);
      } finally {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          writable: true,
        });
      }
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
