import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { SigningUpScreen } from '../SigningUpScreen.js';
import { makeScreenTestStore } from '../../__tests__/screen-test-utils.js';

const mockPerformSignupOrAuth = vi.fn();
vi.mock('../../../../utils/signup-or-auth.js', () => ({
  performSignupOrAuth: (...args: unknown[]) => mockPerformSignupOrAuth(...args),
}));

function makeStore(fullName: string | null = null) {
  return makeScreenTestStore({
    signup: true,
    signupEmail: 'jane@example.com',
    signupFullName: fullName,
    region: 'us',
  });
}

beforeEach(() => {
  mockPerformSignupOrAuth.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SigningUpScreen — success arm', () => {
  it('POSTs with session values and writes signupAuth on success', async () => {
    mockPerformSignupOrAuth.mockResolvedValueOnce({
      kind: 'success',
      idToken: 'id',
      accessToken: 'acc',
      refreshToken: 'ref',
      zone: 'us',
      userInfo: null,
    });
    const store = makeStore('Jane Doe');
    render(<SigningUpScreen store={store} />);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockPerformSignupOrAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'jane@example.com',
        fullName: 'Jane Doe',
        zone: 'us',
      }),
      expect.anything(),
    );
    expect(store.session.signupAuth).not.toBeNull();
    expect(store.session.signupAbandoned).toBe(false);
  });
});

describe('SigningUpScreen — needs_information arm (happy path)', () => {
  it('writes signupRequiredFields when unmet fields exist', async () => {
    mockPerformSignupOrAuth.mockResolvedValueOnce({
      kind: 'needs_information',
      requiredFields: ['full_name'],
    });
    const store = makeStore(null);
    render(<SigningUpScreen store={store} />);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.session.signupRequiredFields).toEqual(['full_name']);
    expect(store.session.signupAbandoned).toBe(false);
  });
});

describe('SigningUpScreen — needs_information arm (all fields already sent)', () => {
  it('sets signupAbandoned after ~1s when no unmet fields', async () => {
    mockPerformSignupOrAuth.mockResolvedValueOnce({
      kind: 'needs_information',
      requiredFields: ['full_name'],
    });
    const store = makeStore('Jane Doe'); // full_name already on session
    render(<SigningUpScreen store={store} />);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.session.signupAbandoned).toBe(false); // not yet — holding
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.session.signupAbandoned).toBe(true);
  });
});

describe('SigningUpScreen — needs_information with unknown field', () => {
  it('sets signupAbandoned after ~1s on unknown field', async () => {
    mockPerformSignupOrAuth.mockResolvedValueOnce({
      kind: 'needs_information',
      requiredFields: ['full_name', 'department'],
    });
    const store = makeStore(null);
    render(<SigningUpScreen store={store} />);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.session.signupAbandoned).toBe(true);
    expect(store.session.signupRequiredFields).toEqual([]); // never written
  });
});

describe('SigningUpScreen — requires_redirect / error arms', () => {
  it('sets signupAbandoned after ~1s on requires_redirect', async () => {
    mockPerformSignupOrAuth.mockResolvedValueOnce({
      kind: 'requires_redirect',
    });
    const store = makeStore(null);
    render(<SigningUpScreen store={store} />);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.session.signupAbandoned).toBe(true);
  });

  it('sets signupAbandoned after ~1s on error', async () => {
    mockPerformSignupOrAuth.mockResolvedValueOnce({ kind: 'error' });
    const store = makeStore(null);
    render(<SigningUpScreen store={store} />);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.session.signupAbandoned).toBe(true);
  });
});

describe('SigningUpScreen — render states', () => {
  it('shows "Loading…" while the POST is in flight', () => {
    mockPerformSignupOrAuth.mockReturnValueOnce(new Promise(() => {})); // never resolves
    const store = makeStore(null);
    const { lastFrame } = render(<SigningUpScreen store={store} />);
    expect(lastFrame()).toMatch(/Loading/);
  });

  it('shows the browser transition message after a terminal non-success', async () => {
    mockPerformSignupOrAuth.mockResolvedValueOnce({
      kind: 'requires_redirect',
    });
    const store = makeStore(null);
    const { lastFrame } = render(<SigningUpScreen store={store} />);
    // Flush microtasks (await inside effect) and React's commit tick.
    await vi.advanceTimersByTimeAsync(0);
    expect(lastFrame()).toMatch(/Please sign up or log in in your browser/);
  });
});

describe('SigningUpScreen — cleanup on unmount', () => {
  it('unmount during POST does not write to session', async () => {
    let resolvePost: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolvePost = resolve;
    });
    mockPerformSignupOrAuth.mockReturnValueOnce(pending);

    const store = makeStore(null);
    const { unmount } = render(<SigningUpScreen store={store} />);
    unmount();

    // Resolve the POST after unmount with a response that WOULD have written to session.
    resolvePost({
      kind: 'success',
      idToken: 'id',
      accessToken: 'acc',
      refreshToken: 'ref',
      zone: 'us',
      userInfo: null,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(store.session.signupAuth).toBeNull();
    expect(store.session.signupAbandoned).toBe(false);
    expect(store.session.signupRequiredFields).toEqual([]);
  });

  it('unmount during terminal hold does not abandon', async () => {
    mockPerformSignupOrAuth.mockResolvedValueOnce({
      kind: 'requires_redirect',
    });
    const store = makeStore(null);
    const { unmount } = render(<SigningUpScreen store={store} />);

    // Let the POST resolve; screen switches to terminal phase and schedules the 1s timeout.
    await vi.advanceTimersByTimeAsync(0);

    // Unmount before the 1s hold elapses.
    unmount();

    // Advance past the timeout — the cleared timeout should NOT fire setSignupAbandoned.
    await vi.advanceTimersByTimeAsync(2000);

    expect(store.session.signupAbandoned).toBe(false);
  });
});
