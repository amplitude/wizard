/**
 * Render-cost benchmark fixture.
 *
 * Part of v2 PR 5 — the brief asks for "before/after render counts"
 * captured against a fixed reproducible scenario. This test pins the
 * upper bound on subscriber-render counts for a representative
 * scenario: 3 fake task transitions (queued → running → completed)
 * plus 5 unrelated `pushStatus` ticks.
 *
 * The contract is: a slice subscriber subscribed to
 * `session.discoveryFacts` must NOT rerender for the unrelated bumps
 * (status pushes, region change), but SHOULD rerender for a discovery
 * fact mutation. The whole-store subscriber rerenders every tick.
 *
 * This is a render-cost ceiling test, not a snapshot — if a future
 * PR introduces a new bumper that fires on every emitChange (e.g. an
 * always-on timer), the slice subscriber's count will rise and the
 * test will fail with a clear message.
 */
import { describe, it, expect } from 'vitest';
import { WizardStore } from '../store.js';
import { TaskStatus } from '../../wizard-ui.js';

describe('render-cost (slice subscription benchmark)', () => {
  it('slice subscriber renders only when its slice changes', () => {
    const store = new WizardStore();

    // Track "renders" via the same mechanism a `useWizardSelector`
    // subscriber uses: keep a `lastValue`, recompute on every store
    // tick, and increment when the equality check fails.
    let materialized = 0;
    let lastValue = store.session.discoveryFacts;
    const unsubscribe = store.subscribe(() => {
      const next = store.session.discoveryFacts;
      if (lastValue !== next) {
        materialized += 1;
        lastValue = next;
      }
    });

    // Scenario: a representative wizard run.
    store.pushStatus('Detecting framework');
    store.pushStatus('Reading package.json');
    store.pushStatus('Computing skill tier');
    store.pushStatus('Booting agent');
    store.pushStatus('Running first tool call');
    // 5 unrelated bumps — slice subscriber should not have rendered.
    expect(materialized).toBe(0);

    // Now mutate the slice — a discovery fact is added.
    store.session = {
      ...store.session,
      discoveryFacts: [
        ...store.session.discoveryFacts,
        { kind: 'framework', label: 'Next.js' },
      ],
    };
    expect(materialized).toBe(1);

    // More unrelated bumps — slice subscriber stays put.
    store.pushStatus('More log lines');
    store.pushStatus('Even more');
    expect(materialized).toBe(1);

    unsubscribe();
  });

  it('whole-store subscriber renders on every tick', () => {
    const store = new WizardStore();
    let renders = 0;
    const unsubscribe = store.subscribe(() => {
      renders += 1;
    });

    store.pushStatus('a');
    store.pushStatus('b');
    store.pushStatus('c');
    store.pushStatus('d');
    store.pushStatus('e');

    // Whole-store subscribers rerender on every emitChange. The exact
    // number can be slightly higher when a setter calls multiple
    // emitChanges; the floor is N for N pushStatus calls.
    expect(renders).toBeGreaterThanOrEqual(5);

    unsubscribe();
  });

  it('slice subscriber benchmark: 3 task transitions + 5 status bumps', () => {
    const store = new WizardStore();

    // Slice: tasks list. Tasks change three times in our scenario.
    let taskRenders = 0;
    let lastTasks = store.tasks;
    const unsubscribeTasks = store.subscribe(() => {
      const next = store.tasks;
      if (lastTasks !== next) {
        taskRenders += 1;
        lastTasks = next;
      }
    });

    // Slice: status messages. Should NOT change when only tasks move.
    let statusRenders = 0;
    let lastStatus = store.statusMessages;
    const unsubscribeStatus = store.subscribe(() => {
      const next = store.statusMessages;
      if (lastStatus !== next) {
        statusRenders += 1;
        lastStatus = next;
      }
    });

    // Three task transitions (drives setTasks).
    store.setTasks([
      {
        label: 'Detect',
        activeForm: 'Detecting',
        status: TaskStatus.InProgress,
        done: false,
      },
    ]);
    store.setTasks([
      {
        label: 'Detect',
        activeForm: 'Detecting',
        status: TaskStatus.Completed,
        done: true,
      },
      {
        label: 'Install',
        activeForm: 'Installing',
        status: TaskStatus.InProgress,
        done: false,
      },
    ]);
    store.setTasks([
      {
        label: 'Detect',
        activeForm: 'Detecting',
        status: TaskStatus.Completed,
        done: true,
      },
      {
        label: 'Install',
        activeForm: 'Installing',
        status: TaskStatus.Completed,
        done: true,
      },
    ]);

    // 5 unrelated bumps.
    store.pushStatus('hello');
    store.pushStatus('world');
    store.pushStatus('foo');
    store.pushStatus('bar');
    store.pushStatus('baz');

    // Tasks subscriber rendered exactly 3 times.
    expect(taskRenders).toBe(3);
    // Status subscriber rendered exactly 5 times.
    expect(statusRenders).toBe(5);
    // Compare to a whole-store subscriber: it would have rendered 8+
    // times. Slicing cuts each subscriber's render budget by ~60%.

    unsubscribeTasks();
    unsubscribeStatus();
  });
});
