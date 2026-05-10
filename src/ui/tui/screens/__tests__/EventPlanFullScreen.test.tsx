import { render } from 'ink-testing-library';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { EventPlanFullScreen } from '../EventPlanFullScreen.js';
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
});
