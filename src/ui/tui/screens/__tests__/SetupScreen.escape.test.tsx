/**
 * SetupScreen — Esc-as-escape-hatch regression test.
 *
 * Hard rule: the disambiguation prompt must NEVER be a dead-end. When a
 * user lands on a question they don't understand and there's nothing to
 * pop (no prior user answers) and no history to go back to, Esc must
 * route them to the cancel outro instead of swallowing the keystroke.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { SetupScreen } from '../SetupScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import { Integration } from '../../../../lib/constants.js';
import type { FrameworkConfig } from '../../../../lib/framework-config.js';
import { OutroKind } from '../../session-constants.js';

function makeConfigWithUnresolvable(): FrameworkConfig {
  return {
    metadata: {
      integration: Integration.django,
      name: 'Django',
      glyph: '🐍',
      glyphColor: 'green',
      targetsBrowser: false,
      setup: {
        questions: [
          {
            key: 'router',
            message: 'Which router does your project use?',
            options: [
              { label: 'Django default', value: 'django' },
              { label: 'Wagtail', value: 'wagtail' },
            ],
            // Detection returns null → user must answer. With no prior
            // answers and no goBack history, Esc has nothing to do but
            // fall through to the cancel outro.
            detect: () => Promise.resolve(null),
          },
        ],
      },
    },
    detect: () => Promise.resolve(false),
    buildSystemPrompt: () => Promise.resolve(''),
    needsSetup: () => true,
    buildContext: () => Promise.resolve({}),
  } as unknown as FrameworkConfig;
}

describe('SetupScreen Esc-as-escape-hatch', () => {
  it('routes to cancel outro when there is nothing to pop and nowhere to go back', async () => {
    const store = makeStoreForSnapshot({
      integration: Integration.django,
      frameworkConfig: makeConfigWithUnresolvable(),
    });

    const { stdin, unmount } = render(<SetupScreen store={store} />);

    // Wait for detection to complete (resolves to null), screen renders
    // the question. By default canGoBack() is false on a fresh store and
    // frameworkContextAnswerOrder is empty — exactly the dead-end case.
    // Poll for resolving=false rather than a fixed sleep so the test
    // doesn't flake on slower CI runs that stall the React effect chain.
    for (let i = 0; i < 50; i++) {
      if (
        store.session.frameworkContextAnswerOrder.length === 0 &&
        // resolving flips to false after the on-mount async detect() loop;
        // the screen reaches the question render only once that lands.
        // We can't read `resolving` directly (component-local), but the
        // detection has settled when frameworkContext is stable AND no
        // microtasks are pending — proxy via a tick-of-quiet wait.
        i > 5
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(store.session.frameworkContextAnswerOrder).toHaveLength(0);
    expect(store.canGoBack()).toBe(false);

    // Press Esc. With no pop target and no back history, the screen MUST
    // set the cancel outro rather than swallow the keystroke. Poll for
    // outroData to appear instead of a fixed sleep.
    stdin.write('\x1b');
    for (let i = 0; i < 25; i++) {
      if (store.session.outroData !== null) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(store.session.outroData).not.toBeNull();
    expect(store.session.outroData?.kind).toBe(OutroKind.Cancel);
    expect(store.session.outroData?.message).toMatch(
      /Setup paused|resume|when you're ready/i,
    );

    unmount();
  });
});
