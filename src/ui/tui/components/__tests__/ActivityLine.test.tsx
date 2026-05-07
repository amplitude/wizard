/**
 * ActivityLine — verifies the live "we're not stuck" sub-line under the
 * journey stepper.
 *
 * Renders nothing when the wizard is idle. When `currentActivity` is set,
 * renders a spinner glyph + the activity message + an "(Ns elapsed)" tail.
 * The estimated-duration suffix only shows when the caller provides one
 * — we intentionally don't pull a number out of thin air.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ActivityLine } from '../ActivityLine.js';
import { WizardStore } from '../../store.js';
import type { WizardActivity } from '../../store.js';

// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\x1b\[[0-9;]*[A-Za-z]/g;

function frameOf(store: WizardStore, now: () => number = () => 0): string {
  const { lastFrame, unmount } = render(
    <ActivityLine store={store} now={now} />,
  );
  const out = (lastFrame() ?? '').replace(ANSI_CSI, '');
  unmount();
  return out;
}

function makeStoreWithActivity(activity: WizardActivity | null): WizardStore {
  const store = new WizardStore();
  store.setCurrentActivity(activity);
  return store;
}

describe('ActivityLine', () => {
  it('renders nothing when there is no current activity', () => {
    const store = makeStoreWithActivity(null);
    expect(frameOf(store)).toBe('');
  });

  it('renders the message and elapsed seconds for compaction', () => {
    const startedAt = 1_000_000;
    // Short message so 80-col Ink terminal output doesn't wrap on us in
    // the "typically ~Ns" tail. Real callers can pass longer copy; the
    // wrap happens cleanly in production at the terminal width.
    const store = makeStoreWithActivity({
      kind: 'compaction',
      message: 'Compacting context.',
      startedAt,
      estimatedDurationSec: 60,
    });
    const out = frameOf(store, () => startedAt + 5_000);
    expect(out).toContain('Compacting context');
    expect(out).toContain('5s elapsed');
    expect(out).toContain('typically ~60s');
  });

  it('renders rate-limit-retry phrasing without an estimate when none is given', () => {
    const startedAt = 2_000_000;
    const store = makeStoreWithActivity({
      kind: 'rate-limit-retry',
      message:
        'Rate limited by Anthropic. Waiting 12s before retry (attempt 2/5).',
      startedAt,
    });
    const out = frameOf(store, () => startedAt + 1_000);
    expect(out).toContain('Rate limited by Anthropic');
    expect(out).toContain('attempt 2/5');
    expect(out).toContain('1s elapsed');
    // No estimated-duration phrasing because none was supplied.
    expect(out).not.toContain('typically');
  });

  it('renders cold-start phases', () => {
    const startedAt = 3_000_000;
    const store = makeStoreWithActivity({
      kind: 'cold-start',
      message: 'Loading skills...',
      startedAt,
      estimatedDurationSec: 90,
    });
    const out = frameOf(store, () => startedAt);
    expect(out).toContain('Loading skills');
    expect(out).toContain('0s elapsed');
    expect(out).toContain('typically ~90s');
  });

  it('renders ingestion-poll waits', () => {
    const startedAt = 4_000_000;
    const store = makeStoreWithActivity({
      kind: 'ingestion-poll',
      message:
        'Waiting for events to reach Amplitude (polling every 10s). Trigger an action in your app to send an event.',
      startedAt,
      estimatedDurationSec: 10,
    });
    const out = frameOf(store, () => startedAt + 3_000);
    expect(out).toContain('Waiting for events');
    expect(out).toContain('3s elapsed');
  });

  it('renders MCP tool calls', () => {
    const startedAt = 5_000_000;
    const store = makeStoreWithActivity({
      kind: 'mcp-tool',
      message: 'Querying Amplitude (query_dataset)...',
      startedAt,
      estimatedDurationSec: 30,
    });
    const out = frameOf(store, () => startedAt + 12_000);
    expect(out).toContain('Querying Amplitude');
    expect(out).toContain('query_dataset');
    expect(out).toContain('12s elapsed');
  });

  it('hides the line again after activity is cleared back to idle', () => {
    const store = makeStoreWithActivity({
      kind: 'compaction',
      message:
        'Compacting context — keeping the relevant pieces, dropping the rest.',
      startedAt: 1_000_000,
    });
    expect(frameOf(store, () => 1_000_000)).toContain('Compacting context');

    // Regression guard for the "stale activity stays after idle" bug —
    // setting currentActivity back to null must blank the line, otherwise
    // the user sees a phantom "Compacting context" after the run resumes.
    store.setCurrentActivity(null);
    expect(frameOf(store, () => 1_000_000)).toBe('');
  });

  it('treats a kind:"idle" sentinel as cleared', () => {
    // The lib-layer can emit `{ kind: 'idle', message: '' }` instead of
    // null when it wants to keep payload shape consistent. Treat it the
    // same as a clear so the UI never renders an empty pseudo-activity.
    const store = makeStoreWithActivity({
      kind: 'idle',
      message: '',
      startedAt: 0,
    });
    expect(frameOf(store, () => 1_000_000)).toBe('');
  });

  // Bugbot thread (PR #594): "Layout overflows by 1 row when ActivityLine
  // visible". The component reserves exactly 1 row of vertical space when
  // active, and 0 rows when idle. App.tsx subtracts that row from the
  // content + console heights so the chrome+content total still equals
  // `rows`. If this invariant ever changes (e.g. a 2-row variant ships)
  // the App.tsx layout math has to update with it.
  it('renders exactly one line of output when active', () => {
    const startedAt = 1_000_000;
    const store = makeStoreWithActivity({
      kind: 'compaction',
      message: 'Compacting context.',
      startedAt,
    });
    const out = frameOf(store, () => startedAt);
    // Trim trailing newline from Ink's frame output (always present),
    // then count the remaining newlines to get the visual row count.
    const rows = out.replace(/\n$/, '').split('\n').length;
    expect(rows).toBe(1);
  });

  it('renders zero lines of output when idle (no row reserved)', () => {
    const store = makeStoreWithActivity(null);
    expect(frameOf(store)).toBe('');
  });
});
