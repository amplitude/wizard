/**
 * OutroScreen — cancel-outro file-state line (TUI Auditor T4).
 *
 * Pins the empathy fix where the cancel branch reports whether files
 * were touched, instead of leaving the user to `git status` to find
 * out. Mirrors the explicitness the error+preserveFiles path already
 * has.
 *
 *   - Empty ledger    → "No files were changed."
 *   - N > 0 entries   → "Reverted N file(s) the wizard had started
 *                        writing." (rollback already ran in the
 *                        agent-runner's cleanup hook; we just report
 *                        the count.)
 *   - Ledger absent   → line is omitted (we don't know either way).
 *
 * Success / error outros are covered by their own tests; this file
 * only asserts behaviour scoped to the cancel branch.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OutroScreen } from '../OutroScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';
import { OutroKind } from '../../session-constants.js';
import {
  initFileChangeLedger,
  resetFileChangeLedger,
} from '../../../../lib/file-change-ledger.js';

describe('OutroScreen — cancel file-state line', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), 'outro-cancel-fs-'));
    resetFileChangeLedger();
  });

  afterEach(() => {
    resetFileChangeLedger();
    try {
      rmSync(installDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('renders "No files were changed." when the ledger is empty', () => {
    // Ledger is initialised but no writes were captured — typical of a
    // cancel that fires before the agent issues its first Write/Edit.
    initFileChangeLedger(installDir, () => undefined);

    const store = makeStoreForSnapshot({
      installDir,
      outroData: {
        kind: OutroKind.Cancel,
        message: 'Setup cancelled.',
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Setup cancelled');
    expect(frame).toContain('No files were changed.');
    expect(frame).not.toMatch(/Reverted \d+ file/);
  });

  it('renders the reverted-file count when the ledger has entries', () => {
    // Seed two tracked writes. The agent-runner's cleanup hook would
    // have already rolled these back by the time the cancel outro
    // mounts in production; the ledger's entries persist, only its
    // `rolledBack` flag flips. The outro reads `size()` to surface the
    // count.
    const ledger = initFileChangeLedger(installDir, () => undefined);

    const a = join(installDir, 'src', 'a.ts');
    const b = join(installDir, 'src', 'b.ts');
    mkdirSync(join(installDir, 'src'), { recursive: true });
    ledger.recordPreWrite(a);
    writeFileSync(a, 'aaa\n');
    ledger.recordPostWrite(a, 'aaa\n');
    ledger.recordPreWrite(b);
    writeFileSync(b, 'bbb\n');
    ledger.recordPostWrite(b, 'bbb\n');

    const store = makeStoreForSnapshot({
      installDir,
      outroData: {
        kind: OutroKind.Cancel,
        message: 'Setup cancelled.',
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Setup cancelled');
    expect(frame).toContain('Reverted 2 files the wizard had started writing.');
    expect(frame).not.toContain('No files were changed.');
  });

  it('uses singular "file" when exactly one entry was reverted', () => {
    const ledger = initFileChangeLedger(installDir, () => undefined);
    const a = join(installDir, 'only.ts');
    ledger.recordPreWrite(a);
    writeFileSync(a, 'x\n');
    ledger.recordPostWrite(a, 'x\n');

    const store = makeStoreForSnapshot({
      installDir,
      outroData: {
        kind: OutroKind.Cancel,
        message: 'Setup cancelled.',
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Reverted 1 file the wizard had started writing.');
    // Defensive: don't accidentally pluralise.
    expect(frame).not.toContain('Reverted 1 files');
  });

  it('omits the line entirely when no ledger has been initialised', () => {
    // Pre-agent cancel paths (or test fixtures that never wire a
    // ledger) — we deliberately omit the line rather than asserting "0
    // files" with uncertainty. Preserves the long-standing cancel
    // snapshot.
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Cancel,
        message: 'Setup cancelled.',
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Setup cancelled');
    expect(frame).not.toContain('No files were changed.');
    expect(frame).not.toMatch(/Reverted \d+ file/);
  });

  it('does NOT render the file-state line on the success outro', () => {
    // Even if a ledger exists (it always does in production), the
    // file-state line is scoped to the cancel branch. Success outros
    // already show the changes list; an extra "Reverted ..." line
    // would be misleading there.
    const ledger = initFileChangeLedger(installDir, () => undefined);
    const f = join(installDir, 'kept.ts');
    ledger.recordPreWrite(f);
    writeFileSync(f, 'kept\n');
    ledger.recordPostWrite(f, 'kept\n');

    const store = makeStoreForSnapshot({
      installDir,
      outroData: {
        kind: OutroKind.Success,
        changes: ['Installed @amplitude/analytics-browser'],
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).not.toContain('No files were changed.');
    expect(frame).not.toMatch(/Reverted \d+ file/);
  });

  it('does NOT render the file-state line on the error outro', () => {
    // Error outros have their own preserveFiles prompt + Reverted
    // confirmation. The cancel line must not leak in there.
    const ledger = initFileChangeLedger(installDir, () => undefined);
    const f = join(installDir, 'touched.ts');
    ledger.recordPreWrite(f);
    writeFileSync(f, 'touched\n');
    ledger.recordPostWrite(f, 'touched\n');

    const store = makeStoreForSnapshot({
      installDir,
      outroData: {
        kind: OutroKind.Error,
        message: 'Generic failure.',
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).not.toContain('No files were changed.');
    expect(frame).not.toMatch(/^.*Reverted \d+ file.* the wizard had started writing/m);
  });
});
