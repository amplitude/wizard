/**
 * Unit tests for FileChangeLedger.
 *
 * Covers the rollback behaviour the cancel-rollback PR introduces:
 *   - capture before/after for create / modify / delete
 *   - first-write-wins for repeated writes to the same path
 *   - rollback restores `.gitignore` and removes new `.amplitude/`
 *   - rollback is idempotent
 *   - paths outside the install directory are ignored
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FileChangeLedger,
  initFileChangeLedger,
  getFileChangeLedger,
  resetFileChangeLedger,
} from '../file-change-ledger';

describe('FileChangeLedger', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), 'wiz-ledger-'));
    resetFileChangeLedger();
  });

  afterEach(() => {
    rmSync(installDir, { recursive: true, force: true });
    resetFileChangeLedger();
  });

  describe('capture', () => {
    it('records a create entry when the file did not exist', () => {
      const ledger = new FileChangeLedger(installDir);
      const target = join(installDir, 'src', 'foo.ts');
      ledger.recordPreWrite(target);
      // Simulate the agent's write
      mkdirSync(join(installDir, 'src'), { recursive: true });
      writeFileSync(target, 'const x = 1;\n');
      ledger.recordPostWrite(target, 'const x = 1;\n');

      const entries = ledger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        path: target,
        kind: 'create',
        beforeContent: null,
        afterContent: 'const x = 1;\n',
      });
    });

    it('records a modify entry when the file already exists', () => {
      const target = join(installDir, 'README.md');
      writeFileSync(target, '# original\n');
      const ledger = new FileChangeLedger(installDir);
      ledger.recordPreWrite(target);
      writeFileSync(target, '# modified by agent\n');
      ledger.recordPostWrite(target, '# modified by agent\n');

      const [entry] = ledger.getEntries();
      expect(entry).toMatchObject({
        path: target,
        kind: 'modify',
        beforeContent: '# original\n',
        afterContent: '# modified by agent\n',
      });
    });

    it('keeps the original beforeContent when the same file is written twice', () => {
      const target = join(installDir, 'app.config');
      writeFileSync(target, 'ORIGINAL');
      const ledger = new FileChangeLedger(installDir);

      ledger.recordPreWrite(target);
      writeFileSync(target, 'FIRST AGENT WRITE');
      ledger.recordPostWrite(target, 'FIRST AGENT WRITE');

      // Second pass: the agent writes again, so its "before" is now
      // "FIRST AGENT WRITE" — but the ledger should keep the truly
      // pre-wizard content ("ORIGINAL").
      ledger.recordPreWrite(target);
      writeFileSync(target, 'SECOND AGENT WRITE');
      ledger.recordPostWrite(target, 'SECOND AGENT WRITE');

      const entries = ledger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].beforeContent).toBe('ORIGINAL');
      expect(entries[0].afterContent).toBe('SECOND AGENT WRITE');
    });

    it('ignores paths outside the install directory', () => {
      const outside = mkdtempSync(join(tmpdir(), 'wiz-outside-'));
      try {
        const target = join(outside, 'leaked.ts');
        writeFileSync(target, 'pre');
        const ledger = new FileChangeLedger(installDir);
        ledger.recordPreWrite(target);
        ledger.recordPostWrite(target, 'post');
        expect(ledger.getEntries()).toHaveLength(0);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  describe('rollback', () => {
    it('reverts a modify entry by writing beforeContent back', () => {
      const target = join(installDir, 'src', 'foo.ts');
      mkdirSync(join(installDir, 'src'), { recursive: true });
      writeFileSync(target, 'export const ORIGINAL = true;\n');
      const ledger = new FileChangeLedger(installDir);
      ledger.recordPreWrite(target);
      writeFileSync(target, 'export const AGENT = true;\n');
      ledger.recordPostWrite(target, 'export const AGENT = true;\n');

      const result = ledger.rollback();
      expect(result.filesReverted).toBe(1);
      expect(result.filesRemoved).toBe(0);
      expect(readFileSync(target, 'utf8')).toBe(
        'export const ORIGINAL = true;\n',
      );
    });

    it('removes a created file', () => {
      const ledger = new FileChangeLedger(installDir);
      const target = join(installDir, 'fresh.ts');
      ledger.recordPreWrite(target);
      writeFileSync(target, 'agent wrote me');
      ledger.recordPostWrite(target, 'agent wrote me');

      const result = ledger.rollback();
      expect(result.filesRemoved).toBe(1);
      expect(result.filesReverted).toBe(0);
      expect(existsSync(target)).toBe(false);
    });

    it('is idempotent — second rollback is a no-op', () => {
      const target = join(installDir, 'foo.ts');
      writeFileSync(target, 'pre');
      const ledger = new FileChangeLedger(installDir);
      ledger.recordPreWrite(target);
      writeFileSync(target, 'post');
      ledger.recordPostWrite(target, 'post');

      const first = ledger.rollback();
      expect(first.filesReverted).toBe(1);

      // Mutate the file again — a second rollback must NOT touch it.
      writeFileSync(target, 'user touched after rollback');
      const second = ledger.rollback();
      expect(second.filesReverted).toBe(0);
      expect(second.filesRemoved).toBe(0);
      expect(readFileSync(target, 'utf8')).toBe('user touched after rollback');
    });

    it('restores .gitignore captured by capturePreamble', () => {
      const gitignore = join(installDir, '.gitignore');
      writeFileSync(gitignore, 'node_modules/\n');
      const ledger = new FileChangeLedger(installDir);
      ledger.capturePreamble();
      // Simulate the agent appending .amplitude/ via Edit (not tracked
      // here for simplicity — the preamble path covers it).
      writeFileSync(gitignore, 'node_modules/\n.amplitude/\n');

      const result = ledger.rollback();
      expect(result.filesReverted).toBeGreaterThanOrEqual(1);
      expect(readFileSync(gitignore, 'utf8')).toBe('node_modules/\n');
    });

    it('removes .gitignore if it did not exist before the run', () => {
      const ledger = new FileChangeLedger(installDir);
      ledger.capturePreamble();
      const gitignore = join(installDir, '.gitignore');
      writeFileSync(gitignore, '.amplitude/\n');

      ledger.rollback();
      expect(existsSync(gitignore)).toBe(false);
    });

    it('removes .amplitude/ when it did not exist before the run', () => {
      const ledger = new FileChangeLedger(installDir);
      ledger.capturePreamble();
      const ampDir = join(installDir, '.amplitude');
      mkdirSync(ampDir);
      writeFileSync(join(ampDir, 'events.json'), '{}');

      ledger.rollback();
      expect(existsSync(ampDir)).toBe(false);
    });

    it('preserves .amplitude/ when it existed before the run', () => {
      const ampDir = join(installDir, '.amplitude');
      mkdirSync(ampDir);
      writeFileSync(join(ampDir, 'pre-existing.json'), '{"keep":true}');
      const ledger = new FileChangeLedger(installDir);
      ledger.capturePreamble();

      ledger.rollback();
      expect(existsSync(ampDir)).toBe(true);
      expect(readFileSync(join(ampDir, 'pre-existing.json'), 'utf8')).toBe(
        '{"keep":true}',
      );
    });
  });

  describe('module singleton', () => {
    it('initFileChangeLedger / getFileChangeLedger / reset round trip', () => {
      expect(getFileChangeLedger()).toBeNull();
      const ledger = initFileChangeLedger(installDir);
      expect(getFileChangeLedger()).toBe(ledger);
      resetFileChangeLedger();
      expect(getFileChangeLedger()).toBeNull();
    });
  });
});
