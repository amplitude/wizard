import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import * as fs from 'fs';
import { ClaudeCodePluginClient } from '../claude-code-plugin';
import { analytics } from '../../../../utils/analytics';
import { _resetClaudeBinaryCache } from '../claude-binary';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(() => ({
    status: 0,
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
  })),
  spawn: vi.fn(),
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

const spawnMock = spawn as Mock;
const existsSyncMock = fs.existsSync as unknown as Mock;

/**
 * Queue a mock `spawn()` response. The next call to spawn() will resolve with
 * the given status and stdout/stderr. Because runCli listens on stream 'data'
 * + 'close' events, we fake a minimal EventEmitter-backed ChildProcess.
 */
function queueSpawn(
  status: number,
  { stdout = '', stderr = '' }: { stdout?: string; stderr?: string } = {},
) {
  spawnMock.mockImplementationOnce(() => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    // Fire async so callers get a chance to register listeners.
    setImmediate(() => {
      if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
      if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
      proc.emit('close', status);
    });
    return proc;
  });
}

const okSpawn = (stdout = '', stderr = '') => queueSpawn(0, { stdout, stderr });
const failSpawn = (stderr = '', stdout = '') =>
  queueSpawn(1, { stdout, stderr });

function mockClaudeBinaryFound() {
  existsSyncMock.mockImplementation((p: string) => p.endsWith('/claude'));
}

/** Find the spawn call whose argv matches the given tokens (args = calls[i][1]). */
function findSpawnCall(tokens: string[]) {
  return spawnMock.mock.calls.find((c) => {
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
      okSpawn('✔ Successfully added marketplace: amplitude'); // marketplace add
      okSpawn('✔ Successfully installed plugin'); // plugin install
      okSpawn(''); // mcp list (no stale)

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result).toEqual({ success: true });
      expect(findSpawnCall(['plugin', 'marketplace', 'add'])).toBeDefined();
      expect(
        findSpawnCall([
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
      failSpawn('Marketplace already on disk — declared in user settings');
      okSpawn();
      okSpawn();

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result).toEqual({ success: true });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('treats an already-installed plugin as success', async () => {
      mockClaudeBinaryFound();
      okSpawn();
      failSpawn('Plugin already installed');
      okSpawn();

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result).toEqual({ success: true });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('returns failure + error string when marketplace add fails', async () => {
      mockClaudeBinaryFound();
      failSpawn('fatal: repository amplitude/mcp-marketplace not found');

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/marketplace/i);
      expect(result.error).toMatch(/not found/i);
      expect(analytics.captureException).toHaveBeenCalled();
      expect(findSpawnCall(['plugin', 'install'])).toBeUndefined();
    });

    it('returns failure + error string when plugin install fails (no fallback)', async () => {
      mockClaudeBinaryFound();
      okSpawn();
      failSpawn('plugin manifest invalid');

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/plugin install failed/i);
      expect(result.error).toMatch(/manifest/);
      expect(analytics.captureException).toHaveBeenCalled();
      expect(findSpawnCall(['mcp', 'add'])).toBeUndefined();
    });

    it('removes stale bare `amplitude` MCP entry after plugin install', async () => {
      mockClaudeBinaryFound();
      okSpawn();
      okSpawn();
      okSpawn('amplitude: https://...\nother: ...\n'); // mcp list
      okSpawn(); // mcp remove

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result).toEqual({ success: true });
      expect(
        findSpawnCall(['mcp', 'remove', '--scope', 'user', 'amplitude']),
      ).toBeDefined();
    });

    it('does not touch `amplitude-local` when checking stale entries', async () => {
      mockClaudeBinaryFound();
      okSpawn();
      okSpawn();
      okSpawn('amplitude-local: http://localhost\n');

      const client = new ClaudeCodePluginClient();
      await client.addServer();

      expect(findSpawnCall(['mcp', 'remove'])).toBeUndefined();
    });

    it('returns failure with a friendly error when claude binary is not on PATH', async () => {
      existsSyncMock.mockReturnValue(false);
      process.env.PATH = '';

      const client = new ClaudeCodePluginClient();
      const result = await client.addServer();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/claude code cli/i);
      expect(spawnMock).not.toHaveBeenCalled();
    });
  });

  describe('isServerInstalled', () => {
    it('returns true when `amplitude@amplitude` is in plugin list', async () => {
      mockClaudeBinaryFound();
      okSpawn('amplitude@amplitude (user)\n');

      const client = new ClaudeCodePluginClient();
      await expect(client.isServerInstalled()).resolves.toBe(true);
    });

    it('returns false when plugin list is empty', async () => {
      mockClaudeBinaryFound();
      okSpawn('');

      const client = new ClaudeCodePluginClient();
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });
  });

  describe('removeServer', () => {
    it('invokes `claude plugin uninstall` and returns success', async () => {
      mockClaudeBinaryFound();
      okSpawn();

      const client = new ClaudeCodePluginClient();
      const result = await client.removeServer();

      expect(result).toEqual({ success: true });
      expect(
        findSpawnCall([
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
      failSpawn('uninstall failed');

      const client = new ClaudeCodePluginClient();
      const result = await client.removeServer();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/uninstall failed/);
      expect(analytics.captureException).toHaveBeenCalled();
    });
  });
});
