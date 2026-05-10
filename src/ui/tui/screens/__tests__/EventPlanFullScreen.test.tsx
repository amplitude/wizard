import { render } from 'ink-testing-library';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { EventPlanFullScreen } from '../EventPlanFullScreen.js';
import { WizardStore } from '../../store.js';
import { defaultFlow } from '../../flows.js';

function makeStore() {
  return new WizardStore(defaultFlow);
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

  describe('conversational mode (round ≥ 2)', () => {
    it('renders prior-feedback quote and +N/−M deltas after a revised round', async () => {
      // Round 1: agent proposes a 3-event plan.
      const round1 = [
        { name: 'User Signed Up', description: 'Fires on signup.' },
        { name: 'User Signed In', description: 'Fires on login.' },
        { name: 'Page Viewed', description: 'Fires on page view.' },
      ];
      const promise1 = store.promptEventPlan(round1);
      // User gives feedback. Resolving with `revised` stashes the
      // feedback to pair with the NEXT promptEventPlan.
      store.resolveEventPlan({
        decision: 'revised',
        feedback: 'rename to snake_case and drop page_viewed',
      });
      await promise1;

      // Round 2: agent's revised plan — 2 renamed events, page_viewed
      // dropped.
      const round2 = [
        { name: 'user_signed_up', description: 'Fires on signup.' },
        { name: 'user_signed_in', description: 'Fires on login.' },
      ];
      void store.promptEventPlan(round2);

      const { lastFrame } = render(
        <EventPlanFullScreen
          store={store}
          events={round2}
          width={120}
          height={30}
        />,
      );
      const frame = lastFrame() ?? '';
      // Conversational title + quoted feedback + delta line.
      expect(frame).toContain('Round 2 — revised after your feedback');
      expect(frame).toContain('rename to snake_case and drop page_viewed');
      expect(frame).toContain('+2 added');
      expect(frame).toContain('−3 removed'); // all 3 prior names removed (renamed = remove + add)
      // Removed events render struck-through (still visible so the user
      // can audit what the AI dropped).
      expect(frame).toContain('Page Viewed');
      // New events render with `+` glyph.
      expect(frame).toContain('user_signed_up');
      expect(frame).toContain('user_signed_in');
    });

    it('round 1 (initial proposal) still shows the simple title — no convo header', () => {
      const round1 = [
        { name: 'evt_a', description: 'A' },
        { name: 'evt_b', description: 'B' },
      ];
      void store.promptEventPlan(round1);
      const { lastFrame } = render(
        <EventPlanFullScreen
          store={store}
          events={round1}
          width={120}
          height={30}
        />,
      );
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Suggested events for your app:');
      expect(frame).not.toContain('Round 2');
      expect(frame).not.toContain('You:');
    });

    it('approving clears round history so a future plan starts a fresh conversation', async () => {
      const initial = [{ name: 'a', description: '' }];
      const promise = store.promptEventPlan(initial);
      expect(store.eventPlanRounds).toHaveLength(1);
      store.resolveEventPlan({ decision: 'approved' });
      await promise;
      expect(store.eventPlanRounds).toHaveLength(0);
    });
  });
});
