import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryGetPackageJson } from '../package-json-light.js';

describe('tryGetPackageJson', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-json-light-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when package.json is an array (invalid manifest)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '[1,2]');
    await expect(tryGetPackageJson({ installDir: tmpDir })).resolves.toBeNull();
  });

  it('returns null when package.json is a JSON primitive', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '42');
    await expect(tryGetPackageJson({ installDir: tmpDir })).resolves.toBeNull();
  });

  it('parses a normal object manifest', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { a: '1' } }),
    );
    const pkg = await tryGetPackageJson({ installDir: tmpDir });
    expect(pkg?.name).toBe('x');
    expect(pkg?.dependencies?.a).toBe('1');
  });
});
