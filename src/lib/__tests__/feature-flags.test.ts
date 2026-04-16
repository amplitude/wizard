import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDebug, mockInitializeLocal } = vi.hoisted(() => ({
  mockDebug: vi.fn(),
  mockInitializeLocal: vi.fn(),
}));

vi.mock('../../utils/debug', () => ({ debug: mockDebug }));
vi.mock('@amplitude/experiment-node-server', () => ({
  Experiment: { initializeLocal: mockInitializeLocal },
}));

describe('resolveHeadlessSignupFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('logs via debug when initFeatureFlags throws', async () => {
    // Force initializeLocal to return a client whose start() rejects.
    mockInitializeLocal.mockReturnValue({
      start: vi.fn().mockRejectedValue(new Error('network down')),
      evaluateV2: vi.fn().mockReturnValue({}),
    });

    const { resolveHeadlessSignupFlag } = await import('../feature-flags.js');
    const session = { signup: true, _headlessSignupEnabled: false };

    await resolveHeadlessSignupFlag(session);

    // Flag stays disabled when init fails.
    expect(session._headlessSignupEnabled).toBe(false);
    // And we emitted a debug log rather than swallowing silently.
    const debugCalls = mockDebug.mock.calls.map((c) => String(c[0]));
    expect(debugCalls.some((msg) => msg.includes('feature-flags'))).toBe(true);
  });
});
