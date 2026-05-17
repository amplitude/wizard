import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDotGitignore } from '../file-utils.js';
import { createTempDir } from './helpers/temp-dir.js';

describe('getDotGitignore', () => {
  let tmpDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ dir: tmpDir, cleanup } = createTempDir('file-utils-test-'));
  });

  afterEach(() => {
    cleanup();
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
