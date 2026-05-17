/**
 * Snapshot-style tests pinning the external contract for the five
 * deprecated uninstall-only MCP clients (Cline, Windsurf, Gemini CLI, Amp,
 * OpenCode). The dedup that collapsed them onto a shared
 * `DeprecatedMCPClient` factory must NOT change:
 *
 *   - the human-readable client name
 *   - the JSON property name under which `removeServer` scrubs the
 *     `amplitude` entry
 *   - the absolute config path resolved per-platform
 *   - the no-op behavior of `addServer`
 *   - the "uninstall-only" semantics of `isClientSupported` (true only when
 *     a stale config file already exists)
 */
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
import {
  AmpMCPClient,
  ClineMCPClient,
  GeminiCLIMCPClient,
  OpenCodeMCPClient,
  WindsurfMCPClient,
} from '../deprecated';

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

const existsSyncMock = fs.existsSync as Mock;
const homedirMock = os.homedir as Mock;

const HOME = '/mock/home';
const originalPlatform = process.platform;
const originalAppData = process.env.APPDATA;

const setPlatform = (value: string) => {
  Object.defineProperty(process, 'platform', { value, writable: true });
};

beforeEach(() => {
  vi.clearAllMocks();
  homedirMock.mockReturnValue(HOME);
});

afterEach(() => {
  setPlatform(originalPlatform);
  if (originalAppData === undefined) {
    delete process.env.APPDATA;
  } else {
    process.env.APPDATA = originalAppData;
  }
});

describe('Deprecated MCP clients — name + property name contract', () => {
  it('expose stable name + getServerPropertyName for every client', () => {
    const cases: Array<{
      client: { name: string; getServerPropertyName: () => string };
      name: string;
      prop: string;
    }> = [
      {
        client: new ClineMCPClient(),
        name: 'Cline',
        prop: 'mcpServers',
      },
      {
        client: new WindsurfMCPClient(),
        name: 'Windsurf',
        prop: 'mcpServers',
      },
      {
        client: new GeminiCLIMCPClient(),
        name: 'Gemini CLI',
        prop: 'mcpServers',
      },
      {
        // Amp's flat dotted key is the headline regression risk — if this
        // drifts, the uninstall flow will scrub the wrong JSON path and
        // leave stale `amp.mcpServers.amplitude` entries forever.
        client: new AmpMCPClient(),
        name: 'Amp',
        prop: 'amp.mcpServers',
      },
      {
        // OpenCode is the other shape deviation: top-level `mcp` (not
        // `mcpServers`).
        client: new OpenCodeMCPClient(),
        name: 'OpenCode',
        prop: 'mcp',
      },
    ];

    for (const { client, name, prop } of cases) {
      expect(client.name).toBe(name);
      expect(client.getServerPropertyName()).toBe(prop);
    }
  });
});

describe('Deprecated MCP clients — addServer is a permanent no-op', () => {
  it('every deprecated client.addServer resolves { success: false }', async () => {
    setPlatform('darwin');
    for (const client of [
      new ClineMCPClient(),
      new WindsurfMCPClient(),
      new GeminiCLIMCPClient(),
      new AmpMCPClient(),
      new OpenCodeMCPClient(),
    ]) {
      await expect(client.addServer()).resolves.toEqual({ success: false });
    }
  });
});

describe('Deprecated MCP clients — isClientSupported is uninstall-only', () => {
  it('returns true only when the on-disk config file already exists', async () => {
    setPlatform('darwin');
    existsSyncMock.mockReturnValue(true);
    const present = new WindsurfMCPClient();
    await expect(present.isClientSupported()).resolves.toBe(true);

    existsSyncMock.mockReturnValue(false);
    const missing = new WindsurfMCPClient();
    await expect(missing.isClientSupported()).resolves.toBe(false);
  });

  it('returns false when the config path cannot be resolved on this platform', async () => {
    // Cline depends on a VS Code user dir that only resolves on darwin /
    // win32 / linux. On freebsd `resolveConfigPath` returns null →
    // `getConfigPath` throws → `isClientSupported` should swallow and
    // return false.
    setPlatform('freebsd');
    existsSyncMock.mockReturnValue(true);
    await expect(new ClineMCPClient().isClientSupported()).resolves.toBe(false);
  });
});

describe('Deprecated MCP clients — config path stability', () => {
  it('Cline points at the VS Code globalStorage settings file per platform', async () => {
    const ext = 'saoudrizwan.claude-dev';
    setPlatform('darwin');
    existsSyncMock.mockReturnValue(true);
    await expect(new ClineMCPClient().getConfigPath()).resolves.toBe(
      path.join(
        HOME,
        'Library',
        'Application Support',
        'Code',
        'User',
        'globalStorage',
        ext,
        'settings',
        'cline_mcp_settings.json',
      ),
    );

    setPlatform('linux');
    await expect(new ClineMCPClient().getConfigPath()).resolves.toBe(
      path.join(
        HOME,
        '.config',
        'Code',
        'User',
        'globalStorage',
        ext,
        'settings',
        'cline_mcp_settings.json',
      ),
    );

    setPlatform('win32');
    process.env.APPDATA = 'C:\\Users\\mock\\AppData\\Roaming';
    await expect(new ClineMCPClient().getConfigPath()).resolves.toBe(
      path.join(
        process.env.APPDATA,
        'Code',
        'User',
        'globalStorage',
        ext,
        'settings',
        'cline_mcp_settings.json',
      ),
    );
  });

  it('Windsurf, Gemini, Amp, OpenCode resolve under $HOME on every platform', async () => {
    setPlatform('darwin');
    await expect(new WindsurfMCPClient().getConfigPath()).resolves.toBe(
      path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json'),
    );
    await expect(new GeminiCLIMCPClient().getConfigPath()).resolves.toBe(
      path.join(HOME, '.gemini', 'settings.json'),
    );
    await expect(new AmpMCPClient().getConfigPath()).resolves.toBe(
      path.join(HOME, '.config', 'amp', 'settings.json'),
    );
    await expect(new OpenCodeMCPClient().getConfigPath()).resolves.toBe(
      path.join(HOME, '.config', 'opencode', 'opencode.json'),
    );
  });
});
