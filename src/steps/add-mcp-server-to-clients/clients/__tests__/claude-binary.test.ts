import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import * as fs from 'node:fs';
import { findClaudeBinary, _resetClaudeBinaryCache } from '../claude-binary';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn() };
});

vi.mock('../../../../utils/debug', () => ({
  debug: vi.fn(),
}));

describe('findClaudeBinary', () => {
  const existsSyncMock = fs.existsSync as unknown as Mock;
  const originalPlatform = process.platform;
  const originalPath = process.env.PATH;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetClaudeBinaryCache();
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true,
    });
    process.env.HOME = '/Users/u';
    process.env.PATH = '';
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
    });
    process.env.PATH = originalPath;
    process.env.HOME = originalHome;
  });

  it('returns a user-installed path when present', () => {
    existsSyncMock.mockImplementation(
      (p: string) => p === '/Users/u/.local/bin/claude',
    );
    expect(findClaudeBinary()).toBe('/Users/u/.local/bin/claude');
  });

  it('skips bundled binary under /Library/Application Support and returns a later user path', () => {
    process.env.PATH = '/Users/u/Library/Application Support/Conductor/bin';
    existsSyncMock.mockImplementation(
      (p: string) =>
        p === '/opt/homebrew/bin/claude' ||
        p === '/Users/u/Library/Application Support/Conductor/bin/claude',
    );
    expect(findClaudeBinary()).toBe('/opt/homebrew/bin/claude');
  });

  it('returns null when the only claude on PATH is bundled by the host app', () => {
    process.env.PATH = '/Users/u/Library/Application Support/Conductor/bin';
    existsSyncMock.mockImplementation(
      (p: string) =>
        p === '/Users/u/Library/Application Support/Conductor/bin/claude',
    );
    expect(findClaudeBinary()).toBeNull();
  });

  it('returns a PATH candidate when no bundled-app match', () => {
    process.env.PATH = '/custom/bin';
    existsSyncMock.mockImplementation(
      (p: string) => p === '/custom/bin/claude',
    );
    expect(findClaudeBinary()).toBe('/custom/bin/claude');
  });

  it('returns null when no claude binary exists anywhere', () => {
    existsSyncMock.mockReturnValue(false);
    expect(findClaudeBinary()).toBeNull();
  });

  it('does not apply the bundled-app guard on non-darwin', () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      writable: true,
    });
    process.env.PATH = '/Users/u/Library/Application Support/Conductor/bin';
    existsSyncMock.mockImplementation(
      (p: string) =>
        p === '/Users/u/Library/Application Support/Conductor/bin/claude',
    );
    // On linux, the Application Support heuristic is meaningless — the check
    // is skipped and we accept the candidate.
    expect(findClaudeBinary()).toBe(
      '/Users/u/Library/Application Support/Conductor/bin/claude',
    );
  });
});
