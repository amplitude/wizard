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
import { WindsurfMCPClient } from '../windsurf';

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

describe('WindsurfMCPClient', () => {
  let client: WindsurfMCPClient;
  const mockHomeDir = '/mock/home';
  const mockApiKey = 'test-api-key';

  const readFileMock = fs.promises.readFile as Mock;
  const writeFileMock = fs.promises.writeFile as Mock;
  const existsSyncMock = fs.existsSync as Mock;
  const homedirMock = os.homedir as Mock;

  const originalPlatform = process.platform;

  beforeEach(() => {
    client = new WindsurfMCPClient();
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
    expect(client.name).toBe('Windsurf');
  });

  describe('isClientSupported', () => {
    it('returns true when ~/.codeium/windsurf exists', async () => {
      existsSyncMock.mockReturnValue(true);
      await expect(client.isClientSupported()).resolves.toBe(true);
      expect(existsSyncMock).toHaveBeenCalledWith(
        path.join(mockHomeDir, '.codeium', 'windsurf'),
      );
    });

    it('returns false when the windsurf dir is missing', async () => {
      existsSyncMock.mockReturnValue(false);
      await expect(client.isClientSupported()).resolves.toBe(false);
    });
  });

  describe('getConfigPath', () => {
    it('resolves to the Windsurf mcp_config.json location', async () => {
      const configPath = await client.getConfigPath();
      expect(configPath).toBe(
        path.join(mockHomeDir, '.codeium', 'windsurf', 'mcp_config.json'),
      );
    });
  });

  describe('addServer', () => {
    it('writes an mcpServers entry with serverUrl', async () => {
      existsSyncMock.mockReturnValue(false);

      await client.addServer();

      const [, written] = writeFileMock.mock.calls[0] as [string, string];
      const parsed = JSON.parse(written);
      expect(parsed.mcpServers.amplitude).toEqual({
        serverUrl: 'https://mcp.amplitude.com/mcp',
      });
    });

    it('includes Authorization header when an API key is provided', async () => {
      existsSyncMock.mockReturnValue(false);

      await client.addServer(mockApiKey);

      const [, written] = writeFileMock.mock.calls[0] as [string, string];
      const parsed = JSON.parse(written);
      expect(parsed.mcpServers.amplitude).toEqual({
        serverUrl: 'https://mcp.amplitude.com/mcp',
        headers: { Authorization: `Bearer ${mockApiKey}` },
      });
    });
  });

  describe('isServerInstalled', () => {
    it('returns true when the amplitude server is present', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({ mcpServers: { amplitude: { serverUrl: 'x' } } }),
      );
      await expect(client.isServerInstalled()).resolves.toBe(true);
    });

    it('returns false when amplitude is not configured', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({ mcpServers: { other: { serverUrl: 'x' } } }),
      );
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });
  });

  describe('removeServer', () => {
    it('removes only the amplitude entry', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          mcpServers: {
            amplitude: { serverUrl: 'https://mcp.amplitude.com/mcp' },
            other: { serverUrl: 'https://other.example.com/mcp' },
          },
        }),
      );

      await client.removeServer();

      const [, written] = writeFileMock.mock.calls[0] as [string, string];
      const parsed = JSON.parse(written);
      expect(parsed.mcpServers.amplitude).toBeUndefined();
      expect(parsed.mcpServers.other).toEqual({
        serverUrl: 'https://other.example.com/mcp',
      });
    });
  });
});
