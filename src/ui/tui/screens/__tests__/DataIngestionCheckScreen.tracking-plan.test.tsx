/**
 * DataIngestionCheckScreen — tracking-plan + skip-guard regression tests.
 *
 * Three behaviors that landed together (Cassie's launch feedback):
 *   1. Render the tracking plan inline so users can see what to trigger
 *   2. Tick off events progressively as they arrive (live arrival feel)
 *   3. Two-step skip guard when no events have been observed
 *
 * Real timers + `waitForFrame` (two `setImmediate` ticks) are used to
 * drive the chain: stdin → ink dispatch → React commit → useEffect flush
 * deterministically. See `ink-stdin.ts` for the rationale; naive
 * `setTimeout(0)` drains microtasks but races ink's scheduler.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';

vi.mock('../../../../utils/ampli-settings.js', () => ({
  getStoredUser: () => undefined,
  getStoredToken: () => undefined,
  storeToken: () => {},
}));
vi.mock('../../../../utils/oauth.js', () => ({
  refreshAccessToken: () => Promise.resolve(null),
}));

const fetchHasAnyEventsMcpMock = vi.hoisted(() => vi.fn());
const fetchProjectActivationStatusMock = vi.hoisted(() => vi.fn());
const fetchProjectEventTypesMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/api.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../../lib/api.js')>();
  return {
    ...actual,
    fetchHasAnyEventsMcp: fetchHasAnyEventsMcpMock,
    fetchProjectActivationStatus: fetchProjectActivationStatusMock,
    fetchProjectEventTypes: fetchProjectEventTypesMock,
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
import { waitForFrame } from '../../__tests__/ink-stdin.js';
import { Integration } from '../../../../lib/constants.js';
import { OutroKind } from '../../session-constants.js';

// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\x1b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC = /\x1b\][^\x07]*\x07/g;
const stripAnsi = (s: string): string =>
  s.replace(ANSI_CSI, '').replace(ANSI_OSC, '');

function writeEventPlan(
  installDir: string,
  events: Array<{ name: string; description: string }>,
): void {
  const dir = path.join(installDir, '.amplitude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify(events));
}

function makeStore(installDir: string) {
  return makeStoreForSnapshot({
    installDir,
    introConcluded: true,
    region: 'us',
    integration: Integration.nextjs,
    activationLevel: 'none',
    selectedOrgId: 'org-1',
    selectedProjectId: 'ws-1',
    selectedAppId: '12345',
    credentials: {
      accessToken: 'access',
      idToken: 'id',
      projectApiKey: 'key',
      host: 'https://api2.amplitude.com',
      appId: 12345 as unknown as never,
    } as unknown as never,
  });
}

/**
 * Drain async chains (poll → setState → re-render). Uses a real
 * setTimeout to allow dynamic `import()` resolution (which requires
 * I/O-level scheduling, not just microtask/setImmediate ticks), then
 * follows with setImmediate frames so React commits land.
 */
async function settle(ms = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
  for (let i = 0; i < 4; i++) await waitForFrame();
}

describe('DataIngestionCheckScreen — tracking plan + skip guard', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wizard-tracking-plan-test-'),
    );
    fetchHasAnyEventsMcpMock.mockReset();
    fetchProjectActivationStatusMock.mockReset();
    fetchProjectEventTypesMock.mockReset();
    // Default: poll responds with no events. Individual tests override.
    fetchHasAnyEventsMcpMock.mockResolvedValue({
      hasEvents: false,
      activeEventNames: [],
      activeUsers: [],
      csvRows: [],
    });
    fetchProjectActivationStatusMock.mockResolvedValue({
      hasAnyEvents: false,
      hasDetSource: false,
      hasPageViewedEvent: false,
      hasSessionStartEvent: false,
      hasSessionEndEvent: false,
    });
    fetchProjectEventTypesMock.mockResolvedValue([]);
  });

  afterEach(() => {
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  it('renders the planned events from .amplitude/events.json on mount', () => {
    writeEventPlan(installDir, [
      { name: 'Page Viewed', description: 'A page was viewed' },
      { name: 'Button Clicked', description: 'A button was clicked' },
    ]);

    const store = makeStore(installDir);
    const { lastFrame, unmount } = render(
      <DataIngestionCheckScreen store={store} />,
    );

    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Tracking plan');
    expect(frame).toContain('Page Viewed');
    expect(frame).toContain('Button Clicked');
    // Trigger-any-of-these prompt before any events arrive.
    expect(frame).toContain('trigger any of these');

    unmount();
  });

  it('renders nothing tracking-plan-related when no events.json exists', () => {
    const store = makeStore(installDir);
    const { lastFrame, unmount } = render(
      <DataIngestionCheckScreen store={store} />,
    );

    const frame = stripAnsi(lastFrame() ?? '');
    // The "Tracking plan" header only renders when we know the plan.
    expect(frame).not.toContain('Tracking plan');
    // Generic listening copy is still present so users aren't confused.
    expect(frame).toContain('Start your app and trigger some user actions');

    unmount();
  });

  it('checks off planned events as they are observed via MCP polling', async () => {
    writeEventPlan(installDir, [
      { name: 'Page Viewed', description: 'A page was viewed' },
      { name: 'Button Clicked', description: 'A button was clicked' },
      { name: 'Form Submitted', description: 'Form submitted' },
    ]);

    // First poll: only one of the three planned events has fired. Use
    // mockResolvedValue (not Once) so subsequent re-poll cycles also
    // return this — the React-state-update-then-re-render cycle inside
    // ink can occasionally fire a second checkIngestion before the
    // first's setState commits.
    fetchHasAnyEventsMcpMock.mockResolvedValue({
      hasEvents: false,
      activeEventNames: ['Page Viewed'],
      activeUsers: [],
      csvRows: [],
    });

    const store = makeStore(installDir);
    const { lastFrame, unmount } = render(
      <DataIngestionCheckScreen store={store} />,
    );

    await settle(150);

    const frame = stripAnsi(lastFrame() ?? '');
    // Header reflects the partial observation count.
    expect(frame).toMatch(/1 of 3 observed/);
    // All three planned events are still listed.
    expect(frame).toContain('Page Viewed');
    expect(frame).toContain('Button Clicked');
    expect(frame).toContain('Form Submitted');

    unmount();
  });

  it('shows the skip-confirm prompt when Enter is pressed with no observed events', async () => {
    // Trigger apiUnavailable so Enter is wired up: activation API rejects.
    fetchProjectActivationStatusMock.mockRejectedValue(new Error('boom'));
    // Catalog returns empty so we don't fall into the cataloged-events
    // branch that auto-confirms.
    fetchProjectEventTypesMock.mockResolvedValue([]);

    const store = makeStore(installDir);
    const { lastFrame, stdin, unmount } = render(
      <DataIngestionCheckScreen store={store} />,
    );

    // Drain frames so MCP poll resolves, activation API rejects, catalog
    // fetch resolves, and apiUnavailable + eventTypes=[] commit.
    await settle(150);

    // Sanity-check we're in the apiUnavailable state before pressing Enter.
    const preEnterFrame = stripAnsi(lastFrame() ?? '');
    expect(preEnterFrame).toContain('[Enter]');

    const setDataIngestionConfirmedSpy = vi.spyOn(
      store,
      'setDataIngestionConfirmed',
    );
    stdin.write('\r');
    await settle();

    expect(setDataIngestionConfirmedSpy).not.toHaveBeenCalled();
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('No events detected yet');
    expect(frame).toContain('Continue without verifying');

    unmount();
  });

  it('confirms verification when the skip-confirm prompt is acknowledged with y', async () => {
    fetchProjectActivationStatusMock.mockRejectedValue(new Error('boom'));
    fetchProjectEventTypesMock.mockResolvedValue([]);

    const store = makeStore(installDir);
    const setDataIngestionConfirmedSpy = vi.spyOn(
      store,
      'setDataIngestionConfirmed',
    );
    const { stdin, unmount } = render(
      <DataIngestionCheckScreen store={store} />,
    );

    await settle(150);

    // First Enter → surfaces skip-confirm.
    stdin.write('\r');
    await settle();
    expect(setDataIngestionConfirmedSpy).not.toHaveBeenCalled();

    // 'y' → actually confirms.
    stdin.write('y');
    await settle();
    expect(setDataIngestionConfirmedSpy).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('skips the guard when cataloged events provide a fallback signal', async () => {
    fetchProjectActivationStatusMock.mockRejectedValue(new Error('boom'));
    // Catalog returns names — that's the user's positive signal that
    // events have been registered, so Enter should pass straight through.
    fetchProjectEventTypesMock.mockResolvedValue(['Page Viewed']);

    const store = makeStore(installDir);
    const setDataIngestionConfirmedSpy = vi.spyOn(
      store,
      'setDataIngestionConfirmed',
    );
    const { stdin, unmount } = render(
      <DataIngestionCheckScreen store={store} />,
    );

    // Wait for the catalog fetch to resolve before pressing Enter.
    await settle(150);

    stdin.write('\r');
    await settle();

    expect(setDataIngestionConfirmedSpy).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('shows skip-confirm when q is pressed while still listening (healthy API path)', async () => {
    const store = makeStore(installDir);
    const { lastFrame, stdin, unmount } = render(
      <DataIngestionCheckScreen store={store} />,
    );

    await settle(150);

    const setDataIngestionConfirmedSpy = vi.spyOn(
      store,
      'setDataIngestionConfirmed',
    );
    stdin.write('q');
    await settle();

    expect(setDataIngestionConfirmedSpy).not.toHaveBeenCalled();
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('No events detected yet');
    expect(frame).toContain('Continue without verifying');

    stdin.write('y');
    await settle();
    expect(setDataIngestionConfirmedSpy).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('exits with cancel outro when x is pressed', async () => {
    const store = makeStore(installDir);
    const setOutroSpy = vi.spyOn(store, 'setOutroData');
    const { stdin, unmount } = render(
      <DataIngestionCheckScreen store={store} />,
    );

    await settle(150);

    stdin.write('x');
    await settle();

    expect(setOutroSpy).toHaveBeenCalledTimes(1);
    const call = setOutroSpy.mock.calls[0]?.[0];
    expect(call?.kind).toBe(OutroKind.Cancel);

    unmount();
  });
});
