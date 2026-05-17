/**
 * OutroScreen — event-list source-of-truth coverage.
 *
 * Pins the fix where the success outro previously read event names from
 * `store.eventPlan` (Title-Cased by `normalizeEventName` before
 * persistence) and confidently listed every plan event as "instrumented"
 * even when the agent routed half of them through autocapture.
 *
 * The fix reads names from the file-change ledger's `afterContent`
 * snapshots and splits the plan into:
 *
 *   - **Instrumented**: plan event whose name appears in some `track()`
 *     call in a wired file. Rendered with the wired-code casing.
 *   - **Covered by autocapture**: plan event not found in any wired
 *     file. Rendered with the plan's name (no other source to fall
 *     back to).
 *
 * Each test seeds a fresh ledger with synthetic wired file content so
 * the assertion is deterministic — we never have to boot the agent.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { createTempDir } from '../../../../utils/__tests__/helpers/temp-dir.js';

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

/**
 * Seed the per-run ledger with a single fake wired file so the
 * OutroScreen's classifier has something to walk. Returns the absolute
 * path it pretended to write — useful when a test needs to assert on
 * the wired list it produced.
 */
function seedLedgerWith(
  installDir: string,
  relPath: string,
  content: string,
): void {
  const ledger = initFileChangeLedger(installDir, () => undefined);
  const abs = join(installDir, relPath);
  ledger.recordPreWrite(abs);
  ledger.recordPostWrite(abs, content);
}

describe('OutroScreen — success event list reflects wired code', () => {
  let installDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ dir: installDir, cleanup } = createTempDir('outro-events-'));
    resetFileChangeLedger();
  });

  afterEach(() => {
    resetFileChangeLedger();
    try {
      cleanup();
    } catch {
      /* best-effort */
    }
  });

  it('renders both Instrumented and Covered-by-autocapture sections with correct counts', () => {
    // Mirror the live-test scenario: plan has 6 events that got
    // track() calls + 3 that the agent decided to leave to autocapture.
    seedLedgerWith(
      installDir,
      'src/instrument.ts',
      `
        amplitude.track("app loaded");
        amplitude.track("user signed in");
        amplitude.track("collaboration session joined");
        amplitude.track("board created");
        amplitude.track("element added");
        amplitude.track("element moved");
      `,
    );

    const store = makeStoreForSnapshot({
      installDir,
      outroData: { kind: OutroKind.Success, changes: [] },
    });
    // Plan in Title Case (the persisted shape) + three more that won't
    // appear in the wired code.
    store.setEventPlan([
      { name: 'App Loaded', description: 'fires on first paint' },
      { name: 'User Signed In', description: 'after the signin form' },
      {
        name: 'Collaboration Session Joined',
        description: 'user opens a board',
      },
      { name: 'Board Created', description: 'new board' },
      { name: 'Element Added', description: 'shape added' },
      { name: 'Element Moved', description: 'shape dragged' },
      { name: 'Page Viewed', description: 'autocaptured page nav' },
      { name: 'Element Clicked', description: 'autocaptured click' },
      { name: 'Session Start', description: 'autocaptured by SDK' },
    ]);

    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);

    // The new section headers and counts are visible.
    expect(frame).toMatch(/Instrumented \(6 events with track\(\) calls\)/);
    expect(frame).toMatch(
      /Covered by autocapture \(3 events — no track\(\) needed\)/,
    );

    // Tally line mirrors the Setup Report copy.
    expect(frame).toContain('6 events instrumented · 3 covered by autocapture');
  });

  it('renders wired-code casing (lowercase) even when the plan is Title Case', () => {
    // Direct regression for the live bug: code says "app loaded", plan
    // says "App Loaded" — the celebration must show the code-truth
    // casing.
    seedLedgerWith(
      installDir,
      'src/instrument.ts',
      `amplitude.track("app loaded");`,
    );
    const store = makeStoreForSnapshot({
      installDir,
      outroData: { kind: OutroKind.Success, changes: [] },
    });
    store.setEventPlan([
      { name: 'App Loaded', description: 'fires on first paint' },
    ]);

    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('app loaded');
    // The plan's Title-Cased name must NOT appear — that was the bug.
    // We check on a word-boundary match so "app loaded" doesn't
    // accidentally satisfy a "App Loaded" substring search.
    expect(frame).not.toMatch(/\bApp Loaded\b/);
  });

  it('renders only the autocapture section when no track() calls were written', () => {
    // No wired track() calls — the agent decided autocapture handled
    // the whole plan. We still want the celebration to enumerate the
    // events; just under the autocapture header.
    seedLedgerWith(
      installDir,
      'src/init.ts',
      `amplitude.init(API_KEY, { autocapture: true });`,
    );
    const store = makeStoreForSnapshot({
      installDir,
      outroData: { kind: OutroKind.Success, changes: [] },
    });
    store.setEventPlan([
      { name: 'Page Viewed', description: 'autocaptured' },
      { name: 'Element Clicked', description: 'autocaptured' },
    ]);

    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toMatch(
      /Covered by autocapture \(2 events — no track\(\) needed\)/,
    );
    // No instrumented section.
    expect(frame).not.toMatch(/Instrumented \(\d+ event/);
    // Tally line collapses to 0 instrumented.
    expect(frame).toContain('0 events instrumented · 2 covered by autocapture');
  });

  it('renders only the instrumented section when every plan event has a track() call', () => {
    seedLedgerWith(
      installDir,
      'src/instrument.ts',
      `
        amplitude.track("user signed up");
        amplitude.track("purchase completed");
      `,
    );
    const store = makeStoreForSnapshot({
      installDir,
      outroData: { kind: OutroKind.Success, changes: [] },
    });
    store.setEventPlan([
      { name: 'User Signed Up', description: 'after signup form' },
      { name: 'Purchase Completed', description: 'after checkout' },
    ]);

    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toMatch(/Instrumented \(2 events with track\(\) calls\)/);
    expect(frame).not.toMatch(/Covered by autocapture/);
    // Tally line omits the autocapture half.
    expect(frame).toContain('2 events instrumented');
    expect(frame).not.toContain('covered by autocapture');
  });
});
