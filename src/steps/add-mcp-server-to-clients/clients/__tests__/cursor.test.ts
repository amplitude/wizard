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
import { CursorMCPClient } from '../cursor';

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

describe('CursorMCPClient', () => {
  let client: CursorMCPClient;
  const mockHomeDir = '/mock/home';

  const existsSyncMock = fs.existsSync as Mock;
  const homedirMock = os.homedir as Mock;

  const originalPlatform = process.platform;

  beforeEach(() => {
    client = new CursorMCPClient();
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
    expect(client.name).toBe('Cursor');
  });

  describe('isClientSupported', () => {
    it('returns true on macOS when ~/.cursor exists', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
      existsSyncMock.mockReturnValue(true);

      await expect(client.isClientSupported()).resolves.toBe(true);
      expect(existsSyncMock).toHaveBeenCalledWith(
        path.join(mockHomeDir, '.cursor'),
      );
    });

    it('returns true on Windows when ~/.cursor exists', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      });
      existsSyncMock.mockReturnValue(true);

      await expect(client.isClientSupported()).resolves.toBe(true);
      expect(existsSyncMock).toHaveBeenCalledWith(
        path.join(mockHomeDir, '.cursor'),
      );
    });

    it('returns true on Linux when ~/.cursor exists (Cursor ships AppImage)', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      });
      existsSyncMock.mockReturnValue(true);

      await expect(client.isClientSupported()).resolves.toBe(true);
      expect(existsSyncMock).toHaveBeenCalledWith(
        path.join(mockHomeDir, '.cursor'),
      );
    });

    it('returns false on Linux when ~/.cursor is missing', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      });
      existsSyncMock.mockReturnValue(false);

      await expect(client.isClientSupported()).resolves.toBe(false);
    });

    it('returns false on macOS when ~/.cursor is missing', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
      existsSyncMock.mockReturnValue(false);

      await expect(client.isClientSupported()).resolves.toBe(false);
    });

    it('returns false on unsupported platforms (e.g. freebsd)', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'freebsd',
        writable: true,
      });
      // Even if the dir somehow exists, an unsupported platform should bail.
      existsSyncMock.mockReturnValue(true);

      await expect(client.isClientSupported()).resolves.toBe(false);
    });
  });

  describe('getConfigPath', () => {
    it('resolves to ~/.cursor/mcp.json on every supported platform', async () => {
      const expected = path.join(mockHomeDir, '.cursor', 'mcp.json');

      for (const platform of ['darwin', 'win32', 'linux'] as const) {
        Object.defineProperty(process, 'platform', {
          value: platform,
          writable: true,
        });
        await expect(client.getConfigPath()).resolves.toBe(expected);
      }
    });
  });
});
