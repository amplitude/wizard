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
  };
});

const spawnSyncMock = spawnSync as Mock;
const existsSyncMock = fs.existsSync as unknown as Mock;

const ok = (stdout = '', stderr = '') => ({
  status: 0,
  stdout: Buffer.from(stdout),
  stderr: Buffer.from(stderr),
});
const fail = (stderr = '', stdout = '') => ({
  status: 1,
  stdout: Buffer.from(stdout),
  stderr: Buffer.from(stderr),
});

function mockClaudeBinaryFound() {
  existsSyncMock.mockImplementation((p: string) => p.endsWith('/claude'));
}

/** Find the spawnSync call whose argv starts with the given tokens. */
function findCall(tokens: string[]) {
  return spawnSyncMock.mock.calls.find((c) => {
    const args = c[1];
    if (!Array.isArray(args)) return false;
    return tokens.every((t, i) => args[i] === t);
  });
}

describe('ClaudeCodePluginClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetClaudeBinaryCache();
    existsSyncMock.mockReturnValue(false);
  });

  describe('addServer', () => {
    it('adds marketplace, installs plugin, reports success', async () => {
      mockClaudeBinaryFound();
      spawnSyncMock
        .mockReturnValueOnce(ok('✔ Successfully added marketplace: amplitude')) // marketplace add
        .mockReturnValueOnce(ok('✔ Successfully installed plugin')) // plugin install
        .mockReturnValueOnce(ok('')); // mcp list (no stale)

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result).toEqual({ success: true });
      expect(findCall(['plugin', 'marketplace', 'add'])).toBeDefined();
      expect(
        findCall([
          'plugin',
          'install',
          'amplitude@amplitude',
          '--scope',
          'user',
        ]),
      ).toBeDefined();
    });

    it('treats an already-added marketplace as success', async () => {
      mockClaudeBinaryFound();
      spawnSyncMock
        .mockReturnValueOnce(
          fail('Marketplace already on disk — declared in user settings'),
        )
        .mockReturnValueOnce(ok())
        .mockReturnValueOnce(ok());

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result).toEqual({ success: true });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('treats an already-installed plugin as success', async () => {
      mockClaudeBinaryFound();
      spawnSyncMock
        .mockReturnValueOnce(ok())
        .mockReturnValueOnce(fail('Plugin already installed'))
        .mockReturnValueOnce(ok());

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result).toEqual({ success: true });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('returns failure + error string when marketplace add fails', async () => {
      mockClaudeBinaryFound();
      spawnSyncMock.mockReturnValueOnce(
        fail('fatal: repository amplitude/mcp-marketplace not found'),
      );

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/marketplace/i);
      expect(result.error).toMatch(/not found/i);
      expect(analytics.captureException).toHaveBeenCalled();
      // No plugin install call should have been attempted.
      expect(findCall(['plugin', 'install'])).toBeUndefined();
    });

    it('returns failure + error string when plugin install fails (no fallback)', async () => {
      mockClaudeBinaryFound();
      spawnSyncMock
        .mockReturnValueOnce(ok())
        .mockReturnValueOnce(fail('plugin manifest invalid'));

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/plugin install failed/i);
      expect(result.error).toMatch(/manifest/);
      expect(analytics.captureException).toHaveBeenCalled();
      // No `claude mcp add` fallback.
      expect(findCall(['mcp', 'add'])).toBeUndefined();
    });

    it('removes stale bare `amplitude` MCP entry after plugin install', async () => {
      mockClaudeBinaryFound();
      spawnSyncMock
        .mockReturnValueOnce(ok())
        .mockReturnValueOnce(ok())
        .mockReturnValueOnce(ok('amplitude: https://...\nother: ...\n')) // mcp list
        .mockReturnValueOnce(ok()); // mcp remove

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result).toEqual({ success: true });
      expect(
        findCall(['mcp', 'remove', '--scope', 'user', 'amplitude']),
      ).toBeDefined();
    });

    it('does not touch `amplitude-local` when checking stale entries', async () => {
      mockClaudeBinaryFound();
      spawnSyncMock
        .mockReturnValueOnce(ok())
        .mockReturnValueOnce(ok())
        .mockReturnValueOnce(ok('amplitude-local: http://localhost\n'));

      const client = new ClaudeCodePluginClient();
      await client.addServer();

      expect(findCall(['mcp', 'remove'])).toBeUndefined();
    });

    it('returns failure with a friendly error when claude binary is not on PATH', async () => {
      existsSyncMock.mockReturnValue(false);
      process.env.PATH = '';

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/claude code cli/i);
      expect(spawnSyncMock).not.toHaveBeenCalled();
    });
  });

  describe('isServerInstalled', () => {
    it('returns true when `amplitude@amplitude` is in plugin list', async () => {
      mockClaudeBinaryFound();
      spawnSyncMock.mockReturnValueOnce(ok('amplitude@amplitude (user)\n'));

      const client = new ClaudeCodePluginClient();
      await expect(client.isServerInstalled()).resolves.toBe(true);
    });

    it('returns false when plugin list is empty', async () => {
      mockClaudeBinaryFound();
      spawnSyncMock.mockReturnValueOnce(ok(''));

      const client = new ClaudeCodePluginClient();
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });
  });

  describe('removeServer', () => {
    it('invokes `claude plugin uninstall` and returns success', async () => {
      mockClaudeBinaryFound();
      spawnSyncMock.mockReturnValueOnce(ok());

      const client = new ClaudeCodePluginClient();
      const result = await client.removeServer();

      expect(result).toEqual({ success: true });
      expect(
        findCall([
          'plugin',
          'uninstall',
          'amplitude@amplitude',
          '--scope',
          'user',
        ]),
      ).toBeDefined();
    });

    it('returns failure with error on non-zero exit', async () => {
      mockClaudeBinaryFound();
      spawnSyncMock.mockReturnValueOnce(fail('uninstall failed'));

      const client = new ClaudeCodePluginClient();
      const result = await client.removeServer();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/uninstall failed/);
      expect(analytics.captureException).toHaveBeenCalled();
    });
  });
});
