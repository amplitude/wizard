/**
 * SetupScreen — re-detection on back-nav regression test.
 *
 * When a user pops a previously-answered question via Esc back-nav,
 * SetupScreen must re-run that question's `detect()` so an answer that
 * was originally auto-detected is re-resolved instead of forcing the
 * user to re-answer it manually. The detection effect is keyed off
 * `frameworkContextAnswerOrder.length` so it re-fires whenever an
 * answer is popped.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { SetupScreen } from '../SetupScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import { Integration } from '../../../../lib/constants.js';
import type { FrameworkConfig } from '../../../../lib/framework-config.js';

function makeConfig(detect: () => Promise<unknown>): FrameworkConfig {
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
            detect,
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

describe('SetupScreen re-detection on pop', () => {
  it('re-runs detect() after popLastFrameworkContextAnswer', async () => {
    const detect = vi.fn().mockResolvedValue('django');
    const store = makeStoreForSnapshot({
      integration: Integration.django,
      frameworkConfig: makeConfig(detect),
    });

    const { unmount } = render(<SetupScreen store={store} />);

    // Wait a tick so the initial useEffect's promise chain completes.
    await new Promise((r) => setTimeout(r, 150));
    expect(detect).toHaveBeenCalledTimes(1);
    expect(store.session.frameworkContext['router']).toBe('django');

    // Simulate the user manually changing the answer (so it's tracked
    // in frameworkContextAnswerOrder). setFrameworkContext with
    // autoDetected=false adds the key to the order list.
    store.setFrameworkContext('router', 'wagtail');
    expect(store.session.frameworkContextAnswerOrder).toContain('router');
    await new Promise((r) => setTimeout(r, 150));

    // Now back-nav: pop the answer. This triggers re-detection because
    // the SetupScreen's detect-effect depends on
    // frameworkContextAnswerOrder.length.
    store.popLastFrameworkContextAnswer();
    expect(store.session.frameworkContext['router']).toBeUndefined();
    await new Promise((r) => setTimeout(r, 150));

    // detect() ran again because the deps changed and 'router' was
    // missing from frameworkContext on the re-fire.
    expect(detect).toHaveBeenCalledTimes(2);
    // And re-applied its result.
    expect(store.session.frameworkContext['router']).toBe('django');

    unmount();
  });

  it('does not re-run detect() for keys that already have an answer', async () => {
    const detect = vi.fn().mockResolvedValue('django');
    const store = makeStoreForSnapshot({
      integration: Integration.django,
      frameworkConfig: makeConfig(detect),
    });

    const { unmount } = render(<SetupScreen store={store} />);

    await new Promise((r) => setTimeout(r, 150));
    expect(detect).toHaveBeenCalledTimes(1);

    // Add a *different* user answer so the order length changes without
    // popping the auto-detected key.
    store.setFrameworkContext('router', 'wagtail');
    await new Promise((r) => setTimeout(r, 150));

    // Detection effect fires on length-change, but skips because router
    // is already in frameworkContext (the user answer is present).
    // detect() should not have been re-invoked since router is set.
    expect(detect).toHaveBeenCalledTimes(1);

    unmount();
  });
});
