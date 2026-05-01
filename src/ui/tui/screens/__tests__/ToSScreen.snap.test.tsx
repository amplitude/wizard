/**
 * ToSScreen — Terms of Service acceptance shown during the --signup flow.
 *
 * Snapshots pin the rendered layout (heading, legal links, picker order,
 * key-hint bar). Behavior is covered separately in
 * `ToSScreen.behavior.test.tsx` because that file mocks PickerMenu —
 * keeping the two concerns in separate files lets the snapshot render
 * the real picker.
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
