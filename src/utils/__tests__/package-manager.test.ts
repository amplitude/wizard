import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../telemetry', () => ({
  traceStep: (_name: string, fn: () => unknown) => fn(),
}));

vi.mock('../analytics', () => ({
  analytics: {
    setTag: vi.fn(),
    setSessionProperty: vi.fn(),
    wizardCapture: vi.fn(),
  },
}));

vi.mock('../setup-utils', () => ({
  getPackageDotJson: vi.fn(),
  updatePackageDotJson: vi.fn(),
}));

import {
  BUN,
  YARN_V1,
  YARN_V2,
  PNPM,
  NPM,
  EXPO,
  detectAllPackageManagers,
} from '../package-manager.js';
import { getPackageDotJson, updatePackageDotJson } from '../setup-utils.js';
import { analytics } from '../analytics.js';

// ── detect functions ──────────────────────────────────────────────────────────

describe('BUN.detect', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when bun.lockb is present', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '', 'utf-8');
    expect(BUN.detect({ installDir: tmpDir })).toBe(true);
  });

  it('returns true when bun.lock is present', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '', 'utf-8');
    expect(BUN.detect({ installDir: tmpDir })).toBe(true);
  });

  it('returns false when no bun lock file is present', () => {
    expect(BUN.detect({ installDir: tmpDir })).toBe(false);
  });
});

describe('YARN_V1.detect', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when yarn.lock contains "yarn lockfile v1"', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'yarn.lock'),
      '# yarn lockfile v1\n\n',
      'utf-8',
    );
    expect(YARN_V1.detect({ installDir: tmpDir })).toBe(true);
  });

  it('returns false when yarn.lock contains __metadata (v2+)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'yarn.lock'),
      '__metadata:\n  version: 8\n',
      'utf-8',
    );
    expect(YARN_V1.detect({ installDir: tmpDir })).toBe(false);
  });

  it('returns false when yarn.lock is absent', () => {
    expect(YARN_V1.detect({ installDir: tmpDir })).toBe(false);
  });
});

describe('YARN_V2.detect', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when yarn.lock contains __metadata', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'yarn.lock'),
      '__metadata:\n  version: 8\n',
      'utf-8',
    );
    expect(YARN_V2.detect({ installDir: tmpDir })).toBe(true);
  });

  it('returns false when yarn.lock is a v1 lockfile', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'yarn.lock'),
      '# yarn lockfile v1\n\n',
      'utf-8',
    );
    expect(YARN_V2.detect({ installDir: tmpDir })).toBe(false);
  });

  it('returns false when yarn.lock is absent', () => {
    expect(YARN_V2.detect({ installDir: tmpDir })).toBe(false);
  });
});

describe('PNPM.detect', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when pnpm-lock.yaml is present', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '', 'utf-8');
    expect(PNPM.detect({ installDir: tmpDir })).toBe(true);
  });

  it('returns false when pnpm-lock.yaml is absent', () => {
    expect(PNPM.detect({ installDir: tmpDir })).toBe(false);
  });
});

describe('NPM.detect', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when package-lock.json is present', () => {
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}', 'utf-8');
    expect(NPM.detect({ installDir: tmpDir })).toBe(true);
  });

  it('returns false when package-lock.json is absent', () => {
    expect(NPM.detect({ installDir: tmpDir })).toBe(false);
  });
});

describe('EXPO.detect', () => {
  it('always returns false', () => {
    expect(EXPO.detect({ installDir: '/any/dir' })).toBe(false);
  });
});

// ── detectAllPackageManagers ──────────────────────────────────────────────────

describe('detectAllPackageManagers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects bun when bun.lock is present', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '', 'utf-8');
    const result = detectAllPackageManagers({ installDir: tmpDir });
    expect(result.map((pm) => pm.name)).toContain('bun');
  });

  it('detects pnpm when pnpm-lock.yaml is present', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '', 'utf-8');
    const result = detectAllPackageManagers({ installDir: tmpDir });
    expect(result.map((pm) => pm.name)).toContain('pnpm');
  });

  it('returns empty array and calls analytics.setSessionProperty when nothing detected', () => {
    vi.mocked(analytics.setSessionProperty).mockClear();
    const result = detectAllPackageManagers({ installDir: tmpDir });
    expect(result).toHaveLength(0);
    expect(analytics.setSessionProperty).toHaveBeenCalledWith(
      'package manager',
      'not-detected',
    );
  });
});

// ── addOverride ───────────────────────────────────────────────────────────────

describe('BUN.addOverride', () => {
  it('sets overrides in package.json', async () => {
    vi.mocked(getPackageDotJson).mockResolvedValue({ name: 'test' } as never);
    vi.mocked(updatePackageDotJson).mockResolvedValue(undefined);

    await BUN.addOverride('some-pkg', '1.0.0', { installDir: '/tmp/test' });

    expect(updatePackageDotJson).toHaveBeenCalledWith(
      expect.objectContaining({ overrides: { 'some-pkg': '1.0.0' } }),
      { installDir: '/tmp/test' },
    );
  });

  it('merges into existing overrides', async () => {
    vi.mocked(getPackageDotJson).mockResolvedValue({
      name: 'test',
      overrides: { 'existing-pkg': '2.0.0' },
    } as never);
    vi.mocked(updatePackageDotJson).mockResolvedValue(undefined);

    await BUN.addOverride('new-pkg', '3.0.0', { installDir: '/tmp/test' });

    expect(updatePackageDotJson).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: { 'existing-pkg': '2.0.0', 'new-pkg': '3.0.0' },
      }),
      { installDir: '/tmp/test' },
    );
  });
});

describe('YARN_V1.addOverride', () => {
  it('sets resolutions in package.json', async () => {
    vi.mocked(getPackageDotJson).mockResolvedValue({ name: 'test' } as never);
    vi.mocked(updatePackageDotJson).mockResolvedValue(undefined);

    await YARN_V1.addOverride('some-pkg', '1.0.0', { installDir: '/tmp/test' });

    expect(updatePackageDotJson).toHaveBeenCalledWith(
      expect.objectContaining({ resolutions: { 'some-pkg': '1.0.0' } }),
      { installDir: '/tmp/test' },
    );
  });
});

describe('YARN_V2.addOverride', () => {
  it('sets resolutions in package.json', async () => {
    vi.mocked(getPackageDotJson).mockResolvedValue({ name: 'test' } as never);
    vi.mocked(updatePackageDotJson).mockResolvedValue(undefined);

    await YARN_V2.addOverride('some-pkg', '1.0.0', { installDir: '/tmp/test' });

    expect(updatePackageDotJson).toHaveBeenCalledWith(
      expect.objectContaining({ resolutions: { 'some-pkg': '1.0.0' } }),
      { installDir: '/tmp/test' },
    );
  });
});

describe('PNPM.addOverride', () => {
  it('sets pnpm.overrides in package.json', async () => {
    vi.mocked(getPackageDotJson).mockResolvedValue({ name: 'test' } as never);
    vi.mocked(updatePackageDotJson).mockResolvedValue(undefined);

    await PNPM.addOverride('some-pkg', '1.0.0', { installDir: '/tmp/test' });

    expect(updatePackageDotJson).toHaveBeenCalledWith(
      expect.objectContaining({
        pnpm: { overrides: { 'some-pkg': '1.0.0' } },
      }),
      { installDir: '/tmp/test' },
    );
  });

  it('merges into existing pnpm.overrides', async () => {
    vi.mocked(getPackageDotJson).mockResolvedValue({
      name: 'test',
      pnpm: { overrides: { 'existing-pkg': '2.0.0' } },
    } as never);
    vi.mocked(updatePackageDotJson).mockResolvedValue(undefined);

    await PNPM.addOverride('new-pkg', '3.0.0', { installDir: '/tmp/test' });

    expect(updatePackageDotJson).toHaveBeenCalledWith(
      expect.objectContaining({
        pnpm: { overrides: { 'existing-pkg': '2.0.0', 'new-pkg': '3.0.0' } },
      }),
      { installDir: '/tmp/test' },
    );
  });
});

describe('NPM.addOverride', () => {
  it('sets overrides in package.json', async () => {
    vi.mocked(getPackageDotJson).mockResolvedValue({ name: 'test' } as never);
    vi.mocked(updatePackageDotJson).mockResolvedValue(undefined);

    await NPM.addOverride('some-pkg', '1.0.0', { installDir: '/tmp/test' });

    expect(updatePackageDotJson).toHaveBeenCalledWith(
      expect.objectContaining({ overrides: { 'some-pkg': '1.0.0' } }),
      { installDir: '/tmp/test' },
    );
  });
});

describe('EXPO.addOverride', () => {
  it('sets overrides in package.json', async () => {
    vi.mocked(getPackageDotJson).mockResolvedValue({ name: 'test' } as never);
    vi.mocked(updatePackageDotJson).mockResolvedValue(undefined);

    await EXPO.addOverride('some-pkg', '1.0.0', { installDir: '/tmp/test' });

    expect(updatePackageDotJson).toHaveBeenCalledWith(
      expect.objectContaining({ overrides: { 'some-pkg': '1.0.0' } }),
      { installDir: '/tmp/test' },
    );
  });
});
