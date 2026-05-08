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
import { AuthOnboardingPath } from '../../../../lib/wizard-session.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';

describe('ToSScreen snapshots', () => {
  it('renders the heading, both legal links, and the accept/decline picker', () => {
    // Pin the session at the "ToS is the active screen" point in the
    // create-account flow: intro concluded, zone resolved, email capture
    // done, and `legalDocumentBundle` populated by the parser. This is
    // the only state in which canGoBack() returns true on ToS, which is
    // what triggers `useEscapeBack` to register the [Esc] Back hint we
    // assert on below.
    const store = makeStoreForSnapshot({
      authOnboardingPath: AuthOnboardingPath.CreateAccount,
      introConcluded: true,
      region: 'us',
      emailCaptureComplete: true,
      legalDocumentBundle: {
        terms_of_service: 'https://amplitude.com/terms',
        privacy_policy: 'https://amplitude.com/privacy',
      },
    });
    const { frame, hints } = renderSnapshot(<ToSScreen store={store} />, store);

    expect(frame).toContain('Terms of Service');
    expect(frame).toContain("By continuing, you agree to Amplitude's terms");
    // Both URL labels render — order matters because the screen presents
    // them as a numbered checklist; flipping them would be a regression.
    expect(frame.indexOf('Terms of Service:')).toBeLessThan(
      frame.indexOf('Privacy Policy:'),
    );

    expect(frame).toContain('I accept the Terms of Service and Privacy Policy');
    expect(frame).toContain('I do not accept');
    expect(frame).toContain('This is required to create an Amplitude account');

    // ToS is a hard gate, so the only way out is Esc — assert the hint
    // bar reflects that.
    expect(hints.map((h) => h.key)).toEqual(['↑↓', 'Enter', 'Esc']);

    expect(frame).toMatchSnapshot();
  });

  it('renders the BE-supplied URLs verbatim when the parser passes them through', () => {
    // Pin the URL-source contract: when the parser returns
    // legalDocumentBundle from BE-supplied documents (Phase B/C), the
    // screen must render those URLs — never the local constants. The
    // sentinel URLs below would NEVER appear if the screen were still
    // sourcing from `lib/constants.ts` directly.
    const store = makeStoreForSnapshot({
      authOnboardingPath: AuthOnboardingPath.CreateAccount,
      introConcluded: true,
      region: 'us',
      emailCaptureComplete: true,
      legalDocumentBundle: {
        terms_of_service: 'https://example.test/terms-v2',
        privacy_policy: 'https://example.test/privacy-v2',
      },
    });
    const { frame } = renderSnapshot(<ToSScreen store={store} />, store);

    expect(frame).toContain('https://example.test/terms-v2');
    expect(frame).toContain('https://example.test/privacy-v2');
    expect(frame).not.toContain('amplitude.com/terms');
    expect(frame).not.toContain('amplitude.com/privacy');
  });
});
