/**
 * ConsoleView — keyboard handling for the event-plan prompt.
 *
 * Bug 3 from the Excalidraw P0 sweep: pressing F on the event-plan prompt
 * exited the plan as if it had been approved instead of switching into
 * feedback-input mode. This suite locks down the contract:
 *
 *   - Y / S resolve the plan with `approved` / `skipped`.
 *   - F switches the prompt into `feedback` input mode WITHOUT resolving
 *     the plan (so the user can type a free-text revision request).
 *   - Resolving via Y / S clears the pending prompt; F does not.
 *
 * Render-level test: we set up a real ConsoleView with a real WizardStore,
 * call `promptEventPlan` to install the event-plan pendingPrompt, then
 * dispatch a single key via ink-testing-library's stdin and assert on the
 * resulting state.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';

import { ConsoleView } from '../ConsoleView.js';
import { WizardStore } from '../../store.js';
import type { PlannedEvent } from '../../store.js';

const CREDS = {
  accessToken: 'tok',
  projectApiKey: 'pk',
  host: 'https://app.amplitude.com',
  appId: 1,
};

const PLAN: PlannedEvent[] = [
  { name: 'app launched', description: 'fired on cold start' },
  { name: 'sign up completed', description: 'sent after first auth' },
];

function makeStore(): WizardStore {
  const store = new WizardStore();
  store.session = {
    ...store.session,
    credentials: CREDS,
    introConcluded: true,
  };
  return store;
}

/**
 * Wait for `pendingPrompt` to land on the store after a `promptEventPlan`
 * call (it's set synchronously, but polling lets us also wait for the
 * subsequent React render cycle so useInput sees `eventPlanPromptShowing`).
 */
async function waitForPendingPrompt(
  store: WizardStore,
  kind: string,
): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (store.pendingPrompt?.kind === kind) {
      // Yield once more so Ink's useInput closure picks up the new render.
      await new Promise((r) => setTimeout(r, 5));
      return;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`pendingPrompt did not land with kind=${kind}`);
}

describe('ConsoleView event-plan key handling', () => {
  it('Y resolves the event-plan as approved', async () => {
    const store = makeStore();
    const decisionPromise = store.promptEventPlan(PLAN);

    const { stdin, unmount } = render(
      <ConsoleView store={store} width={80} height={24} />,
    );
    await waitForPendingPrompt(store, 'event-plan');

    stdin.write('y');
    const decision = await decisionPromise;

    expect(decision).toEqual({ decision: 'approved' });
    expect(store.pendingPrompt).toBeNull();
    unmount();
  });

  it('S resolves the event-plan as skipped', async () => {
    const store = makeStore();
    const decisionPromise = store.promptEventPlan(PLAN);

    const { stdin, unmount } = render(
      <ConsoleView store={store} width={80} height={24} />,
    );
    await waitForPendingPrompt(store, 'event-plan');

    stdin.write('s');
    const decision = await decisionPromise;

    expect(decision).toEqual({ decision: 'skipped' });
    expect(store.pendingPrompt).toBeNull();
    unmount();
  });

  it('F enters feedback mode WITHOUT resolving the event-plan', async () => {
    // Headline regression: F was reported to exit the plan as if approved.
    // The prompt must stay pending — only the local input mode toggles —
    // so the user can then type a free-text revision request.
    const store = makeStore();
    let resolved = false;
    void store.promptEventPlan(PLAN).then(() => {
      resolved = true;
    });

    const { stdin, unmount } = render(
      <ConsoleView store={store} width={80} height={24} />,
    );
    await waitForPendingPrompt(store, 'event-plan');

    stdin.write('f');
    // Give React + Ink a tick to flush the keypress through the second
    // useInput handler.
    await new Promise((r) => setTimeout(r, 30));

    expect(resolved).toBe(false);
    expect(store.pendingPrompt?.kind).toBe('event-plan');
    unmount();
  });

  it('uppercase F also enters feedback mode (case-insensitive)', async () => {
    // The handler lower-cases `char`. Shift-F must behave identically.
    const store = makeStore();
    let resolved = false;
    void store.promptEventPlan(PLAN).then(() => {
      resolved = true;
    });

    const { stdin, unmount } = render(
      <ConsoleView store={store} width={80} height={24} />,
    );
    await waitForPendingPrompt(store, 'event-plan');

    stdin.write('F');
    await new Promise((r) => setTimeout(r, 30));

    expect(resolved).toBe(false);
    expect(store.pendingPrompt?.kind).toBe('event-plan');
    unmount();
  });
});

describe('ConsoleView slash command dispatch — /version', () => {
  it('renders wizard + protocol + Node lines after /version is submitted', async () => {
    // Pin: typing `/version<Enter>` must land the multi-line version
    // summary in commandFeedback so the user can grab the values
    // without exiting the TUI. Catches accidental removal of the case
    // from the switch statement in executeCommand.
    const store = makeStore();

    const { stdin, unmount } = render(
      <ConsoleView store={store} width={80} height={24} />,
    );

    // Wait one tick so the dormant useInput handler mounts.
    await new Promise((r) => setTimeout(r, 10));

    // `/` activates the slash console with `/` as the seed.
    stdin.write('/');
    await new Promise((r) => setTimeout(r, 20));
    // Type the rest of the command.
    stdin.write('version');
    await new Promise((r) => setTimeout(r, 20));
    // Submit. `\r` is what ink-testing-library maps to `key.return`.
    stdin.write('\r');
    // Give the dispatch + setCommandFeedback round-trip a tick.
    await new Promise((r) => setTimeout(r, 30));

    const feedback = store.commandFeedback ?? '';
    expect(feedback).toContain('Amplitude Wizard v');
    expect(feedback).toContain('Agent-mode protocol: v');
    expect(feedback).toContain(`Node: ${process.version}`);

    unmount();
  });
});

describe('ConsoleView screenError key handling', () => {
  it('R clears screenError (existing shortcut still works)', async () => {
    const store = makeStore();
    store.setScreenError(new Error('boom'));

    const { stdin, unmount } = render(
      <ConsoleView store={store} width={80} height={24} />,
    );
    // Yield so the dormant useInput handler mounts and sees screenError.
    await new Promise((r) => setTimeout(r, 10));

    expect(store.screenError).not.toBeNull();

    stdin.write('r');
    await new Promise((r) => setTimeout(r, 20));

    expect(store.screenError).toBeNull();
    unmount();
  });

  it('Enter clears screenError (regression: banner shows [R] retry but users press Enter)', async () => {
    // PR A13 / audit iteration #10: the screen-error banner advertises
    // [R] retry, but the keyboard handler only matched 'r'/'R'. Users
    // focused on a prompt below the banner often try Enter as the
    // default action — accept it as a retry trigger.
    const store = makeStore();
    store.setScreenError(new Error('boom'));

    const { stdin, unmount } = render(
      <ConsoleView store={store} width={80} height={24} />,
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(store.screenError).not.toBeNull();

    // `\r` is what ink-testing-library maps to key.return.
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 20));

    expect(store.screenError).toBeNull();
    unmount();
  });

  it('Enter does NOT clear screenError while pendingPrompt is active (Bugbot regression — picker owns Enter)', async () => {
    // Follow-up to the above: when `screenError` co-exists with a
    // `pendingPrompt` (e.g. an in-flight promptChoice rendering a
    // PickerMenu), the picker's own useScreenInput listens for Enter
    // to commit the focused selection. Accepting Enter at the
    // ConsoleView level would fire BOTH — clearing the error AND
    // committing an unintended picker option. The fix gates the Enter
    // branch on `!pendingPrompt`; `R`/`r` still work unambiguously.
    const store = makeStore();
    store.setScreenError(new Error('boom'));
    // Set a `confirm`-kind pending prompt via the public API. The
    // returned promise resolves when the prompt is answered — we don't
    // await it because the test just needs pendingPrompt to be set.
    void store.promptConfirm('Proceed?');

    const { stdin, unmount } = render(
      <ConsoleView store={store} width={80} height={24} />,
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(store.screenError).not.toBeNull();

    // Enter must NOT clear the error while a prompt is in flight.
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 20));
    expect(store.screenError).not.toBeNull();

    // `R` still works — letter shortcuts don't collide with picker keys.
    stdin.write('R');
    await new Promise((r) => setTimeout(r, 20));
    expect(store.screenError).toBeNull();
    unmount();
  });
});
