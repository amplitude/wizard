/**
 * Integration test for the cancel-rollback flow.
 *
 * Simulates a wizard run by driving the FileChangeLedger directly with
 * the same shape of recordings the PostToolUse hook would issue, then
 * runs `rollback()` and asserts the working tree matches the snapshot
 * we captured before the simulation started.
 *
 * Mirrors the failure scenario from the user feedback that surfaced
 * this gap (PR #579 closed the setup-report half; this one closes the
 * full rollback): a cancelled run had previously left modified
 * `.gitignore`, a new `.amplitude/` directory, and an instrumented
 * source file behind.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { FileChangeLedger } from '../file-change-ledger';
import { createTempDir } from '../../utils/__tests__/helpers/temp-dir.js';

interface TreeSnapshot {
  files: Record<string, string>;
  dirs: string[];
}

function snapshotTree(root: string): TreeSnapshot {
  const files: Record<string, string> = {};
  const dirs: string[] = [];
  const walk = (rel: string): void => {
    const abs = join(root, rel);
    const entries = readdirSync(abs, { withFileTypes: true });
    for (const entry of entries) {
      const childRel = rel ? join(rel, entry.name) : entry.name;
      const childAbs = join(root, childRel);
      if (entry.isDirectory()) {
        dirs.push(childRel);
        walk(childRel);
      } else if (entry.isFile()) {
        files[childRel] = readFileSync(childAbs, 'utf8');
      }
    }
  };
  walk('');
  // Sort so equality checks are order-independent.
  dirs.sort();
  return { files, dirs };
}

describe('cancel-rollback integration', () => {
  let installDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ dir: installDir, cleanup } = createTempDir('wiz-rollback-int-'));
  });

  afterEach(() => {
    cleanup();
  });

  it('restores the working tree after a simulated cancelled run', () => {
    // ── Arrange: build a realistic project layout ─────────────────
    mkdirSync(join(installDir, 'src'));
    writeFileSync(
      join(installDir, '.gitignore'),
      'node_modules/\ndist/\n.env\n',
    );
    writeFileSync(
      join(installDir, 'src', 'app.ts'),
      "console.log('hello world');\n",
    );
    writeFileSync(
      join(installDir, 'package.json'),
      JSON.stringify({ name: 'example', version: '1.0.0' }, null, 2),
    );

    const before = snapshotTree(installDir);

    // ── Act: simulate a wizard run that touches three artifacts ───
    const ledger = new FileChangeLedger(installDir);
    ledger.capturePreamble();

    // 1. Modify the source file (instrumentation).
    const appPath = join(installDir, 'src', 'app.ts');
    ledger.recordPreWrite(appPath);
    const instrumented =
      "import { track } from '@amplitude/analytics-browser';\n" +
      "console.log('hello world');\n" +
      "track('app started');\n";
    writeFileSync(appPath, instrumented);
    ledger.recordPostWrite(appPath, instrumented);

    // 2. Append an entry to .gitignore.
    const gitignore = join(installDir, '.gitignore');
    ledger.recordPreWrite(gitignore);
    writeFileSync(gitignore, 'node_modules/\ndist/\n.env\n.amplitude/\n');
    ledger.recordPostWrite(
      gitignore,
      'node_modules/\ndist/\n.env\n.amplitude/\n',
    );

    // 3. Create the .amplitude/ config directory + events.json.
    const ampDir = join(installDir, '.amplitude');
    mkdirSync(ampDir);
    const eventsJson = join(ampDir, 'events.json');
    ledger.recordPreWrite(eventsJson);
    const eventsBody = JSON.stringify(
      { events: [{ name: 'app started' }] },
      null,
      2,
    );
    writeFileSync(eventsJson, eventsBody);
    ledger.recordPostWrite(eventsJson, eventsBody);

    // Sanity: agent's writes should be visible in the tree.
    expect(readFileSync(appPath, 'utf8')).toBe(instrumented);
    expect(existsSync(ampDir)).toBe(true);

    // ── Cancel: roll the ledger back ─────────────────────────────
    const result = ledger.rollback();
    expect(result.failures).toEqual([]);
    expect(result.filesReverted).toBeGreaterThanOrEqual(2);
    expect(result.filesRemoved).toBeGreaterThanOrEqual(1);

    // ── Assert: working tree exactly matches the pre-run snapshot ─
    const after = snapshotTree(installDir);
    expect(after).toEqual(before);
  });

  it('does not synthesize a setup report on cancel (regression for #579)', () => {
    // The setup-report fix from PR #579 lives outside this module — we
    // verify the ledger never INTRODUCES a synthetic setup report on
    // its own. A cancel path that didn't write a report shouldn't end
    // up with one after rollback.
    const before = snapshotTree(installDir);
    const ledger = new FileChangeLedger(installDir);
    ledger.capturePreamble();
    ledger.rollback();
    const after = snapshotTree(installDir);
    expect(after).toEqual(before);
    expect(existsSync(join(installDir, 'amplitude-setup-report.md'))).toBe(
      false,
    );
  });

  it('does not touch user-edited files outside the agent write set', () => {
    // The wizard captures only files the agent wrote. If the user
    // edits a file in another shell during the run, the ledger has
    // no entry for it and the rollback must leave it alone.
    writeFileSync(join(installDir, 'src.ts'), 'agent wrote');
    const userTouched = join(installDir, 'user-edited.ts');

    const ledger = new FileChangeLedger(installDir);
    ledger.capturePreamble();
    ledger.recordPreWrite(join(installDir, 'src.ts'));
    writeFileSync(join(installDir, 'src.ts'), 'agent rewrote');
    ledger.recordPostWrite(join(installDir, 'src.ts'), 'agent rewrote');

    // User edits a different file the agent never touched — happens
    // mid-run via the user's own editor.
    writeFileSync(userTouched, 'user content');

    ledger.rollback();
    expect(readFileSync(join(installDir, 'src.ts'), 'utf8')).toBe(
      'agent wrote',
    );
    expect(readFileSync(userTouched, 'utf8')).toBe('user content');
  });
});
