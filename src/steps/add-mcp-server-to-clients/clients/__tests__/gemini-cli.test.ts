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
import { GeminiCLIMCPClient } from '../gemini-cli';

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

describe('GeminiCLIMCPClient', () => {
  let client: GeminiCLIMCPClient;
  const mockHomeDir = '/mock/home';
  const mockApiKey = 'test-api-key';

  const mkdirMock = fs.promises.mkdir as Mock;
  const readFileMock = fs.promises.readFile as Mock;
  const writeFileMock = fs.promises.writeFile as Mock;
  const existsSyncMock = fs.existsSync as Mock;
  const homedirMock = os.homedir as Mock;

  const originalPlatform = process.platform;

  beforeEach(() => {
    client = new GeminiCLIMCPClient();
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
    expect(client.name).toBe('Gemini CLI');
  });

  describe('isClientSupported', () => {
    it('returns true when ~/.gemini exists', async () => {
      existsSyncMock.mockReturnValue(true);
      await expect(client.isClientSupported()).resolves.toBe(true);
      expect(existsSyncMock).toHaveBeenCalledWith(
        path.join(mockHomeDir, '.gemini'),
      );
    });

    it('returns false when ~/.gemini is missing', async () => {
      existsSyncMock.mockReturnValue(false);
      await expect(client.isClientSupported()).resolves.toBe(false);
    });
  });

  describe('getConfigPath', () => {
    it('resolves to ~/.gemini/settings.json', async () => {
      const configPath = await client.getConfigPath();
      expect(configPath).toBe(
        path.join(mockHomeDir, '.gemini', 'settings.json'),
      );
    });
  });

  describe('addServer', () => {
    it('writes mcpServers entry with url and no header for OAuth mode', async () => {
      existsSyncMock.mockReturnValue(false);

      await client.addServer();

      expect(mkdirMock).toHaveBeenCalledWith(
        path.join(mockHomeDir, '.gemini'),
        { recursive: true },
      );
      const [, written] = writeFileMock.mock.calls[0] as [string, string];
      const parsed = JSON.parse(written);
      expect(parsed).toEqual({
        mcpServers: {
          amplitude: {
            url: 'https://mcp.amplitude.com/mcp',
          },
        },
      });
    });

    it('includes Authorization header when an API key is provided', async () => {
      existsSyncMock.mockReturnValue(false);

      await client.addServer(mockApiKey);

      const [, written] = writeFileMock.mock.calls[0] as [string, string];
      const parsed = JSON.parse(written);
      expect(parsed.mcpServers.amplitude).toEqual({
        url: 'https://mcp.amplitude.com/mcp',
        headers: { Authorization: `Bearer ${mockApiKey}` },
      });
    });

    it('merges with an existing config without clobbering other servers', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          mcpServers: { other: { url: 'https://other.example.com/mcp' } },
        }),
      );

      await client.addServer();

      const [, written] = writeFileMock.mock.calls[0] as [string, string];
      const parsed = JSON.parse(written);
      expect(parsed.mcpServers.other).toEqual({
        url: 'https://other.example.com/mcp',
      });
      expect(parsed.mcpServers.amplitude.url).toBe(
        'https://mcp.amplitude.com/mcp',
      );
    });
  });

  describe('isServerInstalled', () => {
    it('returns true when the amplitude server is present', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({ mcpServers: { amplitude: { url: 'x' } } }),
      );
      await expect(client.isServerInstalled()).resolves.toBe(true);
    });

    it('returns false when the amplitude server is absent', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({ mcpServers: { other: { url: 'x' } } }),
      );
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });
  });

  describe('removeServer', () => {
    it('removes the amplitude entry while preserving other servers', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          mcpServers: {
            amplitude: { url: 'https://mcp.amplitude.com/mcp' },
            other: { url: 'https://other.example.com/mcp' },
          },
        }),
      );

      await client.removeServer();

      const [, written] = writeFileMock.mock.calls[0] as [string, string];
      const parsed = JSON.parse(written);
      expect(parsed.mcpServers.amplitude).toBeUndefined();
      expect(parsed.mcpServers.other).toEqual({
        url: 'https://other.example.com/mcp',
      });
    });
  });
});
