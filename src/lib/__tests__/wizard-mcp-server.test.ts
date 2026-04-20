import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock agent-ops so we can assert the MCP tool handlers forward correctly.
vi.mock('../agent-ops.js', () => ({
  runDetect: vi.fn(),
  runStatus: vi.fn(),
  getAuthStatus: vi.fn(),
  getAuthToken: vi.fn(),
}));

import { registerWizardTools } from '../wizard-mcp-server.js';
import {
  runDetect,
  runStatus,
  getAuthStatus,
  getAuthToken,
} from '../agent-ops.js';

const mockedRunDetect = vi.mocked(runDetect);
const mockedRunStatus = vi.mocked(runStatus);
const mockedGetAuthStatus = vi.mocked(getAuthStatus);
const mockedGetAuthToken = vi.mocked(getAuthToken);

interface CapturedTool {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  };
  handler: (args: unknown) => unknown;
}

interface FakeServer {
  tools: CapturedTool[];
  registerTool: (
    name: string,
    config: CapturedTool['config'],
    handler: CapturedTool['handler'],
  ) => void;
}

function makeFakeServer(): FakeServer {
  const tools: CapturedTool[] = [];
  return {
    tools,
    registerTool: (name, config, handler) => {
      tools.push({ name, config, handler });
    },
  };
}

// Extract the first text-block from an MCP tool result and JSON.parse it.
function parseToolResult(result: unknown): unknown {
  const typed = result as {
    content: Array<{ type: string; text: string }>;
  };
  return JSON.parse(typed.content[0].text);
}

describe('registerWizardTools', () => {
  let fake: ReturnType<typeof makeFakeServer>;

  beforeEach(() => {
    mockedRunDetect.mockReset();
    mockedRunStatus.mockReset();
    mockedGetAuthStatus.mockReset();
    mockedGetAuthToken.mockReset();
    fake = makeFakeServer();
    registerWizardTools(fake);
  });

  it('registers exactly the four expected tools by name', () => {
    const names = fake.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'detect_framework',
      'get_auth_status',
      'get_auth_token',
      'get_project_status',
    ]);
  });

  it('every tool has a non-empty description', () => {
    for (const tool of fake.tools) {
      expect(tool.config.description).toBeTruthy();
      expect((tool.config.description ?? '').length).toBeGreaterThan(10);
    }
  });

  it('detect_framework and get_project_status accept optional installDir', () => {
    for (const name of ['detect_framework', 'get_project_status']) {
      const tool = fake.tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool!.config.inputSchema).toBeDefined();
      expect(tool!.config.inputSchema).toHaveProperty('installDir');
    }
  });

  it('get_auth_status and get_auth_token have empty input schemas', () => {
    for (const name of ['get_auth_status', 'get_auth_token']) {
      const tool = fake.tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool!.config.inputSchema).toEqual({});
    }
  });

  it('get_auth_token description flags that it returns a live token', () => {
    const tool = fake.tools.find((t) => t.name === 'get_auth_token');
    // Don't lock to exact wording; just require a security-flavored hint.
    expect(tool!.config.description).toMatch(/token|secret|sensitive/i);
  });

  it('detect_framework forwards to runDetect with installDir when provided', async () => {
    mockedRunDetect.mockResolvedValue({
      integration: null,
      frameworkName: null,
      confidence: 'none',
      signals: [],
    });

    const tool = fake.tools.find((t) => t.name === 'detect_framework')!;
    const result = await tool.handler({ installDir: '/tmp/my-app' });

    expect(mockedRunDetect).toHaveBeenCalledWith('/tmp/my-app');
    expect(parseToolResult(result)).toEqual({
      integration: null,
      frameworkName: null,
      confidence: 'none',
      signals: [],
    });
  });

  it('detect_framework defaults to process.cwd() when installDir omitted', async () => {
    mockedRunDetect.mockResolvedValue({
      integration: null,
      frameworkName: null,
      confidence: 'none',
      signals: [],
    });

    const tool = fake.tools.find((t) => t.name === 'detect_framework')!;
    await tool.handler({});
    expect(mockedRunDetect).toHaveBeenCalledWith(process.cwd());
  });

  it('get_project_status forwards to runStatus and returns its payload', async () => {
    const statusPayload = {
      installDir: '/p',
      framework: { integration: null, name: null },
      amplitudeInstalled: { installed: false },
      apiKey: { configured: false, source: null },
      auth: { loggedIn: false, email: null, zone: null },
    };
    // runStatus's type is strict; cast to any since we're just echoing in tests.
    mockedRunStatus.mockResolvedValue(
      statusPayload as unknown as Awaited<ReturnType<typeof runStatus>>,
    );

    const tool = fake.tools.find((t) => t.name === 'get_project_status')!;
    const result = await tool.handler({ installDir: '/p' });

    expect(mockedRunStatus).toHaveBeenCalledWith('/p');
    expect(parseToolResult(result)).toEqual(statusPayload);
  });

  it('get_auth_status forwards to getAuthStatus', async () => {
    mockedGetAuthStatus.mockReturnValue({
      loggedIn: false,
      user: null,
      tokenExpiresAt: null,
    });

    const tool = fake.tools.find((t) => t.name === 'get_auth_status')!;
    const result = await tool.handler({});

    expect(mockedGetAuthStatus).toHaveBeenCalledTimes(1);
    expect(parseToolResult(result)).toEqual({
      loggedIn: false,
      user: null,
      tokenExpiresAt: null,
    });
  });

  it('get_auth_token returns { token: null, ... } when not logged in (does not throw)', async () => {
    mockedGetAuthToken.mockReturnValue({
      token: null,
      expiresAt: null,
      zone: null,
    });

    const tool = fake.tools.find((t) => t.name === 'get_auth_token')!;
    const result = await tool.handler({});

    expect(mockedGetAuthToken).toHaveBeenCalledTimes(1);
    expect(parseToolResult(result)).toEqual({
      token: null,
      expiresAt: null,
      zone: null,
    });
  });

  it('get_auth_token returns the access token when logged in', async () => {
    mockedGetAuthToken.mockReturnValue({
      token: 'oauth-token-xyz',
      expiresAt: '2099-01-01T00:00:00.000Z',
      zone: 'US',
    });

    const tool = fake.tools.find((t) => t.name === 'get_auth_token')!;
    const parsed = parseToolResult(await tool.handler({})) as {
      token: string | null;
    };
    expect(parsed.token).toBe('oauth-token-xyz');
  });
});
