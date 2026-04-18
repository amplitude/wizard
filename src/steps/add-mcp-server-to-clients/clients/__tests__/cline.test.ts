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
import { ClineMCPClient } from '../cline';

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

describe('ClineMCPClient', () => {
  let client: ClineMCPClient;
  const mockHomeDir = '/mock/home';
  const mockApiKey = 'test-api-key';
  const clineExtensionId = 'saoudrizwan.claude-dev';

  const readFileMock = fs.promises.readFile as Mock;
  const writeFileMock = fs.promises.writeFile as Mock;
  const existsSyncMock = fs.existsSync as Mock;
  const homedirMock = os.homedir as Mock;

  const originalPlatform = process.platform;

  const macConfigPath = path.join(
    mockHomeDir,
    'Library',
    'Application Support',
    'Code',
    'User',
    'globalStorage',
    clineExtensionId,
    'settings',
    'cline_mcp_settings.json',
  );

  beforeEach(() => {
    client = new ClineMCPClient();
    vi.clearAllMocks();
    homedirMock.mockReturnValue(mockHomeDir);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
    });
  });

  const setPlatform = (value: NodeJS.Platform) => {
    Object.defineProperty(process, 'platform', { value, writable: true });
  };

  it('has the expected name', () => {
    expect(client.name).toBe('Cline');
  });

  describe('isClientSupported', () => {
    it('returns true on macOS when the Cline globalStorage dir exists', async () => {
      setPlatform('darwin');
      existsSyncMock.mockReturnValue(true);
      await expect(client.isClientSupported()).resolves.toBe(true);
      expect(existsSyncMock).toHaveBeenCalledWith(
        path.join(
          mockHomeDir,
          'Library',
          'Application Support',
          'Code',
          'User',
          'globalStorage',
          clineExtensionId,
        ),
      );
    });

    it('returns false on macOS when the globalStorage dir is missing', async () => {
      setPlatform('darwin');
      existsSyncMock.mockReturnValue(false);
      await expect(client.isClientSupported()).resolves.toBe(false);
    });

    it('returns false on unsupported platforms', async () => {
      setPlatform('freebsd' as NodeJS.Platform);
      await expect(client.isClientSupported()).resolves.toBe(false);
    });

    it('returns false on Windows without APPDATA', async () => {
      setPlatform('win32');
      const original = process.env.APPDATA;
      delete process.env.APPDATA;
      try {
        await expect(client.isClientSupported()).resolves.toBe(false);
      } finally {
        if (original !== undefined) process.env.APPDATA = original;
      }
    });
  });

  describe('getConfigPath', () => {
    it('resolves to the macOS globalStorage settings file', async () => {
      setPlatform('darwin');
      await expect(client.getConfigPath()).resolves.toBe(macConfigPath);
    });

    it('throws on unsupported platform', async () => {
      setPlatform('freebsd' as NodeJS.Platform);
      await expect(client.getConfigPath()).rejects.toThrow(
        'Unsupported platform: freebsd',
      );
    });
  });

  describe('addServer', () => {
    it('writes url-based mcpServers entry on macOS', async () => {
      setPlatform('darwin');
      existsSyncMock.mockReturnValue(false);

      await client.addServer();

      const [, written] = writeFileMock.mock.calls[0] as [string, string];
      const parsed = JSON.parse(written);
      expect(parsed.mcpServers.amplitude).toEqual({
        url: 'https://mcp.amplitude.com/mcp',
      });
    });

    it('includes Authorization header when an API key is provided', async () => {
      setPlatform('darwin');
      existsSyncMock.mockReturnValue(false);

      await client.addServer(mockApiKey);

      const [, written] = writeFileMock.mock.calls[0] as [string, string];
      const parsed = JSON.parse(written);
      expect(parsed.mcpServers.amplitude).toEqual({
        url: 'https://mcp.amplitude.com/mcp',
        headers: { Authorization: `Bearer ${mockApiKey}` },
      });
    });
  });

  describe('isServerInstalled', () => {
    beforeEach(() => setPlatform('darwin'));

    it('returns true when amplitude is configured', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({ mcpServers: { amplitude: { url: 'x' } } }),
      );
      await expect(client.isServerInstalled()).resolves.toBe(true);
    });

    it('returns false when amplitude is absent', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({ mcpServers: { other: { url: 'x' } } }),
      );
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });
  });

  describe('removeServer', () => {
    it('removes only the amplitude entry on macOS', async () => {
      setPlatform('darwin');
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
