/**
 * DataIngestionCheckScreen — catalog-fetch hang regression test.
 *
 * Hard rule: when the activation API fails AND the catalog fetch hangs,
 * the user must NOT be stuck on "Checking your event catalog…" forever.
 * A 15s `withTimeout` wrapper around the catalog fetch falls through to
 * `setEventTypes([])`, which unblocks the [Enter] / [q] hints.
 *
 * We use vitest fake timers to fast-forward past the 15s timeout instead
 * of waiting in real time — see https://vitest.dev/api/vi.html#vi-usefaketimers.
 *
 * Why module-level imports instead of dynamic imports inside the test:
 * the prior shape (`await import(...)` inside the `it` body, after
 * `vi.useFakeTimers()` had already activated) flaked under parallel-test
 * load. ESM module resolution uses internal microtasks/timers; once fake
 * timers are active, those internals don't make progress until the test
 * explicitly advances the clock, which can cause the import promise to
 * never settle within the 5 s test timeout. Hoisting the imports loads
 * the module ONCE at file load (real timers), then each test just renders
 * against an already-resolved module graph.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';

vi.mock('../../../../lib/api.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../../lib/api.js')>();
  return {
    ...actual,
    // Activation API rejects → screen flips into apiUnavailable=true and
    // launches the catalog-fallback fetch.
    fetchProjectActivationStatus: vi.fn().mockRejectedValue(new Error('boom')),
    // The MCP shortcut returns "no events" so we always fall through to
    // the activation check (which then hits the apiUnavailable branch).
    fetchHasAnyEventsMcp: vi
      .fn()
      .mockResolvedValue({ hasEvents: false, activeEventNames: [] }),
    // Catalog fetch never resolves — this is the hang we're guarding against.
    fetchWorkspaceEventTypes: vi
      .fn()
      .mockImplementation(() => new Promise(() => {})),
    // Lazy resolve path — return a stable user shape so we don't hit the
    // "no orgs" branch and bail before reaching the catalog fallback.
    fetchAmplitudeUser: vi.fn().mockResolvedValue({
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.c',
      orgs: [],
    }),
    extractAppId: () => '12345',
  };
});

import { DataIngestionCheckScreen } from '../DataIngestionCheckScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';

describe('DataIngestionCheckScreen catalog hang', () => {
  beforeEach(() => {
    // Pure fake timers — no `shouldAdvanceTime: true`. The dual-time
    // mode interacts unpredictably with `advanceTimersByTimeAsync`
    // under heavy parallel test load.
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls through to setEventTypes([]) when the catalog fetch hangs past 15s', async () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      activationLevel: 'none',
      selectedOrgId: 'org-1',
      selectedWorkspaceId: 'ws-1' as unknown as never, // branded WorkspaceId
      selectedAppId: '12345',
      credentials: {
        accessToken: 'access',
        idToken: 'id',
        projectApiKey: 'key',
        host: 'https://api2.amplitude.com',
        appId: 12345 as unknown as never,
      } as unknown as never,
    });

    const { lastFrame, unmount } = render(
      <DataIngestionCheckScreen store={store} />,
    );

    // Drain microtasks so the chain
    //   checkIngestion → fetchProjectActivationStatus.reject
    //   → withTimeout(fetchWorkspaceEventTypes, 15s)
    // is in flight, then advance 16s so the timeout rejects.
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
    await vi.advanceTimersByTimeAsync(16_000);
    // One more microtask drain so the catch handler sets eventTypes=[]
    // and React flushes the re-render.
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }

    // eslint-disable-next-line no-control-regex
    const csi = /\x1b\[[0-9;]*[A-Za-z]/g;
    // eslint-disable-next-line no-control-regex
    const osc = /\x1b\][^\x07]*\x07/g;
    const frame = (lastFrame() ?? '').replace(csi, '').replace(osc, '');

    // The "Checking your event catalog…" spinner is gone — eventTypes
    // resolved to [] via the timeout fallback.
    expect(frame).not.toMatch(/Checking your event catalog/);
    // Both recovery actions are visible.
    expect(frame).toMatch(/\[Enter\]/);
    expect(frame).toMatch(/\[q\]/);

    unmount();
  });
});
