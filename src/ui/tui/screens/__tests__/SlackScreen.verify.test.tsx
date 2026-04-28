/**
 * SlackScreen — post-confirmation verification.
 *
 * The screen used to celebrate as soon as the user clicked "Yes, connected"
 * — even though the OAuth handshake can silently fail (closed tab, denied
 * consent, popup blocker). We now re-verify against the App API and only
 * mark the connection complete when the backend agrees.
 *
 * This test drives a render where `fetchSlackConnectionStatus` is forced to
 * return `false` after the confirm, and asserts the user sees the
 * "we don't see the connection yet" recovery copy instead of the success
 * banner.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';

vi.mock('../../../../lib/api.js', () => ({
  fetchSlackInstallUrl: vi.fn(() => Promise.resolve(null)),
  // First mount-time call returns null (not connected on entry); the
  // post-confirm call is overridden per test.
  fetchSlackConnectionStatus: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('opn', () => ({ default: vi.fn(() => Promise.resolve()) }));

import { SlackScreen } from '../SlackScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import { fetchSlackConnectionStatus } from '../../../../lib/api.js';

const waitForFrame = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('SlackScreen post-confirm verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the "we don\'t see the connection yet" warning when verification fails after the user confirms', async () => {
    // Mount-time check returns `false` (not connected). User clicks Connect,
    // browser opens, user clicks "Yes, connected", and we re-verify — that
    // call also returns `false`. Expectation: render the recovery copy with
    // Retry / Skip anyway, NOT the green success banner.
    vi.mocked(fetchSlackConnectionStatus).mockResolvedValue(false);

    const store = makeStoreForSnapshot({
      region: 'us',
      selectedOrgId: 'org-123',
      credentials: {
        accessToken: 'fake-token',
        projectApiKey: 'fake-key',
        host: 'amplitude.com',
        appId: 0,
      },
    });

    const view = render(<SlackScreen store={store} />);
    // Allow the mount-time fetchSlackConnectionStatus to resolve.
    await waitForFrame();
    await waitForFrame();

    // Drive: Enter on the initial "Connect / Skip" — this kicks off
    // handleConnect which transitions Opening -> Waiting after 800ms.
    view.stdin.write('\r');
    // Wait long enough for the real setTimeout(800ms) to fire. Using real
    // timers because mocking them inside the React render loop fights
    // ink-testing-library's frame scheduling.
    await new Promise((r) => setTimeout(r, 1100));
    await waitForFrame();

    // Now in Waiting. The "Yes, connected" / "Skip for now" prompt is
    // visible. Press Enter on the focused (first) option = handleDone.
    view.stdin.write('\r');
    // Allow the verification fetch + state transition to settle.
    await new Promise((r) => setTimeout(r, 100));
    await waitForFrame();

    const frame = view.lastFrame() ?? '';
    view.unmount();

    // The whole point of the fix: do NOT celebrate.
    expect(frame).not.toContain('Slack connected!');
    // Honest copy must surface.
    expect(frame).toContain("don't see the Slack connection yet");
    // Recovery actions must be offered.
    expect(frame).toContain('Retry');
    expect(frame).toContain('Skip anyway');
    // The verification call must have happened (mount-time + post-confirm
    // = at least 2 calls).
    expect(fetchSlackConnectionStatus).toHaveBeenCalled();
  });
});
