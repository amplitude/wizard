import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { createMcpInstaller } from '../../../ui/tui/services/mcp-installer';
import {
  getSupportedClients,
  getInstalledClients,
  removeMCPServer,
} from '../index';

vi.mock('../index', () => ({
  getSupportedClients: vi.fn(),
  getInstalledClients: vi.fn(),
  removeMCPServer: vi.fn(),
}));

vi.mock('../../../utils/debug', () => ({
  logToFile: vi.fn(),
  debug: vi.fn(),
}));

const getSupportedClientsMock = getSupportedClients as Mock;
const getInstalledClientsMock = getInstalledClients as Mock;
const removeMCPServerMock = removeMCPServer as Mock;

/**
 * Build a minimal MCPClient-shaped stub. We only need the surface that
 * mcp-installer.install() touches: a `name` and an `addServer` function.
 */
function makeClient(
  name: string,
  addServerImpl: () => Promise<{ success: boolean }> | never,
) {
  return {
    name,
    addServer: vi.fn(addServerImpl),
  };
}

describe('McpInstaller.install — partial success', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('continues installing other clients when one throws in the middle', async () => {
    const cursor = makeClient('Cursor', async () => ({ success: true }));
    const claude = makeClient('Claude', async () => {
      throw new Error('boom — Claude install failed');
    });
    const zed = makeClient('Zed', async () => ({ success: true }));

    getSupportedClientsMock.mockResolvedValue([cursor, claude, zed]);

    const installer = createMcpInstaller();
    await installer.detectClients();

    const installed = await installer.install(['Cursor', 'Claude', 'Zed']);

    // The middle client threw, but the other two should still have been
    // attempted and reported as installed.
    expect(installed).toEqual(['Cursor', 'Zed']);
    expect(cursor.addServer).toHaveBeenCalledTimes(1);
    expect(claude.addServer).toHaveBeenCalledTimes(1);
    expect(zed.addServer).toHaveBeenCalledTimes(1);
  });

  it('skips clients that report success=false but continues with the rest', async () => {
    const cursor = makeClient('Cursor', async () => ({ success: true }));
    const claude = makeClient('Claude', async () => ({ success: false }));
    const zed = makeClient('Zed', async () => ({ success: true }));

    getSupportedClientsMock.mockResolvedValue([cursor, claude, zed]);

    const installer = createMcpInstaller();
    await installer.detectClients();

    const installed = await installer.install(['Cursor', 'Claude', 'Zed']);

    expect(installed).toEqual(['Cursor', 'Zed']);
  });

  it('returns empty array when no requested client names match cached detections', async () => {
    const cursor = makeClient('Cursor', async () => ({ success: true }));
    getSupportedClientsMock.mockResolvedValue([cursor]);

    const installer = createMcpInstaller();
    await installer.detectClients();

    const installed = await installer.install(['DoesNotExist']);

    expect(installed).toEqual([]);
    expect(cursor.addServer).not.toHaveBeenCalled();
  });
});

describe('McpInstaller.remove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early with [] when no clients are installed', async () => {
    getInstalledClientsMock.mockResolvedValue([]);

    const installer = createMcpInstaller();
    const removed = await installer.remove();

    expect(removed).toEqual([]);
    expect(removeMCPServerMock).not.toHaveBeenCalled();
  });

  it('delegates to removeMCPServer and returns names of all installed clients', async () => {
    const installed = [
      { name: 'Cursor' },
      { name: 'Claude Code' },
      { name: 'Cline' },
    ];
    getInstalledClientsMock.mockResolvedValue(installed);
    removeMCPServerMock.mockResolvedValue(undefined);

    const installer = createMcpInstaller();
    const removed = await installer.remove();

    expect(removed).toEqual(['Cursor', 'Claude Code', 'Cline']);
    expect(removeMCPServerMock).toHaveBeenCalledWith(installed, false);
  });
});
