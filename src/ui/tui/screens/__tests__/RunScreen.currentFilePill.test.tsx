/**
 * RunScreen — sticky "currently editing X" pill clear conditions.
 *
 * Before this fix the `lastFileRef` in RunScreen only ever received a
 * value when the most recent fileWrites entry was truthy, and there
 * was no clear path. The header pill kept showing the last edited
 * file forever — into the Finalizing phase, into the outro grace
 * period, into the post-agent steps — even though the agent was
 * plainly no longer touching that file. The header lied.
 *
 * The fix clears the sticky pill when either:
 *
 *   1. The most recent file write is older than STALE_FILE_WRITE_MS
 *      (10s) AND its status is terminal (`applied` / `failed`) — the
 *      agent is quiet enough that "currently editing" is no longer
 *      true.
 *   2. `postAgentSteps.length > 0` — the agent has moved past the
 *      file-write phase entirely. Clear immediately.
 *
 * Why the SPINNER_INTERVAL mock: same as RunScreen.coaching.test.tsx
 * — pinning the spinner well outside any timer this test advances
 * avoids cascading re-renders blowing past the per-test timeout under
 * parallel-suite load.
 *
 * Why we assert on the `editing ` prefix rather than the bare
 * filename: the filename also appears in the FileWritesPanel below
 * the header, so a contains-filename assertion would always pass
 * even if the pill stayed sticky. The prefix is unique to the
 * TypewriterFilename render — it disappears iff the sticky pill
 * cleared.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../styles.js', async (importActual) => {
  const actual = await importActual<typeof import('../../styles.js')>();
  return {
    ...actual,
    SPINNER_INTERVAL: 60 * 60 * 1000,
  };
});

import { render } from 'ink-testing-library';
import { RunScreen, STALE_FILE_WRITE_MS } from '../RunScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import { TaskStatus } from '../../../wizard-ui.js';
import { PostAgentStepStatus } from '../../../../lib/wizard-session.js';

function seedRunScreenStore() {
  const store = makeStoreForSnapshot({
    runStartedAt: Date.now(),
    installDir: '/tmp/fake',
  });
  store.setTasks([
    {
      label: 'Install SDK',
      activeForm: 'Installing SDK...',
      status: TaskStatus.InProgress,
      done: false,
    },
  ]);
  return store;
}

/** The prefix rendered by TypewriterFilename. Unique to that component. */
const PILL_PREFIX = 'editing ';

const SLOW_TEST_TIMEOUT_MS = 60_000;

describe('RunScreen — sticky currentFile pill clear conditions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    'renders the "editing X" pill while a recent write is in flight',
    async () => {
      const store = seedRunScreenStore();
      store.recordFileChangePlanned({
        path: '/tmp/fake/src/amplitude.ts',
        operation: 'create',
      });
      const { lastFrame } = render(<RunScreen store={store} />);
      // Drive enough fake-time for TypewriterFilename to reveal the
      // path. The component schedules its first char at 25 ms and
      // ticks every 25 ms thereafter; 1s is plenty of headroom for a
      // ~25-char relative path.
      await vi.advanceTimersByTimeAsync(1_000);
      const frame = lastFrame() ?? '';
      expect(frame).toContain(PILL_PREFIX);
      expect(frame).toMatch(/editing\s+src\/amplitude\.ts/);
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it(
    'clears the pill after STALE_FILE_WRITE_MS with no new write activity',
    async () => {
      const store = seedRunScreenStore();
      store.recordFileChangePlanned({
        path: '/tmp/fake/src/amplitude.ts',
        operation: 'create',
      });
      store.recordFileChangeApplied({
        path: '/tmp/fake/src/amplitude.ts',
        operation: 'create',
      });
      const { lastFrame, rerender } = render(<RunScreen store={store} />);
      // Reveal the typewriter so we can confirm the pill IS up in the
      // before-state, then verify it goes away.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(lastFrame() ?? '').toContain(PILL_PREFIX);

      // Quiet period: no further writes, no post-agent steps. Advance
      // past the stale threshold + margin. Spinner is mocked far in
      // the future, so we re-render explicitly — in production the
      // spinner tick drives this re-render naturally on every
      // SPINNER_INTERVAL.
      await vi.advanceTimersByTimeAsync(STALE_FILE_WRITE_MS + 1_000);
      rerender(<RunScreen store={store} />);
      const after = lastFrame() ?? '';
      // The prefix is what's unique to the pill — assert it's gone.
      // The filename itself still appears in FileWritesPanel below.
      expect(after).not.toContain(PILL_PREFIX);
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it(
    'clears the pill immediately when a post-agent step is in flight',
    async () => {
      const store = seedRunScreenStore();
      store.recordFileChangePlanned({
        path: '/tmp/fake/src/amplitude.ts',
        operation: 'create',
      });
      store.recordFileChangeApplied({
        path: '/tmp/fake/src/amplitude.ts',
        operation: 'create',
      });
      const { lastFrame, rerender } = render(<RunScreen store={store} />);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(lastFrame() ?? '').toContain(PILL_PREFIX);

      // Post-agent phase begins — Finalizing panel takes over. The
      // agent is no longer editing files; the pill must clear without
      // waiting for the 10s stale window.
      store.seedPostAgentSteps([
        {
          id: 'commit-events',
          label: 'Commit approved events',
          activeForm: 'Committing approved events...',
          status: PostAgentStepStatus.InProgress,
          startedAt: Date.now(),
        },
      ]);
      rerender(<RunScreen store={store} />);
      // Tiny advance to flush — no 10s wait needed.
      await vi.advanceTimersByTimeAsync(100);
      rerender(<RunScreen store={store} />);
      const after = lastFrame() ?? '';
      expect(after).not.toContain(PILL_PREFIX);
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it(
    'keeps the pill alive while writes are still arriving (heartbeat)',
    async () => {
      const store = seedRunScreenStore();
      store.recordFileChangePlanned({
        path: '/tmp/fake/src/amplitude.ts',
        operation: 'create',
      });
      store.recordFileChangeApplied({
        path: '/tmp/fake/src/amplitude.ts',
        operation: 'create',
      });
      const { lastFrame, rerender } = render(<RunScreen store={store} />);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(lastFrame() ?? '').toContain(PILL_PREFIX);

      // Halfway through the stale window, the agent kicks off another
      // write. The pill stays alive AND switches to the new file.
      await vi.advanceTimersByTimeAsync(STALE_FILE_WRITE_MS / 2);
      store.recordFileChangePlanned({
        path: '/tmp/fake/src/tracking.ts',
        operation: 'modify',
      });
      rerender(<RunScreen store={store} />);
      await vi.advanceTimersByTimeAsync(1_000);

      // Now past the *original* stale threshold but well within the
      // new write's grace window.
      await vi.advanceTimersByTimeAsync(STALE_FILE_WRITE_MS / 2 + 100);
      rerender(<RunScreen store={store} />);
      const after = lastFrame() ?? '';
      // Pill still up.
      expect(after).toContain(PILL_PREFIX);
      // Pointing at the new path now, not the old one (the right-side
      // pill text — old filename still appears in FileWritesPanel
      // below).
      expect(after).toMatch(/editing\s+src\/tracking\.ts/);
    },
    SLOW_TEST_TIMEOUT_MS,
  );
});
