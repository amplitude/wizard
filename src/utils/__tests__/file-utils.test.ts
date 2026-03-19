import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getDotGitignore } from '../file-utils.js';

describe('getDotGitignore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-utils-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the .gitignore path when it exists', () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    fs.writeFileSync(gitignorePath, '', 'utf-8');
    expect(getDotGitignore({ installDir: tmpDir })).toBe(gitignorePath);
  });

  it('returns undefined when .gitignore does not exist', () => {
    expect(getDotGitignore({ installDir: tmpDir })).toBeUndefined();
  });
});
