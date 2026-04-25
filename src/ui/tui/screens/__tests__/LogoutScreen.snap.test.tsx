import React from 'react';
import { describe, it, expect } from 'vitest';
import { LogoutScreen } from '../LogoutScreen.js';
import {
  renderSnapshot,
  makeStoreForSnapshot,
} from '../../__tests__/snapshot-utils.js';

describe('LogoutScreen snapshots', () => {
  it('renders the initial confirm prompt', () => {
    const store = makeStoreForSnapshot();
    // LogoutScreen takes callback props rather than a store. Pass no-ops —
    // initial render is pure (the disk-clearing side effects only fire on
    // confirm, which we don't trigger here).
    const { frame } = renderSnapshot(
      <LogoutScreen
        onComplete={() => undefined}
        installDir={'/tmp/example'}
        onLoggedOut={() => undefined}
      />,
      store,
    );
    expect(frame).toMatchSnapshot();
  });
});
