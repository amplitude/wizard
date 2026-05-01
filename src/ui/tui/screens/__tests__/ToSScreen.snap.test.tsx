/**
 * ToSScreen — Terms of Service acceptance shown during the --signup flow.
 *
 * Static screen with no async effects. Single state to snapshot — the
 * picker layout is what matters; behavior (accept/decline → store
 * mutator) is covered by the screen's prop wiring at runtime.
 */

import React from 'react';
import { describe, expect, it } from 'vitest';
import { ToSScreen } from '../ToSScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';

describe('ToSScreen snapshots', () => {
  it('renders the heading, both legal links, and the accept/decline picker', () => {
    const store = makeStoreForSnapshot();
    const { frame, hints } = renderSnapshot(<ToSScreen store={store} />, store);

    expect(frame).toContain('Terms of Service');
    expect(frame).toContain("By continuing, you agree to Amplitude's terms");
    // Both URL labels render — order matters because the screen presents
    // them as a numbered checklist; flipping them would be a regression.
    expect(frame.indexOf('Terms:')).toBeLessThan(frame.indexOf('Privacy:'));

    expect(frame).toContain('I accept the Terms of Service and Privacy Policy');
    expect(frame).toContain('I do not accept');
    expect(frame).toContain('This is required to create an Amplitude account');

    // ToS is a hard gate, so the only way out is Esc — assert the hint
    // bar reflects that.
    expect(hints.map((h) => h.key)).toEqual(['↑↓', 'Enter', 'Esc']);

    expect(frame).toMatchSnapshot();
  });
});
