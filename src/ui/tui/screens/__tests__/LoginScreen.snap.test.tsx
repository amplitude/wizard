/**
 * LoginScreen — `/login` slash command overlay.
 *
 * The screen kicks off a silent OAuth refresh on mount via dynamic imports.
 * For a deterministic snapshot we render the initial Refreshing frame and
 * unmount immediately, before the async useEffect can resolve. That gives
 * us a clean spinner-state snapshot that doesn't depend on disk state
 * or network mocks.
 *
 * (We rely on `renderSnapshot`'s synchronous unmount — see
 * `snapshot-utils.tsx` — which captures `lastFrame()` immediately after
 * the first render.)
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { LoginScreen } from '../LoginScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';

describe('LoginScreen snapshots', () => {
  it('renders the "Refreshing credentials" spinner state on mount', () => {
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <LoginScreen store={store} onComplete={() => undefined} />,
      store,
    );
    expect(frame).toContain('Re-authenticate');
    expect(frame).toContain('Refreshing credentials');
    expect(frame).toMatchSnapshot();
  });
});
