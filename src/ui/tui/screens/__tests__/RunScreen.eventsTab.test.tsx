/**
 * RunScreen — Events tab source-of-truth coverage during wiring.
 *
 * Pins the fix that mirrors PR #746's outro change for the
 * mid-wiring view. Previously the Events tab rendered
 * `store.eventPlan` verbatim, so any normalize-mangling (e.g.
 * `Ai Diagram Generated` for what the agent actually wrote as
 * `AI Diagram Generated`) or user-feedback divergence (the user
 * asked for lowercase, the plan still held Title Case) lingered
 * for the entire wiring phase.
 *
 * The fix walks the per-run file-change ledger inside
 * `EventPlanViewer` (the component RunScreen mounts as its Events
 * tab) and renders each plan entry with:
 *   - wired-code casing + ✓ glyph when a `track()` callsite for it
 *     has landed on disk
 *   - plan name + ○ glyph when the event hasn't been wired yet
 *
 * These tests exercise `EventPlanViewer` directly (the same
 * component the Events tab mounts) rather than driving the full
 * RunScreen → TabContainer plumbing — that plumbing is covered by
 * RunScreen.spacing / coaching tests and routing the Events tab via
 * `setRequestedTab` from a snapshot store requires waiting for a
 * post-mount effect to flush, which ink-testing-library doesn't do
 * cleanly. Rendering the leaf gives a deterministic frame and the
 * RunScreen call site only forwards `events` + `refreshKey`.
 *
 * Tests seed the ledger with synthetic wired file content so the
 * assertion is deterministic — we never have to boot the inner agent.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { render } from 'ink-testing-library';
import { EventPlanViewer } from '../../primitives/EventPlanViewer.js';
import {
  initFileChangeLedger,
  resetFileChangeLedger,
} from '../../../../lib/file-change-ledger.js';

import { stripAnsi } from '../../__tests__/helpers/strip-ansi.js';

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

function renderViewer(
  events: { name: string; description?: string }[],
  refreshKey = 1,
): string {
  const { lastFrame, unmount } = render(
    <EventPlanViewer events={events} refreshKey={refreshKey} />,
  );
  const frame = stripAnsi(lastFrame() ?? '');
  unmount();
  return frame;
}

describe('RunScreen Events tab — wired vs pending rendering', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), 'run-events-'));
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

  it('renders wired-code casing for events whose track() calls have landed', () => {
    // Plan has 3 events. Two have already been wired (one in lowercase,
    // one in Title Case to prove casing is preserved verbatim from the
    // code, not normalized to either extreme). The third has no
    // matching track() call yet — it should fall back to the plan name.
    seedLedgerWith(
      installDir,
      'src/instrument.ts',
      `
        amplitude.track("collaboration session started");
        amplitude.track("App Loaded");
      `,
    );

    const frame = renderViewer([
      {
        name: 'Collaboration Session Started',
        description: 'opens a board',
      },
      { name: 'App Loaded', description: 'first paint' },
      { name: 'Chart Pasted', description: 'user pastes a chart' },
    ]);

    // Wired events render with the exact spelling from the track() call,
    // not the plan's normalized Title Case.
    expect(frame).toContain('collaboration session started');
    expect(frame).toContain('App Loaded');
    // The Title-Cased plan version of the lowercase wired event must NOT
    // appear — that was the bug (Title Case bleeding through wiring).
    expect(frame).not.toMatch(/\bCollaboration Session Started\b/);

    // Pending event falls back to the plan name.
    expect(frame).toContain('Chart Pasted');
  });

  it('uses distinct glyphs for wired vs pending events', () => {
    // Same scenario, but assert on the leading glyph for each row.
    // Wired rows lead with the checkmark (✓); pending rows lead with
    // the open-bullet (○). The plan-only renderer pre-fix used a single
    // filled-bullet for every row — the visual divergence is the only
    // way the user can tell which events have actually landed.
    seedLedgerWith(
      installDir,
      'src/instrument.ts',
      `amplitude.track("app loaded");`,
    );

    const frame = renderViewer([
      { name: 'App Loaded', description: 'first paint' },
      { name: 'Chart Pasted', description: 'user pastes a chart' },
    ]);

    // Wired event: ✓ glyph immediately before the wired-code name.
    expect(frame).toMatch(/✓\s+app loaded/);
    // Pending event: ○ glyph before the plan name.
    expect(frame).toMatch(/○\s+Chart Pasted/);
    // The wired event must NOT carry the pending glyph and the pending
    // event must NOT carry the wired glyph — assert the negative cases
    // too so a future regression that hard-codes one glyph fails loudly.
    expect(frame).not.toMatch(/○\s+app loaded/);
    expect(frame).not.toMatch(/✓\s+Chart Pasted/);
  });

  it('renders the plan name (with ○) for every event when no track() calls have landed yet', () => {
    // Initialise the ledger but with content that contains no track()
    // calls — the agent has touched files (e.g. SDK init) but hasn't
    // wired any custom events yet. Every plan entry must render as
    // pending so the user sees what's about to be wired.
    seedLedgerWith(
      installDir,
      'src/init.ts',
      `amplitude.init(API_KEY, { autocapture: true });`,
    );

    const frame = renderViewer([
      { name: 'App Loaded', description: 'first paint' },
      { name: 'Chart Pasted', description: 'user pastes a chart' },
    ]);

    expect(frame).toMatch(/○\s+App Loaded/);
    expect(frame).toMatch(/○\s+Chart Pasted/);
    expect(frame).not.toMatch(/✓\s+(App Loaded|Chart Pasted)/);
  });

  it('falls back to plan-only rendering when no ledger is initialised (tests / full-activation re-run)', () => {
    // No ledger init — `resetFileChangeLedger()` in beforeEach ensures
    // the singleton is null. Every plan entry must render with the
    // pending glyph and the plan name unchanged so callers that never
    // bootstrap the ledger don't see a confusing "all events pending"
    // illusion turn into a wrong "all events wired" illusion.
    const frame = renderViewer([
      { name: 'App Loaded', description: 'first paint' },
    ]);
    expect(frame).toMatch(/○\s+App Loaded/);
    expect(frame).not.toMatch(/✓/);
  });
});

// ──────────────────────────────────────────────────────────────────
// Body-copy coverage (from #745 plan-feedback-UX, merged via main).
// Pins three honest states the Events tab must render so the stale
// 'Waiting...' copy that lingered for the entire wiring phase can
// never sneak back in.
// ──────────────────────────────────────────────────────────────────

const samplePlan = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Sample Event ${i + 1}`,
    description: `Description ${i + 1}.`,
  }));
describe('RunScreen Events tab — EventPlanViewer body copy', () => {
  it('shows "Waiting for the agent to propose events..." before any events are proposed', () => {
    const { lastFrame } = render(<EventPlanViewer events={[]} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Waiting for the agent to propose events...');
    expect(frame).not.toContain('Approved');
  });

  it('shows "awaiting your approval" header when a plan exists but has not been approved', () => {
    const { lastFrame } = render(<EventPlanViewer events={samplePlan(3)} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Event plan (3 events) · awaiting your approval');
    expect(frame).toContain('Sample Event 1');
    expect(frame).toContain('Sample Event 3');
    expect(frame).not.toContain('Approved');
    expect(frame).not.toContain('Waiting for the agent to propose events');
  });

  it('shows "Approved · wiring N events…" after the user approves the plan', () => {
    const { lastFrame } = render(
      <EventPlanViewer events={samplePlan(4)} approved />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Approved · wiring 4 events');
    // The body still lists every approved event so the user can scan
    // what's actually being wired up; the stale "Waiting…" copy must
    // not linger here.
    expect(frame).toContain('Sample Event 1');
    expect(frame).toContain('Sample Event 4');
    expect(frame).not.toContain('Waiting for the agent to propose events');
    expect(frame).not.toContain('awaiting your approval');
  });

  it('uses singular "event" wording for a 1-event plan in both pending and approved states', () => {
    const onePlan = samplePlan(1);
    const pending = render(<EventPlanViewer events={onePlan} />);
    expect(pending.lastFrame() ?? '').toContain(
      'Event plan (1 event) · awaiting your approval',
    );
    const approved = render(<EventPlanViewer events={onePlan} approved />);
    expect(approved.lastFrame() ?? '').toContain('Approved · wiring 1 event');
  });
});
