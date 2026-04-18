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
import { AmpMCPClient } from '../amp';

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

describe('AmpMCPClient', () => {
  let client: AmpMCPClient;
  const mockHomeDir = '/mock/home';
  const mockApiKey = 'test-api-key';

  const readFileMock = fs.promises.readFile as Mock;
  const writeFileMock = fs.promises.writeFile as Mock;
  const existsSyncMock = fs.existsSync as Mock;
  const homedirMock = os.homedir as Mock;

  const originalPlatform = process.platform;

  beforeEach(() => {
    client = new AmpMCPClient();
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
    expect(client.name).toBe('Amp');
  });

  it('uses the flat dotted `amp.mcpServers` property name', () => {
    expect(client.getServerPropertyName()).toBe('amp.mcpServers');
  });

  describe('isClientSupported', () => {
    it('returns true when ~/.config/amp exists', async () => {
      existsSyncMock.mockReturnValue(true);
      await expect(client.isClientSupported()).resolves.toBe(true);
      expect(existsSyncMock).toHaveBeenCalledWith(
        path.join(mockHomeDir, '.config', 'amp'),
      );
    });

    it('returns false when the amp config dir is missing', async () => {
      existsSyncMock.mockReturnValue(false);
      await expect(client.isClientSupported()).resolves.toBe(false);
    });
  });

  describe('getConfigPath', () => {
    it('resolves to ~/.config/amp/settings.json', async () => {
      const configPath = await client.getConfigPath();
      expect(configPath).toBe(
        path.join(mockHomeDir, '.config', 'amp', 'settings.json'),
      );
    });
  });

  describe('addServer', () => {
    it('writes the amplitude entry under the flat `amp.mcpServers` key', async () => {
      existsSyncMock.mockReturnValue(false);

      await client.addServer();

      const [, written] = writeFileMock.mock.calls[0] as [string, string];
      const parsed = JSON.parse(written);
      expect(parsed['amp.mcpServers']).toBeDefined();
      expect(parsed['amp.mcpServers'].amplitude).toEqual({
        url: 'https://mcp.amplitude.com/mcp',
      });
      // Does NOT nest under an "amp" object.
      expect(parsed.amp).toBeUndefined();
    });

    it('includes Authorization header when an API key is provided', async () => {
      existsSyncMock.mockReturnValue(false);

      await client.addServer(mockApiKey);

      const [, written] = writeFileMock.mock.calls[0] as [string, string];
      const parsed = JSON.parse(written);
      expect(parsed['amp.mcpServers'].amplitude).toEqual({
        url: 'https://mcp.amplitude.com/mcp',
        headers: { Authorization: `Bearer ${mockApiKey}` },
      });
    });

    it('preserves unrelated keys when merging with existing settings', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          'amp.someOtherSetting': 'value',
          'amp.mcpServers': { other: { url: 'https://other.example.com/mcp' } },
        }),
      );

      await client.addServer();

      const [, written] = writeFileMock.mock.calls[0] as [string, string];
      const parsed = JSON.parse(written);
      expect(parsed['amp.someOtherSetting']).toBe('value');
      expect(parsed['amp.mcpServers'].other).toEqual({
        url: 'https://other.example.com/mcp',
      });
      expect(parsed['amp.mcpServers'].amplitude.url).toBe(
        'https://mcp.amplitude.com/mcp',
      );
    });
  });

  describe('isServerInstalled', () => {
    it('returns true when the amplitude server is present', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({ 'amp.mcpServers': { amplitude: { url: 'x' } } }),
      );
      await expect(client.isServerInstalled()).resolves.toBe(true);
    });

    it('returns false when amplitude is absent', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({ 'amp.mcpServers': { other: { url: 'x' } } }),
      );
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });
  });

  describe('removeServer', () => {
    it('removes the amplitude entry while preserving other servers', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          'amp.mcpServers': {
            amplitude: { url: 'https://mcp.amplitude.com/mcp' },
            other: { url: 'https://other.example.com/mcp' },
          },
        }),
      );

      await client.removeServer();

      const [, written] = writeFileMock.mock.calls[0] as [string, string];
      const parsed = JSON.parse(written);
      expect(parsed['amp.mcpServers'].amplitude).toBeUndefined();
      expect(parsed['amp.mcpServers'].other).toEqual({
        url: 'https://other.example.com/mcp',
      });
    });
  });
});
