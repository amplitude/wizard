/**
 * SigningUpScreen — `alreadySatisfied` defensive abandon path.
 *
 * If the server returns `kind: 'needs_information'` for a field we already
 * populated (e.g. `full_name` after we sent it), the ceremony cannot make
 * progress: `useAsyncEffect`'s deps `[email, fullName]` won't change on a
 * subsequent `setSignupRequiredFields` write, so the screen would never
 * re-fire and the user would wedge on the spinner forever. The screen's
 * defensive guard (SigningUpScreen.tsx:123–133) detects this and routes to
 * browser OAuth via `setSignupAbandoned(true)` instead.
 *
 * This is a safety net against a server bug, but its failure mode has zero
 * in-band recovery, so we pin it with a regression test.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';

vi.mock('../../../../utils/signup-or-auth.js', () => ({
  performSignupOrAuth: vi.fn(),
}));

describe('SigningUpScreen alreadySatisfied', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('abandons when server re-requests an already-provided field', async () => {
    const mod = await import('../../../../utils/signup-or-auth.js');
    (mod.performSignupOrAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: 'needs_information',
      requiredFields: ['full_name', 'terms_acceptance'],
      legalDocumentBundle: {
        terms_of_service: 'https://amplitude.com/terms',
        privacy_policy: 'https://amplitude.com/privacy',
      },
      legalDocumentSource: 'local',
    });

    const { SigningUpScreen } = await import('../SigningUpScreen.js');
    const { makeStoreForSnapshot } = await import(
      '../../__tests__/snapshot-utils.js'
    );

    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      signupEmail: 'ada@example.com',
      signupFullName: 'Ada Lovelace',
      tosAccepted: true,
    });

    const { unmount } = render(<SigningUpScreen store={store} />);
    await new Promise((r) => setTimeout(r, 50));

    expect(store.session.signupAbandoned).toBe(true);
    // The guard must NOT write the server's requested fields onto the
    // session — doing so would leave us in `needs_information` UI state
    // alongside an abandon flag, confusing the router.
    expect(store.session.signupRequiredFields).toBe(null);

    unmount();
  });

  it("abandons in full_name-only flow when server re-requests 'full_name' (tosAccepted stays null)", async () => {
    // Regression test for BA-149: in full_name-only flows the ToS screen
    // never runs, so `session.tosAccepted` stays `null`. The outer-scope
    // derived `fullName` in SigningUpScreen is gated on
    // `tosAccepted === true`, which would have made the alreadySatisfied
    // guard's full_name arm read `false` even though `signupFullName` was
    // populated — letting the screen fall through to a stuck-spinner
    // deadlock on a server bug. The fix reads `session.signupFullName`
    // directly, matching the gate in `flows.ts:requiredSatisfied`.
    const mod = await import('../../../../utils/signup-or-auth.js');
    (mod.performSignupOrAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: 'needs_information',
      requiredFields: ['full_name'],
      legalDocumentBundle: null,
      legalDocumentSource: 'server',
    });

    const { SigningUpScreen } = await import('../SigningUpScreen.js');
    const { makeStoreForSnapshot } = await import(
      '../../__tests__/snapshot-utils.js'
    );

    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      signupEmail: 'ada@example.com',
      // Critical setup: name is supplied (we already sent it), but
      // tosAccepted stays null because no ToS screen ran in this flow.
      signupFullName: 'Ada Lovelace',
      tosAccepted: null,
    });

    const { unmount } = render(<SigningUpScreen store={store} />);
    await new Promise((r) => setTimeout(r, 50));

    expect(store.session.signupAbandoned).toBe(true);
    expect(store.session.signupRequiredFields).toBe(null);

    unmount();
  });

  it('does NOT abandon when server requests a field we have not yet supplied', async () => {
    // Negative case: pins the *other* side of the alreadySatisfied check so
    // a future refactor that inverts the predicate would fail one of these
    // two tests.
    const mod = await import('../../../../utils/signup-or-auth.js');
    (mod.performSignupOrAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: 'needs_information',
      requiredFields: ['full_name', 'terms_acceptance'],
      legalDocumentBundle: {
        terms_of_service: 'https://amplitude.com/terms',
        privacy_policy: 'https://amplitude.com/privacy',
      },
      legalDocumentSource: 'local',
    });

    const { SigningUpScreen } = await import('../SigningUpScreen.js');
    const { makeStoreForSnapshot } = await import(
      '../../__tests__/snapshot-utils.js'
    );

    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      signupEmail: 'ada@example.com',
      signupFullName: null,
      tosAccepted: null,
    });

    const { unmount } = render(<SigningUpScreen store={store} />);
    await new Promise((r) => setTimeout(r, 50));

    expect(store.session.signupAbandoned).toBe(false);
    expect(store.session.signupRequiredFields).toEqual([
      'full_name',
      'terms_acceptance',
    ]);
    // Wire-through invariant: when the wrapper returns
    // needs_information, the screen writes both legal-doc fields into
    // the session lock-step with signupRequiredFields.
    expect(store.session.legalDocumentBundle).toEqual({
      terms_of_service: 'https://amplitude.com/terms',
      privacy_policy: 'https://amplitude.com/privacy',
    });
    expect(store.session.legalDocumentSource).toBe('local');

    unmount();
  });
});
