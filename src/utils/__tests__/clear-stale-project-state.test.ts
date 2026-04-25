import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { clearStaleProjectState } from '../clear-stale-project-state.js';

const mockExecSync = vi.mocked(execSync);
const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

function checkpointPathFor(installDir: string): string {
  const hash = createHash('sha256')
    .update(installDir)
    .digest('hex')
    .slice(0, 12);
  return path.join(os.tmpdir(), `amplitude-wizard-checkpoint-${hash}.json`);
}

describe('clearStaleProjectState', () => {
  let tmpDir: string;
  let checkpointPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clear-stale-test-'));
    checkpointPath = checkpointPathFor(tmpDir);
    mockExecSync.mockReset();
    setPlatform('darwin');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);
    setPlatform(originalPlatform);
  });

  it('strips AMPLITUDE_API_KEY from .env.local while preserving other vars', () => {
    const envPath = path.join(tmpDir, '.env.local');
    fs.writeFileSync(
      envPath,
      'OTHER_VAR=keepme\nAMPLITUDE_API_KEY=stale_key\nANOTHER=alsokeep\n',
    );

    clearStaleProjectState(tmpDir);

    const contents = fs.readFileSync(envPath, 'utf8');
    expect(contents).not.toContain('AMPLITUDE_API_KEY');
    expect(contents).toContain('OTHER_VAR=keepme');
    expect(contents).toContain('ANOTHER=alsokeep');
  });

  it('deletes the checkpoint file at the per-installDir hashed path', () => {
    fs.writeFileSync(
      checkpointPath,
      JSON.stringify({ installDir: tmpDir, savedAt: new Date().toISOString() }),
    );
    expect(fs.existsSync(checkpointPath)).toBe(true);

    clearStaleProjectState(tmpDir);

    expect(fs.existsSync(checkpointPath)).toBe(false);
  });

  it('strips OrgId/WorkspaceId/Zone from project ampli.json while preserving tracking-plan fields', () => {
    const ampliJsonPath = path.join(tmpDir, 'ampli.json');
    fs.writeFileSync(
      ampliJsonPath,
      JSON.stringify({
        OrgId: 'old-org',
        WorkspaceId: 'old-ws',
        Zone: 'us',
        SourceId: 'src-1',
        Branch: 'main',
        Version: '42.0.0',
      }),
    );

    clearStaleProjectState(tmpDir);

    const result = JSON.parse(fs.readFileSync(ampliJsonPath, 'utf8'));
    expect(result.OrgId).toBeUndefined();
    expect(result.WorkspaceId).toBeUndefined();
    expect(result.Zone).toBeUndefined();
    expect(result.SourceId).toBe('src-1');
    expect(result.Branch).toBe('main');
    expect(result.Version).toBe('42.0.0');
  });

  it('attempts to delete the keychain entry on macOS', () => {
    mockExecSync.mockReturnValue('' as ReturnType<typeof execSync>);

    clearStaleProjectState(tmpDir);

    const calls = mockExecSync.mock.calls.map(([cmd]) => String(cmd));
    expect(
      calls.some(
        (cmd) =>
          cmd.includes('security delete-generic-password') &&
          cmd.includes('amplitude-wizard'),
      ),
    ).toBe(true);
  });

  it('is a no-op when no prior state exists', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not found');
    });

    expect(() => clearStaleProjectState(tmpDir)).not.toThrow();
    expect(fs.existsSync(checkpointPath)).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.env.local'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'ampli.json'))).toBe(false);
  });
});
