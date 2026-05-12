/**
 * RunScreen Events tab — body copy across the event-plan lifecycle.
 *
 * Pins three honest states the Events tab must render, so the stale
 * "Waiting for the agent to propose events..." copy that lingered for
 * the entire wiring phase can never sneak back in:
 *
 *   1. Pre-plan        → "Waiting for the agent to propose events..."
 *   2. Plan proposed    → "Event plan ({N} events) · awaiting your approval"
 *   3. Plan approved   → "Approved · wiring {N} events…"
 *
 * Tests render `EventPlanViewer` directly (the component the Events
 * tab mounts) rather than the full RunScreen — that's the smallest
 * surface that exercises the body conditional without dragging in the
 * journey stepper, header bar, dissolve transition, etc.
 */

import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { EventPlanViewer } from '../../primitives/EventPlanViewer.js';

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
