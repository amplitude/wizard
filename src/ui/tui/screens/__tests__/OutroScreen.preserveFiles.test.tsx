/**
 * OutroScreen — `preserveFiles` prompt coverage.
 *
 * Pins the post-mortem fix where an LLM-gateway AUTH_ERROR at the very
 * end of a 35-minute run discarded ten files of correct work because
 * the cleanup hook auto-reverted the file-change ledger. The fix:
 *
 *   1. agent-runner sets `preserveFiles: true` on the AUTH_ERROR outro.
 *   2. The cleanup hook now skips the auto-revert when the flag is set.
 *   3. The OutroScreen surfaces a `[K] Keep / [R] Revert` choice. K is
 *      the safe default; R triggers the same revert path manually.
 *
 * The tests below cover (1) the prompt rendering, (2) K leaves the
 * ledger intact, and (3) R reverts the ledger and shows a confirmation.
 */

import React from 'react';
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createTempDir } from '../../../../utils/__tests__/helpers/temp-dir.js';
import { render } from 'ink-testing-library';

vi.mock('../../utils/outro-mode.js', () => ({
  isInteractiveOutro: vi.fn(() => true),
}));

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

describe('OutroScreen — preserveFiles prompt (AUTH_ERROR carve-out)', () => {
  let installDir: string;

  // Stub process.exit at the file level so the fire-and-forget
  // `wizardSuccessExit` chain triggered by the K keystroke can't escape
  // a single test's lifetime and throw via vitest's interceptor under
  // CI load. The previous per-test `vi.spyOn(process, 'exit')` /
  // `mockRestore()` pattern had a race where the async chain landed
  // after the spy was restored, hitting the real `process.exit`.
  let exitSpy: ReturnType<typeof vi.spyOn<typeof process, 'exit'>> | undefined;
  beforeAll(() => {
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
  });
  afterAll(() => {
    exitSpy?.mockRestore();
  });

  let cleanupDir: () => void;
  beforeEach(() => {
    ({ dir: installDir, cleanup: cleanupDir } = createTempDir('outro-preserve-'));
    resetFileChangeLedger();
  });

  afterEach(() => {
    resetFileChangeLedger();
    try {
      cleanupDir();
    } catch {
      /* best-effort */
    }
  });

  it('renders the [K] Keep / [R] Revert prompt when preserveFiles is set', () => {
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Error,
        message: 'Authentication failed.',
        promptLogin: true,
        preserveFiles: true,
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Setup failed');
    expect(frame).toContain('Your changes are still on disk');
    // Both keys are advertised, K is labelled the default.
    expect(frame).toMatch(/Press\s+K\s+to keep/i);
    expect(frame).toMatch(/Press\s+R\s+to revert/i);
    expect(frame).toMatch(/default/i);
  });

  it('does NOT render the prompt on a regular error outro (preserveFiles unset)', () => {
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Error,
        message: 'Generic failure.',
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Setup failed');
    expect(frame).not.toContain('Your changes are still on disk');
    expect(frame).not.toMatch(/Press\s+K\s+to keep/i);
  });

  // ── K → keep changes (ledger NOT rolled back) ──────────────────────────
  it('pressing K leaves the ledger intact (files preserved on disk)', async () => {
    // Seed a ledger with one tracked agent write so we can prove the
    // file is still there after K.
    const ledger = initFileChangeLedger(installDir, () => undefined);
    const tracked = join(installDir, 'src', 'instrument.ts');
    mkdirSync(join(installDir, 'src'), { recursive: true });
    ledger.recordPreWrite(tracked);
    writeFileSync(tracked, 'export const wired = true;\n');
    ledger.recordPostWrite(tracked, 'export const wired = true;\n');

    const store = makeStoreForSnapshot({
      installDir,
      outroData: {
        kind: OutroKind.Error,
        message: 'Authentication failed.',
        promptLogin: true,
        preserveFiles: true,
      },
    });
    const { stdin, unmount } = render(<OutroScreen store={store} />);
    // Two ticks so the screen mounts and the input handler is active.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    stdin.write('K');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // The agent's write is still on disk — K did NOT revert it.
    expect(existsSync(tracked)).toBe(true);
    expect(readFileSync(tracked, 'utf8')).toBe('export const wired = true;\n');

    unmount();
  });

  // ── R → revert (ledger rolled back, confirmation shown) ────────────────
  it('pressing R reverts the ledger and shows a confirmation', async () => {
    const ledger = initFileChangeLedger(installDir, () => undefined);

    // A modify entry — agent rewrote an existing file.
    const modified = join(installDir, 'README.md');
    writeFileSync(modified, '# original\n');
    ledger.recordPreWrite(modified);
    writeFileSync(modified, '# agent rewrote me\n');
    ledger.recordPostWrite(modified, '# agent rewrote me\n');

    // A create entry — agent wrote a brand-new file.
    const created = join(installDir, 'src', 'instrument.ts');
    mkdirSync(join(installDir, 'src'), { recursive: true });
    ledger.recordPreWrite(created);
    writeFileSync(created, 'export const wired = true;\n');
    ledger.recordPostWrite(created, 'export const wired = true;\n');

    const store = makeStoreForSnapshot({
      installDir,
      outroData: {
        kind: OutroKind.Error,
        message: 'Authentication failed.',
        promptLogin: true,
        preserveFiles: true,
      },
    });

    const { stdin, lastFrame, unmount } = render(<OutroScreen store={store} />);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    stdin.write('R');
    // Two ticks so the rollback completes and the confirmation re-renders.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Modify reverted to original content.
    expect(readFileSync(modified, 'utf8')).toBe('# original\n');
    // Created file removed.
    expect(existsSync(created)).toBe(false);

    // Confirmation copy renders (prompt should be replaced).
    const finalFrame = lastFrame() ?? '';
    expect(finalFrame).toMatch(/Reverted the wizard/i);

    unmount();
  });

  it('emits an analytics event for the K resolution', async () => {
    initFileChangeLedger(installDir, () => undefined);
    const store = makeStoreForSnapshot({
      installDir,
      outroData: {
        kind: OutroKind.Error,
        message: 'Authentication failed.',
        promptLogin: true,
        preserveFiles: true,
      },
    });

    const { analytics } = await import('../../../../utils/analytics.js');
    const wizardCaptureSpy = vi
      .spyOn(analytics, 'wizardCapture')
      .mockImplementation(() => undefined);

    const { stdin, unmount } = render(<OutroScreen store={store} />);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    stdin.write('K');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const event = wizardCaptureSpy.mock.calls.find(
      ([name]) => name === 'preserve files resolution',
    );
    expect(event).toBeDefined();
    expect(event?.[1]).toMatchObject({
      resolution: 'kept',
      source: 'keystroke',
    });

    wizardCaptureSpy.mockRestore();
    unmount();
  });

  it('emits an analytics event with file counts for the R resolution', async () => {
    const ledger = initFileChangeLedger(installDir, () => undefined);
    const target = join(installDir, 'foo.ts');
    writeFileSync(target, 'pre');
    ledger.recordPreWrite(target);
    writeFileSync(target, 'post');
    ledger.recordPostWrite(target, 'post');

    const store = makeStoreForSnapshot({
      installDir,
      outroData: {
        kind: OutroKind.Error,
        message: 'Authentication failed.',
        promptLogin: true,
        preserveFiles: true,
      },
    });

    const { analytics } = await import('../../../../utils/analytics.js');
    const wizardCaptureSpy = vi
      .spyOn(analytics, 'wizardCapture')
      .mockImplementation(() => undefined);

    const { stdin, unmount } = render(<OutroScreen store={store} />);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    stdin.write('R');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const event = wizardCaptureSpy.mock.calls.find(
      ([name]) => name === 'preserve files resolution',
    );
    expect(event).toBeDefined();
    expect(event?.[1]).toMatchObject({
      resolution: 'reverted',
      source: 'keystroke',
      'files reverted': 1,
      'files removed': 0,
    });

    wizardCaptureSpy.mockRestore();
    unmount();
  });
});
