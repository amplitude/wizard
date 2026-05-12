// SigningUpScreen — per-required-fields input construction.
// Each optional input slot (`fullName`, `legalDocumentBundle`,
// `legalDocumentSource`) must be present iff the BE asked for the
// corresponding required key; misaligning here sends the BE a body
// asserting acceptance the user wasn't asked to give.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { performSignupOrAuth } from '../../../../utils/signup-or-auth.js';

vi.mock('../../../../utils/signup-or-auth.js', () => ({
  performSignupOrAuth: vi.fn(),
}));

const mockedPerformSignupOrAuth = vi.mocked(performSignupOrAuth);

describe('SigningUpScreen input construction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requiredFields=['full_name']: input has fullName, no bundle/source", async () => {
    // Stub: return a `redirect` so the screen unmounts cleanly without
    // exercising the success-arm side effects (replaceStoredUser etc.).
    mockedPerformSignupOrAuth.mockResolvedValue({ kind: 'redirect' });

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

    expect(mockedPerformSignupOrAuth).toHaveBeenCalledOnce();
    const input = mockedPerformSignupOrAuth.mock.calls[0][0];
    expect(input.kind).toBe('with_required_fields');
    if (input.kind === 'with_required_fields') {
      expect(input.fullName).toBe('Ada Lovelace');
      expect(input.legalDocumentBundle).toBeUndefined();
      expect(input.legalDocumentSource).toBeUndefined();
    }

    unmount();
  });

  it("requiredFields=['terms_acceptance']: input has bundle/source, no fullName", async () => {
    mockedPerformSignupOrAuth.mockResolvedValue({ kind: 'redirect' });

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

    expect(mockedPerformSignupOrAuth).toHaveBeenCalledOnce();
    const input = mockedPerformSignupOrAuth.mock.calls[0][0];
    expect(input.kind).toBe('with_required_fields');
    if (input.kind === 'with_required_fields') {
      expect(input.fullName).toBeUndefined();
      expect(input.legalDocumentBundle).toEqual({
        terms_of_service: 'https://example.test/t',
        privacy_policy: 'https://example.test/p',
      });
      expect(input.legalDocumentSource).toBe('server');
    }

    unmount();
  });

  it("requiredFields=['full_name','terms_acceptance']: input has both", async () => {
    mockedPerformSignupOrAuth.mockResolvedValue({ kind: 'redirect' });

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

    expect(mockedPerformSignupOrAuth).toHaveBeenCalledOnce();
    const input = mockedPerformSignupOrAuth.mock.calls[0][0];
    expect(input.kind).toBe('with_required_fields');
    if (input.kind === 'with_required_fields') {
      expect(input.fullName).toBe('Ada Lovelace');
      expect(input.legalDocumentBundle).toEqual({
        terms_of_service: 'https://example.test/t',
        privacy_policy: 'https://example.test/p',
      });
      expect(input.legalDocumentSource).toBe('server');
    }

    unmount();
  });

  it('signupRequiredFields=null: sends email_only probe', async () => {
    // Stale session fields from a prior abandoned ceremony must not
    // leak into the probe body.
    mockedPerformSignupOrAuth.mockResolvedValue({ kind: 'redirect' });

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

    expect(mockedPerformSignupOrAuth).toHaveBeenCalledOnce();
    const input = mockedPerformSignupOrAuth.mock.calls[0][0];
    expect(input.kind).toBe('email_only');

    unmount();
  });
});
