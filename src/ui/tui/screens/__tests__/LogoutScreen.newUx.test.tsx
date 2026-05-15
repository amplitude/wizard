/**
 * LogoutScreen — WIZARD_NEW_UX=1 redesign tests (PR 7).
 *
 * Coverage:
 *  - Receipt names the email + the canonical oauth-session.json path
 *    (read from `getOAuthSettingsFile()`).
 *  - When the flag is unset, the legacy receipt copy renders unchanged.
 *
 * Mocks: ConfirmationInput is stubbed to fire onConfirm immediately on
 * mount so we can observe the post-confirm receipt frame without
 * driving Ink's focus manager from a non-TTY test stdin.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { LogoutScreen } from '../LogoutScreen.js';
import { getOAuthSettingsFile } from '../../../../utils/storage-paths.js';

vi.mock('../../primitives/index.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../primitives/index.js')
  >('../../primitives/index.js');
  // Auto-fire onConfirm on mount so the Done branch is reachable from
  // a non-TTY render. Returns null so the synthetic confirm input
  // doesn't pollute the rendered frame.
  return {
    ...actual,
    ConfirmationInput: ({ onConfirm }: { onConfirm: () => void }) => {
      React.useEffect(() => {
        onConfirm();
      }, []);
      return null;
    },
  };
});

vi.mock('../../../../utils/ampli-settings.js', () => ({
  clearStoredCredentials: vi.fn(),
}));
vi.mock('../../../../utils/api-key-store.js', () => ({
  clearApiKey: vi.fn(),
}));
vi.mock('../../../../lib/session-checkpoint.js', () => ({
  clearCheckpoint: vi.fn(),
}));
vi.mock('../../../../lib/ampli-config.js', () => ({
  clearAuthFieldsInAmpliConfig: vi.fn(),
}));
vi.mock('../../../../utils/wizard-abort.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../utils/wizard-abort.js')
  >('../../../../utils/wizard-abort.js');
  return {
    ...actual,
    wizardSuccessExit: vi.fn(() => Promise.resolve() as Promise<never>),
  };
});

describe('LogoutScreen — WIZARD_NEW_UX=1 receipt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    process.env.WIZARD_NEW_UX = '1';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.WIZARD_NEW_UX;
  });

  it('renders the receipt with email and oauth-session.json path on confirm', async () => {
    const { lastFrame } = render(
      <LogoutScreen
        onComplete={() => undefined}
        installDir={'/tmp/example'}
        onLoggedOut={() => undefined}
        userEmail="jane@acme.com"
      />,
    );

    // The stubbed ConfirmationInput auto-fires onConfirm on mount.
    await vi.advanceTimersByTimeAsync(50);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('removed credentials for jane@acme.com');
    expect(frame).toContain(getOAuthSettingsFile());
  });

  it('falls back gracefully when userEmail is missing', async () => {
    const { lastFrame } = render(
      <LogoutScreen
        onComplete={() => undefined}
        installDir={'/tmp/example'}
        onLoggedOut={() => undefined}
      />,
    );

    await vi.advanceTimersByTimeAsync(50);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('removed credentials for this account');
    expect(frame).toContain(getOAuthSettingsFile());
  });

  it('legacy rendering (flag unset) keeps the original "Logged out." copy', async () => {
    delete process.env.WIZARD_NEW_UX;
    const { lastFrame, rerender } = render(
      <LogoutScreen
        onComplete={() => undefined}
        installDir={'/tmp/example'}
        onLoggedOut={() => undefined}
        userEmail="jane@acme.com"
      />,
    );

    // Pump timers + a re-render so the useEffect-driven auto-confirm in
    // the stubbed ConfirmationInput has a chance to flush state before
    // we assert. Without the explicit rerender, the full-suite run
    // occasionally captured `lastFrame()` while the screen was still in
    // Phase.Confirm even though the state-set had already been queued.
    await vi.advanceTimersByTimeAsync(50);
    rerender(
      <LogoutScreen
        onComplete={() => undefined}
        installDir={'/tmp/example'}
        onLoggedOut={() => undefined}
        userEmail="jane@acme.com"
      />,
    );
    await vi.advanceTimersByTimeAsync(50);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Logged out. Restart the wizard');
    expect(frame).not.toContain('removed credentials for');
  });
});
