/**
 * SignupEmailScreen — minor snapshot pin under WIZARD_NEW_UX=1 (PR 7).
 *
 * The signup screens (Email / FullName / ToS) are listed in the PR 7
 * scope, but their AC overlap is minor — they don't drive OAuth or
 * masked input. This snapshot pins the rendered frame in BOTH the
 * legacy and new-UX paths so the PR 10 sweep can compare with confidence.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  renderSnapshot,
  makeStoreForSnapshot,
} from '../../__tests__/snapshot-utils.js';
import { SignupEmailScreen } from '../SignupEmailScreen.js';

describe('SignupEmailScreen — WIZARD_NEW_UX', () => {
  beforeEach(() => {
    delete process.env.WIZARD_NEW_UX;
  });

  afterEach(() => {
    delete process.env.WIZARD_NEW_UX;
  });

  it('renders the same frame with WIZARD_NEW_UX=1 as without (no UX changes in PR 7)', () => {
    const storeLegacy = makeStoreForSnapshot({
      introConcluded: true,
      authOnboardingPath: 'create_account',
    });
    const legacy = renderSnapshot(
      <SignupEmailScreen store={storeLegacy} />,
      storeLegacy,
    );

    process.env.WIZARD_NEW_UX = '1';
    const storeNew = makeStoreForSnapshot({
      introConcluded: true,
      authOnboardingPath: 'create_account',
    });
    const nextUx = renderSnapshot(
      <SignupEmailScreen store={storeNew} />,
      storeNew,
    );

    // PR 7 doesn't touch the signup-email surface — the rendered output
    // must be byte-identical across the gate so PR 10 (the gate sweep)
    // can safely flip the flag without UX churn here.
    expect(nextUx.frame).toEqual(legacy.frame);
  });
});
