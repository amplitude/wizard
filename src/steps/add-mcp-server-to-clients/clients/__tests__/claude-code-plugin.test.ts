import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import { ClaudeCodePluginClient } from '../claude-code-plugin';
import { analytics } from '../../../../utils/analytics';
import { _resetClaudeBinaryCache } from '../claude-binary';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

vi.mock('../../../../utils/analytics', () => ({
  analytics: {
    captureException: vi.fn(),
  },
}));

vi.mock('../../../../utils/debug', () => ({
  debug: vi.fn(),
  logToFile: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

const spawnSyncMock = spawnSync as Mock;
const existsSyncMock = fs.existsSync as unknown as Mock;
const readFileSyncMock = fs.readFileSync as unknown as Mock;
const writeFileSyncMock = fs.writeFileSync as unknown as Mock;

// Helper: simulate a successful binary lookup without relying on real PATH.
function mockClaudeBinaryFound() {
  existsSyncMock.mockImplementation((p: string) => p.endsWith('/claude'));
}

describe('ClaudeCodePluginClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetClaudeBinaryCache();
    existsSyncMock.mockReturnValue(false);
    readFileSyncMock.mockReturnValue('');
  });

  describe('addServer', () => {
    it('writes marketplace to settings.json, installs plugin, reports success', async () => {
      mockClaudeBinaryFound();

      // settings.json doesn't exist yet; plugin install succeeds; mcp list shows no stale entry.
      spawnSyncMock
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
        }) // plugin install
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
        }); // mcp list

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result).toEqual({ success: true });

      // marketplace written
      expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
      const writtenContent = writeFileSyncMock.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed.extraKnownMarketplaces.amplitude.source).toEqual({
        source: 'github',
        repo: 'amplitude/mcp-marketplace',
      });

      // plugin install invoked
      expect(spawnSyncMock).toHaveBeenCalledWith(
        expect.stringMatching(/claude$/),
        ['plugin', 'install', 'amplitude@amplitude', '--scope', 'user'],
        expect.objectContaining({ stdio: 'pipe' }),
      );
    });

    it('preserves existing keys when merging into settings.json', async () => {
      mockClaudeBinaryFound();

      // settings.json exists with an unrelated key
      existsSyncMock.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('settings.json')) return true;
        if (typeof p === 'string' && p.endsWith('/claude')) return true;
        return false;
      });
      readFileSyncMock.mockReturnValue(
        JSON.stringify(
          {
            theme: 'dark',
            extraKnownMarketplaces: {
              other: { source: { source: 'github', repo: 'foo/bar' } },
            },
          },
          null,
          2,
        ),
      );

      spawnSyncMock
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
        })
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
        });

      const client = new ClaudeCodePluginClient();
      await client.addServer();

      const writtenContent = writeFileSyncMock.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed.theme).toBe('dark');
      expect(parsed.extraKnownMarketplaces.other.source.repo).toBe('foo/bar');
      expect(parsed.extraKnownMarketplaces.amplitude.source.repo).toBe(
        'amplitude/mcp-marketplace',
      );
    });

    it('treats "already installed" as success', async () => {
      mockClaudeBinaryFound();

      spawnSyncMock
        .mockReturnValueOnce({
          status: 1,
          stdout: Buffer.from(''),
          stderr: Buffer.from('Plugin already installed'),
        })
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
        });

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result).toEqual({ success: true });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('returns failure without fallback when plugin install errors', async () => {
      mockClaudeBinaryFound();

      spawnSyncMock.mockReturnValueOnce({
        status: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('marketplace unavailable'),
      });

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result).toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalled();
      // No second spawnSync call (no `claude mcp add` fallback)
      const pluginCall = spawnSyncMock.mock.calls.find(
        (c) => Array.isArray(c[1]) && c[1][0] === 'plugin',
      );
      const mcpCall = spawnSyncMock.mock.calls.find(
        (c) => Array.isArray(c[1]) && c[1][0] === 'mcp' && c[1][1] === 'add',
      );
      expect(pluginCall).toBeDefined();
      expect(mcpCall).toBeUndefined();
    });

    it('removes stale bare `amplitude` MCP entry after successful plugin install', async () => {
      mockClaudeBinaryFound();

      spawnSyncMock
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
        }) // plugin install
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from('amplitude: https://...\nother: ...\n'),
          stderr: Buffer.from(''),
        }) // mcp list
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
        }); // mcp remove

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result).toEqual({ success: true });
      const mcpRemoveCall = spawnSyncMock.mock.calls.find(
        (c) => Array.isArray(c[1]) && c[1][0] === 'mcp' && c[1][1] === 'remove',
      );
      expect(mcpRemoveCall).toBeDefined();
      expect(mcpRemoveCall?.[1]).toEqual([
        'mcp',
        'remove',
        '--scope',
        'user',
        'amplitude',
      ]);
    });

    it('does not remove `amplitude-local` when checking for stale entries', async () => {
      mockClaudeBinaryFound();

      spawnSyncMock
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
        })
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from('amplitude-local: http://localhost\n'),
          stderr: Buffer.from(''),
        });

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result).toEqual({ success: true });
      const mcpRemoveCall = spawnSyncMock.mock.calls.find(
        (c) => Array.isArray(c[1]) && c[1][0] === 'mcp' && c[1][1] === 'remove',
      );
      expect(mcpRemoveCall).toBeUndefined();
    });

    it('returns failure when claude binary is not found', async () => {
      existsSyncMock.mockReturnValue(false);
      process.env.PATH = '';

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result).toEqual({ success: false });
      expect(spawnSyncMock).not.toHaveBeenCalled();
    });
  });

  describe('isServerInstalled', () => {
    it('returns true when `amplitude@amplitude` is in plugin list', async () => {
      mockClaudeBinaryFound();

      spawnSyncMock.mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from('amplitude@amplitude (user)\n'),
        stderr: Buffer.from(''),
      });

      const client = new ClaudeCodePluginClient();
      await expect(client.isServerInstalled()).resolves.toBe(true);
    });

    it('returns false when plugin list is empty', async () => {
      mockClaudeBinaryFound();

      spawnSyncMock.mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
      });

      const client = new ClaudeCodePluginClient();
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });
  });

  describe('removeServer', () => {
    it('invokes `claude plugin uninstall`', async () => {
      mockClaudeBinaryFound();

      spawnSyncMock.mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
      });

      const client = new ClaudeCodePluginClient();
      const result = await client.removeServer();

      expect(result).toEqual({ success: true });
      expect(spawnSyncMock).toHaveBeenCalledWith(
        expect.stringMatching(/claude$/),
        ['plugin', 'uninstall', 'amplitude@amplitude', '--scope', 'user'],
        expect.objectContaining({ stdio: 'pipe' }),
      );
    });

    it('captures exception and returns failure on non-zero exit', async () => {
      mockClaudeBinaryFound();

      spawnSyncMock.mockReturnValueOnce({
        status: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('boom'),
      });

      const client = new ClaudeCodePluginClient();
      const result = await client.removeServer();

      expect(result).toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalled();
    });
  });
});
