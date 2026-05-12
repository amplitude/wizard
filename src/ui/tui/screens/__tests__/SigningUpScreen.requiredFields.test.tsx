/**
 * SigningUpScreen — per-required-fields input construction.
 *
 * The screen reads `session.signupRequiredFields` (populated by the
 * parser when the BE returned `needs_information`) and constructs a
 * `kind: 'with_required_fields'` input for the wrapper. Each optional
 * field (`fullName`, `legalDocumentBundle`, `legalDocumentSource`) is
 * present iff the BE asked for the corresponding required key.
 *
 * BA-149 pins this contract via the wrapper's body builder: only the
 * slots the input populates appear in the POST body. Misaligning here
 * would send the BE a body asserting acceptance the user wasn't asked
 * to give (or omitting a field the user did provide).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';

vi.mock('../../../../utils/signup-or-auth.js', () => ({
  performSignupOrAuth: vi.fn(),
}));

describe('SigningUpScreen input construction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requiredFields=['full_name']: input has fullName, no bundle/source", async () => {
    const mod = await import('../../../../utils/signup-or-auth.js');
    const performSignupOrAuth = mod.performSignupOrAuth as ReturnType<
      typeof vi.fn
    >;
    // Stub: return a `redirect` so the screen unmounts cleanly without
    // exercising the success-arm side effects (replaceStoredUser etc.).
    performSignupOrAuth.mockResolvedValue({ kind: 'redirect' });

    const { SigningUpScreen } = await import('../SigningUpScreen.js');
    const { makeStoreForSnapshot } = await import(
      '../../__tests__/snapshot-utils.js'
    );

    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      signupEmail: 'ada@example.com',
      signupFullName: 'Ada Lovelace',
      signupRequiredFields: ['full_name'],
      legalDocumentBundle: null,
      legalDocumentSource: null,
      tosAccepted: null,
    });

    const { unmount } = render(<SigningUpScreen store={store} />);
    await new Promise((r) => setTimeout(r, 50));

    expect(performSignupOrAuth).toHaveBeenCalledOnce();
    const input = performSignupOrAuth.mock.calls[0][0];
    expect(input.kind).toBe('with_required_fields');
    expect(input.fullName).toBe('Ada Lovelace');
    expect(input.legalDocumentBundle).toBeUndefined();
    expect(input.legalDocumentSource).toBeUndefined();

    unmount();
  });

  it("requiredFields=['terms_acceptance']: input has bundle/source, no fullName", async () => {
    const mod = await import('../../../../utils/signup-or-auth.js');
    const performSignupOrAuth = mod.performSignupOrAuth as ReturnType<
      typeof vi.fn
    >;
    performSignupOrAuth.mockResolvedValue({ kind: 'redirect' });

    const { SigningUpScreen } = await import('../SigningUpScreen.js');
    const { makeStoreForSnapshot } = await import(
      '../../__tests__/snapshot-utils.js'
    );

    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      signupEmail: 'ada@example.com',
      signupFullName: null,
      signupRequiredFields: ['terms_acceptance'],
      legalDocumentBundle: {
        terms_of_service: 'https://example.test/t',
        privacy_policy: 'https://example.test/p',
      },
      legalDocumentSource: 'server',
      tosAccepted: true,
    });

    const { unmount } = render(<SigningUpScreen store={store} />);
    await new Promise((r) => setTimeout(r, 50));

    expect(performSignupOrAuth).toHaveBeenCalledOnce();
    const input = performSignupOrAuth.mock.calls[0][0];
    expect(input.kind).toBe('with_required_fields');
    expect(input.fullName).toBeUndefined();
    expect(input.legalDocumentBundle).toEqual({
      terms_of_service: 'https://example.test/t',
      privacy_policy: 'https://example.test/p',
    });
    expect(input.legalDocumentSource).toBe('server');

    unmount();
  });

  it("requiredFields=['full_name','terms_acceptance']: input has both", async () => {
    const mod = await import('../../../../utils/signup-or-auth.js');
    const performSignupOrAuth = mod.performSignupOrAuth as ReturnType<
      typeof vi.fn
    >;
    performSignupOrAuth.mockResolvedValue({ kind: 'redirect' });

    const { SigningUpScreen } = await import('../SigningUpScreen.js');
    const { makeStoreForSnapshot } = await import(
      '../../__tests__/snapshot-utils.js'
    );

    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      signupEmail: 'ada@example.com',
      signupFullName: 'Ada Lovelace',
      signupRequiredFields: ['full_name', 'terms_acceptance'],
      legalDocumentBundle: {
        terms_of_service: 'https://example.test/t',
        privacy_policy: 'https://example.test/p',
      },
      legalDocumentSource: 'server',
      tosAccepted: true,
    });

    const { unmount } = render(<SigningUpScreen store={store} />);
    await new Promise((r) => setTimeout(r, 50));

    expect(performSignupOrAuth).toHaveBeenCalledOnce();
    const input = performSignupOrAuth.mock.calls[0][0];
    expect(input.kind).toBe('with_required_fields');
    expect(input.fullName).toBe('Ada Lovelace');
    expect(input.legalDocumentBundle).toEqual({
      terms_of_service: 'https://example.test/t',
      privacy_policy: 'https://example.test/p',
    });
    expect(input.legalDocumentSource).toBe('server');

    unmount();
  });

  it('signupRequiredFields=null: sends email_only probe', async () => {
    // Pins the "no needs_information response yet" path: the screen
    // probes with `kind: 'email_only'` regardless of what session.signupFullName
    // or session.legalDocumentBundle happen to hold (those could be
    // populated from a prior abandoned ceremony's leftovers).
    const mod = await import('../../../../utils/signup-or-auth.js');
    const performSignupOrAuth = mod.performSignupOrAuth as ReturnType<
      typeof vi.fn
    >;
    performSignupOrAuth.mockResolvedValue({ kind: 'redirect' });

    const { SigningUpScreen } = await import('../SigningUpScreen.js');
    const { makeStoreForSnapshot } = await import(
      '../../__tests__/snapshot-utils.js'
    );

    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      signupEmail: 'ada@example.com',
      signupFullName: null,
      signupRequiredFields: null,
      legalDocumentBundle: null,
      legalDocumentSource: null,
      tosAccepted: null,
    });

    const { unmount } = render(<SigningUpScreen store={store} />);
    await new Promise((r) => setTimeout(r, 50));

    expect(performSignupOrAuth).toHaveBeenCalledOnce();
    const input = performSignupOrAuth.mock.calls[0][0];
    expect(input.kind).toBe('email_only');

    unmount();
  });
});
