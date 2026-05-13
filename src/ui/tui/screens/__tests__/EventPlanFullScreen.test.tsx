import { render } from 'ink-testing-library';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock BrailleSpinner so its internal 200ms setInterval doesn't pile up
// React re-renders under fake timers. Over a 5-minute watchdog advance
// that's ~1500 extra ticks for Ink to flush — on CI runners the queue
// can push past the 5s test budget AND leave `lastFrame()` lagging one
// tick behind the latest setState. A static stub keeps the surrounding
// "Revising your plan…" copy identical (`agent is generating a revised
// plan` is plain Text, not part of the spinner).
vi.mock('../../components/BrailleSpinner.js', () => ({
  BrailleSpinner: () => null,
}));

import {
  EventPlanFullScreen,
  REVISION_ABANDONED_BANNER,
  REVISION_TIER_1_MS,
  REVISION_TIER_2_MS,
  REVISION_TIER_3_MS,
  REVISION_TIMEOUT_BANNER,
  REVISION_WATCHDOG_MS,
  revisingCoachingCopy,
} from '../EventPlanFullScreen.js';
import { WizardStore } from '../../store.js';
import { Flow } from '../../flows.js';

function makeStore() {
  return new WizardStore(Flow.Wizard);
}

const sampleEvents = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Event ${i + 1} Created`,
    description: `Fires when event ${i + 1} occurs in the app.`,
  }));

describe('EventPlanFullScreen', () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
  });

  it('renders the title, events, and action hint at typical terminal size', () => {
    const events = sampleEvents(8);
    const { lastFrame } = render(
      <EventPlanFullScreen
        store={store}
        events={events}
        width={120}
        height={30}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Instrumentation Plan (8 events)');
    expect(frame).toContain('Event 1 Created');
    expect(frame).toContain('Event 8 Created');
    expect(frame).toContain('[Y] approve [S] skip [F] give feedback');
    // No scroll indicator when everything fits.
    expect(frame).not.toMatch(/more (above|below)/);
  });

  it('shows a scroll indicator and hides events past the viewport on small terminals', () => {
    const events = sampleEvents(20);
    const { lastFrame } = render(
      <EventPlanFullScreen
        store={store}
        events={events}
        width={120}
        height={15}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Instrumentation Plan (20 events)');
    expect(frame).toContain('Event 1 Created');
    // Last few events are off-screen — must NOT be silently dropped, the
    // scroll indicator surfaces them and the down arrow reaches them.
    expect(frame).not.toContain('Event 20 Created');
    expect(frame).toMatch(/more below/);
    // Action hint MUST stay on screen even with 20-event plan, and
    // should advertise scroll keys.
    expect(frame).toContain('[Y] approve [S] skip [F] give feedback');
    expect(frame).toMatch(/scroll/);
  });

  it('keeps the action hint visible even on a small (24-row) terminal', () => {
    const events = sampleEvents(15);
    const { lastFrame } = render(
      <EventPlanFullScreen
        store={store}
        events={events}
        width={120}
        height={24}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[Y] approve [S] skip [F] give feedback');
    expect(frame).toContain('Instrumentation Plan');
  });

  it('Y resolves the prompt as approved', () => {
    const events = sampleEvents(5);
    const resolveSpy = vi.spyOn(store, 'resolveEventPlan');
    const { stdin } = render(
      <EventPlanFullScreen
        store={store}
        events={events}
        width={120}
        height={30}
      />,
    );
    stdin.write('y');
    expect(resolveSpy).toHaveBeenCalledWith({ decision: 'approved' });
  });

  it('S resolves the prompt as skipped', () => {
    const events = sampleEvents(5);
    const resolveSpy = vi.spyOn(store, 'resolveEventPlan');
    const { stdin } = render(
      <EventPlanFullScreen
        store={store}
        events={events}
        width={120}
        height={30}
      />,
    );
    stdin.write('s');
    expect(resolveSpy).toHaveBeenCalledWith({ decision: 'skipped' });
  });

  it('F press does NOT resolve the prompt (it switches to feedback mode for typing)', () => {
    const events = sampleEvents(5);
    const resolveSpy = vi.spyOn(store, 'resolveEventPlan');
    const { stdin } = render(
      <EventPlanFullScreen
        store={store}
        events={events}
        width={120}
        height={30}
      />,
    );
    stdin.write('f');
    // F must NOT auto-resolve — the previous bug was that F either
    // resolved as approved or did nothing visible. The spy stays
    // un-called; the next user input (typed feedback + Enter) is
    // what triggers resolveEventPlan({decision: 'revised'}).
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('renders the "Revising your plan…" state when pendingEventPlanFeedback is set', () => {
    const events = sampleEvents(3);
    store.session = {
      ...store.session,
      pendingEventPlanFeedback: 'would love to see lowercased event names',
    };
    const { lastFrame } = render(
      <EventPlanFullScreen
        store={store}
        events={events}
        width={120}
        height={30}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Revising your plan');
    // The user's feedback is quoted back so the wait reads as
    // "the agent is working on what I asked for".
    expect(frame).toContain('would love to see lowercased event names');
    expect(frame).toContain('agent is generating a revised plan');
    // The normal approval UI must NOT be visible while revising —
    // re-pressing Y/S would either be ignored (good) or sneak into a
    // stale resolveEventPlan call (bad).
    expect(frame).not.toContain('[Y] approve [S] skip [F] give feedback');
    expect(frame).not.toContain('Instrumentation Plan');
  });

  it('flips back to the normal plan view when pendingEventPlanFeedback clears', () => {
    const events = sampleEvents(2);
    store.session = {
      ...store.session,
      pendingEventPlanFeedback: 'try Title Case',
    };
    const { lastFrame, rerender } = render(
      <EventPlanFullScreen
        store={store}
        events={events}
        width={120}
        height={30}
      />,
    );
    expect(lastFrame() ?? '').toContain('Revising your plan');

    // Simulate the agent's revised plan arriving — store.setEventPlan
    // / store.promptEventPlan clear pendingEventPlanFeedback to null.
    store.session = { ...store.session, pendingEventPlanFeedback: null };
    rerender(
      <EventPlanFullScreen
        store={store}
        events={events}
        width={120}
        height={30}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Instrumentation Plan (2 events)');
    expect(frame).not.toContain('Revising your plan');
  });
});

/**
 * Revising recovery — three affordances:
 *   1. progressive coaching escalates at 30s / 60s / 180s
 *   2. Esc cancels the revision and surfaces an abandonment banner
 *   3. 5min watchdog auto-clears with a timeout banner (single fire)
 *
 * Where possible we test the pure helpers (`revisingCoachingCopy`)
 * directly — quicker to run, easier to debug than time-travelling an Ink
 * harness — and reserve the full-render path for the integration
 * surface (Esc handler, watchdog firing through to the store).
 */
describe('EventPlanFullScreen — revising recovery', () => {
  describe('revisingCoachingCopy — tier escalation', () => {
    it('tier 0 (< 30s elapsed): keeps the original 10-30s reassurance', () => {
      expect(revisingCoachingCopy(0)).toBe(
        'This typically takes 10–30s — hang tight.',
      );
    });

    it('tier 1 (>= 30s elapsed): "taking a bit longer" copy', () => {
      expect(revisingCoachingCopy(1)).toBe(
        'Taking a bit longer than usual — the agent is still working.',
      );
    });

    it('tier 2 (>= 60s elapsed): suggests Esc to keep original plan', () => {
      expect(revisingCoachingCopy(2)).toBe(
        "The agent may have decided your feedback wasn't actionable. Press [Esc] to keep the original plan and continue, or wait another minute.",
      );
    });

    it('tier 3 (>= 3min elapsed): strong nudge with examples', () => {
      expect(revisingCoachingCopy(3)).toBe(
        "Agent hasn't returned. Your feedback may not have been actionable (e.g. too vague, contradictory). Press [Esc] to keep the original plan.",
      );
    });
  });

  /**
   * Elapsed / tier / watchdog tests with fake timers.
   *
   * Vitest's `useFakeTimers()` does NOT mock `Date.now` by default — it
   * only mocks setTimeout/setInterval/etc. The component reads
   * `Date.now()` directly for elapsed math, so we ALSO need
   * `vi.setSystemTime()` to keep wall-clock and timer queue in lock
   * step. Without that, advancing fake timers fires the interval
   * callback but `Date.now() - revisingStartRef.current` returns the
   * REAL elapsed (~0ms) and tier escalation never happens.
   *
   * After each `vi.advanceTimersByTimeAsync` we also yield a microtask
   * (`Promise.resolve()`) so Ink's render scheduler can flush the
   * setState that ran inside the interval — otherwise `lastFrame()`
   * can read one tick behind on slow CI runners. We use a microtask,
   * not `setImmediate`, because vitest's fake timers mock that too.
   *
   * Each test uses `{ timeout: 15_000 }` because advancing 5min of fake
   * time fires ~300 interval callbacks; the React reconciler on slow CI
   * runners can comfortably eat past the default 5s budget. 15s leaves
   * headroom without masking real hangs.
   */
  describe('elapsed-driven render', () => {
    let store: ReturnType<typeof makeStore>;
    const baseTime = 1_700_000_000_000;

    beforeEach(() => {
      store = makeStore();
      // useFakeTimers must come BEFORE setSystemTime — the latter
      // operates on the fake clock vitest just installed.
      vi.useFakeTimers();
      vi.setSystemTime(baseTime);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * Advance fake time AND yield a microtask so any setState inside
     * an interval callback lands before the next `lastFrame()` read.
     * `vi.setSystemTime` keeps `Date.now()` in lock step with the
     * timer queue so elapsed math inside the component sees real
     * (virtual) time advance, not the real wall clock.
     */
    async function advance(ms: number) {
      await vi.advanceTimersByTimeAsync(ms);
      // Microtask yield — gives Ink's render scheduler a chance to
      // flush the final setState. `setImmediate` would hang under fake
      // timers (vitest mocks it), so we use Promise.resolve().
      await Promise.resolve();
    }

    it('shows tier-0 copy and "elapsed: 0s" at the start', () => {
      store.session = {
        ...store.session,
        pendingEventPlanFeedback: 'hey',
      };
      const { lastFrame } = render(
        <EventPlanFullScreen
          store={store}
          events={sampleEvents(3)}
          width={120}
          height={30}
        />,
      );
      const frame = lastFrame() ?? '';
      expect(frame).toContain('This typically takes 10–30s — hang tight.');
      expect(frame).toContain('elapsed: 0s');
    });

    it(
      'escalates through tier 1 / 2 / 3 copies as time passes',
      { timeout: 15_000 },
      async () => {
        store.session = {
          ...store.session,
          pendingEventPlanFeedback: 'hey',
        };
        const { lastFrame } = render(
          <EventPlanFullScreen
            store={store}
            events={sampleEvents(3)}
            width={120}
            height={30}
          />,
        );

        // Ink soft-wraps long lines at the viewport width, so `toContain`
        // on the full string can fail even when the copy is correct. Use
        // a unique substring that fits on one rendered row to assert the
        // tier. `revisingCoachingCopy` is asserted verbatim in the pure
        // helper block above — this section verifies the tier WIRING.

        // 40s in — past REVISION_TIER_1_MS (30s).
        await advance(40_000);
        let frame = lastFrame() ?? '';
        expect(frame).toContain('Taking a bit longer than usual');
        expect(frame).toContain('elapsed: 40s');

        // 90s in — past REVISION_TIER_2_MS (60s).
        await advance(50_000);
        frame = lastFrame() ?? '';
        expect(frame).toContain(
          "The agent may have decided your feedback wasn't actionable",
        );
        expect(frame).toContain('elapsed: 1m 30s');

        // 3m30s in — past REVISION_TIER_3_MS (180s).
        await advance(120_000);
        frame = lastFrame() ?? '';
        expect(frame).toContain("Agent hasn't returned.");
        expect(frame).toContain('elapsed: 3m 30s');
      },
    );

    it(
      'watchdog auto-clears with the timeout banner past 5min',
      { timeout: 15_000 },
      async () => {
        store.session = {
          ...store.session,
          pendingEventPlanFeedback: 'hey',
        };
        const clearSpy = vi.spyOn(store, 'clearPendingEventPlanFeedback');
        const setBannerSpy = vi.spyOn(store, 'setEventPlanRevisionBanner');
        const { lastFrame } = render(
          <EventPlanFullScreen
            store={store}
            events={sampleEvents(3)}
            width={120}
            height={30}
          />,
        );

        // Just shy of the 5min boundary — still revising, no cancel yet.
        await advance(REVISION_WATCHDOG_MS - 1_000);
        expect(lastFrame() ?? '').toContain('Revising your plan');
        expect(clearSpy).not.toHaveBeenCalled();

        // Cross the boundary — watchdog fires both calls.
        await advance(2_000);
        expect(clearSpy).toHaveBeenCalled();
        expect(setBannerSpy).toHaveBeenCalledWith(REVISION_TIMEOUT_BANNER);
        expect(store.session.pendingEventPlanFeedback).toBeNull();
        // Bugbot HIGH regression: the banner now lives in session
        // state, so it survives the unmount→remount that
        // clearPendingEventPlanFeedback would have triggered in
        // production. Without this lift the watchdog/Esc UX was dead
        // code in prod.
        expect(store.session.eventPlanRevisionBanner).toBe(
          REVISION_TIMEOUT_BANNER,
        );

        const frame = lastFrame() ?? '';
        expect(frame).not.toContain('Revising your plan');
        expect(frame).toContain('Instrumentation Plan');
        // Pin the exact timeout banner copy so a copy-edit regression
        // surfaces as a visible test diff.
        expect(frame).toContain(
          'Revision timed out after 5min. Original plan preserved.',
        );
        expect(frame).toContain(REVISION_TIMEOUT_BANNER);
      },
    );

    it(
      'watchdog fires exactly once even under rapid time advance',
      { timeout: 15_000 },
      async () => {
        store.session = {
          ...store.session,
          pendingEventPlanFeedback: 'hey',
        };
        const clearSpy = vi.spyOn(store, 'clearPendingEventPlanFeedback');
        render(
          <EventPlanFullScreen
            store={store}
            events={sampleEvents(3)}
            width={120}
            height={30}
          />,
        );

        // Blast well past the watchdog so the interval ticks several
        // times beyond the threshold in one shot.
        await advance(REVISION_WATCHDOG_MS + 60_000);
        // First tick past the threshold should fire the clear once;
        // all subsequent ticks are guarded by `watchdogFiredRef`.
        expect(clearSpy).toHaveBeenCalledTimes(1);

        // Even more advancement after that is still a no-op.
        await advance(120_000);
        expect(clearSpy).toHaveBeenCalledTimes(1);
      },
    );

    it('tier constants line up with the rendered tier values', () => {
      // Pin both that the constants are exported AND that their values
      // match the documented thresholds. The previous naming
      // (REVISION_TIER_TWO_MS = 30s mapping to revisingTier = 1) was
      // off by one — Bugbot LOW (comment 3235276642).
      expect(REVISION_TIER_1_MS).toBe(30_000);
      expect(REVISION_TIER_2_MS).toBe(60_000);
      expect(REVISION_TIER_3_MS).toBe(3 * 60_000);
      // Tier name should match the value flipped by that threshold.
      expect(revisingCoachingCopy(1)).toContain('Taking a bit longer');
      expect(revisingCoachingCopy(2)).toContain("wasn't actionable");
      expect(revisingCoachingCopy(3)).toContain("Agent hasn't returned");
    });
  });

  /**
   * Esc handler test — separate `describe` so it runs with real timers
   * (fake timers mess with ink-testing-library's stdin write flush).
   */
  describe('Esc cancels in-flight revision', () => {
    let store: ReturnType<typeof makeStore>;

    beforeEach(() => {
      store = makeStore();
    });

    it('clears pendingEventPlanFeedback and shows the abandonment banner', async () => {
      store.session = {
        ...store.session,
        pendingEventPlanFeedback: 'hey',
      };
      const { lastFrame, stdin } = render(
        <EventPlanFullScreen
          store={store}
          events={sampleEvents(3)}
          width={120}
          height={30}
        />,
      );
      // We're on the "Revising your plan…" panel.
      expect(lastFrame() ?? '').toContain('Revising your plan');

      // Press Esc — store.clearPendingEventPlanFeedback() should fire
      // and the original plan should re-render with the abandonment
      // banner. Poll briefly so React's flush has a chance.
      stdin.write('');
      for (let i = 0; i < 25; i++) {
        if (store.session.pendingEventPlanFeedback === null) break;
        await new Promise((r) => setTimeout(r, 20));
      }

      const frame = lastFrame() ?? '';
      expect(store.session.pendingEventPlanFeedback).toBeNull();
      // Bugbot HIGH regression: the banner survives in session state.
      expect(store.session.eventPlanRevisionBanner).toBe(
        REVISION_ABANDONED_BANNER,
      );
      expect(frame).not.toContain('Revising your plan');
      expect(frame).toContain('Instrumentation Plan (3 events)');
      expect(frame).toContain(REVISION_ABANDONED_BANNER);
    });

    it(
      'banner state survives when pendingEventPlanFeedback flips to null ' +
        '(Bugbot HIGH regression — component unmount would erase a local banner)',
      () => {
        // Direct store-level assertion: the abandon banner lives on
        // session, not in component-local state. This is the load-
        // bearing fix from comment 3235276649 — without it the
        // entire Esc-cancel + watchdog UX was dead code in prod
        // because App.tsx's `showEventPlan` check unmounts
        // EventPlanFullScreen the moment pendingEventPlanFeedback
        // flips to null, destroying any component-local banner.
        store.session = {
          ...store.session,
          pendingEventPlanFeedback: 'hey',
        };

        // Simulate what the watchdog / Esc handler does:
        store.setEventPlanRevisionBanner(REVISION_ABANDONED_BANNER);
        store.clearPendingEventPlanFeedback();

        // After both writes: feedback is gone, banner persists.
        expect(store.session.pendingEventPlanFeedback).toBeNull();
        expect(store.session.eventPlanRevisionBanner).toBe(
          REVISION_ABANDONED_BANNER,
        );

        // Re-rendering EventPlanFullScreen fresh (mimicking a remount)
        // — the banner must still show because it lives on session,
        // NOT on a destroyed local React state.
        const { lastFrame } = render(
          <EventPlanFullScreen
            store={store}
            events={sampleEvents(3)}
            width={120}
            height={30}
          />,
        );
        const frame = lastFrame() ?? '';
        expect(frame).toContain(REVISION_ABANDONED_BANNER);
        expect(frame).toContain('Instrumentation Plan (3 events)');
      },
    );

    it(
      'banner clears when a fresh event-plan prompt arrives ' +
        '(Esc → revised plan ships → banner gone)',
      () => {
        store.session = {
          ...store.session,
          eventPlanRevisionBanner: REVISION_TIMEOUT_BANNER,
        };
        // promptEventPlan simulates the agent calling
        // confirm_event_plan again with the revised events.
        void store.promptEventPlan(sampleEvents(2));
        expect(store.session.eventPlanRevisionBanner).toBeNull();
      },
    );

    it(
      'banner clears when the user approves the original plan',
      async () => {
        // Set up: there's a pending event-plan prompt AND a stale
        // banner from a previous abandoned revision.
        const promptPromise = store.promptEventPlan(sampleEvents(2));
        store.session = {
          ...store.session,
          eventPlanRevisionBanner: REVISION_ABANDONED_BANNER,
        };
        // User finally picks something.
        store.resolveEventPlan({ decision: 'approved' });
        await promptPromise;
        expect(store.session.eventPlanRevisionBanner).toBeNull();
      },
    );
  });

  describe('chrome budget', () => {
    it(
      'reserves rows for the abandon banner so events do not silently clip ' +
        '(Bugbot MEDIUM regression — comment 3235276632)',
      () => {
        // Render twice at the SAME height — once with banner, once
        // without — and confirm the banner version shows fewer events
        // before hitting the scroll indicator. This is the user-
        // visible signal that the chrome budget accounts for the
        // banner's row consumption.
        const events = sampleEvents(15);
        const sharedHeight = 15;
        const sharedWidth = 120;

        const plainStore = makeStore();
        const { lastFrame: framePlain } = render(
          <EventPlanFullScreen
            store={plainStore}
            events={events}
            width={sharedWidth}
            height={sharedHeight}
          />,
        );
        const plain = framePlain() ?? '';
        const plainBelowMatch = plain.match(/(\d+) more below/);
        const plainBelow = plainBelowMatch ? Number(plainBelowMatch[1]) : 0;

        // Now render WITH the banner up. (Fresh store so first
        // render's state doesn't bleed into this one.)
        const banneredStore = makeStore();
        banneredStore.session = {
          ...banneredStore.session,
          eventPlanRevisionBanner: REVISION_ABANDONED_BANNER,
        };
        const { lastFrame: frameBanner } = render(
          <EventPlanFullScreen
            store={banneredStore}
            events={events}
            width={sharedWidth}
            height={sharedHeight}
          />,
        );
        const bannered = frameBanner() ?? '';
        expect(bannered).toContain(REVISION_ABANDONED_BANNER);
        const banneredBelowMatch = bannered.match(/(\d+) more below/);
        const banneredBelow = banneredBelowMatch
          ? Number(banneredBelowMatch[1])
          : 0;

        // With the banner up there should be strictly MORE events
        // hidden below (fewer rows fit). If the chrome budget
        // weren't accounting for the banner, both counts would match
        // and the bottom events would silently clip past `overflow=
        // "hidden"`.
        expect(banneredBelow).toBeGreaterThan(plainBelow);
      },
    );
  });
});
