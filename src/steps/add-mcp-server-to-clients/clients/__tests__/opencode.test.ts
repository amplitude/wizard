import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OpenCodeMCPClient } from '../opencode';

vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
  existsSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: vi.fn(),
}));

describe('OpenCodeMCPClient', () => {
  let client: OpenCodeMCPClient;
  const mockHomeDir = '/mock/home';
  const mockApiKey = 'test-api-key';

  const readFileMock = fs.promises.readFile as Mock;
  const writeFileMock = fs.promises.writeFile as Mock;
  const existsSyncMock = fs.existsSync as Mock;
  const homedirMock = os.homedir as Mock;

  const originalPlatform = process.platform;

  beforeEach(() => {
    client = new OpenCodeMCPClient();
    vi.clearAllMocks();
    homedirMock.mockReturnValue(mockHomeDir);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
    });
  });

  it('has the expected name', () => {
    expect(client.name).toBe('OpenCode');
  });

  it('uses `mcp` as the top-level property name', () => {
    expect(client.getServerPropertyName()).toBe('mcp');
  });

  describe('isClientSupported', () => {
    it('returns true when ~/.config/opencode exists', async () => {
      existsSyncMock.mockReturnValue(true);
      await expect(client.isClientSupported()).resolves.toBe(true);
      expect(existsSyncMock).toHaveBeenCalledWith(
        path.join(mockHomeDir, '.config', 'opencode'),
      );
    });

    it('returns false when opencode dir is missing', async () => {
      existsSyncMock.mockReturnValue(false);
      await expect(client.isClientSupported()).resolves.toBe(false);
    });
  });

  describe('getConfigPath', () => {
    it('resolves to ~/.config/opencode/opencode.json', async () => {
      const configPath = await client.getConfigPath();
      expect(configPath).toBe(
        path.join(mockHomeDir, '.config', 'opencode', 'opencode.json'),
      );
    });
  });

  describe('addServer', () => {
    it('writes a remote MCP entry with type:"remote"', async () => {
      existsSyncMock.mockReturnValue(false);

      await client.addServer();

      const [, written] = writeFileMock.mock.calls[0] as [string, string];
      const parsed = JSON.parse(written);
      expect(parsed.mcp.amplitude).toEqual({
        type: 'remote',
        url: 'https://mcp.amplitude.com/mcp',
      });
      // OpenCode uses `mcp`, not `mcpServers`.
      expect(parsed.mcpServers).toBeUndefined();
    });

    it('includes Authorization header when an API key is provided', async () => {
      existsSyncMock.mockReturnValue(false);

      await client.addServer(mockApiKey);

      const [, written] = writeFileMock.mock.calls[0] as [string, string];
      const parsed = JSON.parse(written);
      expect(parsed.mcp.amplitude).toEqual({
        type: 'remote',
        url: 'https://mcp.amplitude.com/mcp',
        headers: { Authorization: `Bearer ${mockApiKey}` },
      });
    });
  });

  describe('isServerInstalled', () => {
    it('returns true when the amplitude server is present under `mcp`', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          mcp: { amplitude: { type: 'remote', url: 'x' } },
        }),
      );
      await expect(client.isServerInstalled()).resolves.toBe(true);
    });

    it('returns false when amplitude is absent', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({ mcp: { other: { type: 'remote', url: 'x' } } }),
      );
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });
  });

  describe('removeServer', () => {
    it('removes only the amplitude entry', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          mcp: {
            amplitude: {
              type: 'remote',
              url: 'https://mcp.amplitude.com/mcp',
            },
            other: {
              type: 'remote',
              url: 'https://other.example.com/mcp',
            },
          },
        }),
      );

      await client.removeServer();

      const [, written] = writeFileMock.mock.calls[0] as [string, string];
      const parsed = JSON.parse(written);
      expect(parsed.mcp.amplitude).toBeUndefined();
      expect(parsed.mcp.other).toEqual({
        type: 'remote',
        url: 'https://other.example.com/mcp',
      });
    });
  });
});
