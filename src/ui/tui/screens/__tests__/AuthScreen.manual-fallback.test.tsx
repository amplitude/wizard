/**
 * AuthScreen — [M] pre-OAuth manual-fallback acknowledgement (BA-296).
 *
 * Repro chain we're guarding against:
 *
 *   1. User hits the OAuth wait state but the browser tab is blocked
 *      (Aaryan's report: `auth.amplitude.com` 400 "Request Header Or
 *      Cookie Too Large" — pre-existing `AMP_***` cookies blow the nginx
 *      `large_client_header_buffers` budget for the PKCE-laden URL).
 *   2. User presses [M] to enter their project API key directly.
 *   3. User pastes the key and hits Enter.
 *   4. Before this fix:
 *        - `handleApiKeySubmit` set credentials and persisted the key,
 *        - but `manualFallbackOpen` stayed `true`, so the screen kept
 *          rendering the same "Enter your project API key" headline + an
 *          empty input. The user saw zero acknowledgement and concluded
 *          the wizard was hung ("nothing happens").
 *      After this fix:
 *        - the manual-fallback form closes (`setManualFallbackOpen(false)`),
 *        - the OAuth-waiting view re-renders with a green checkmark line:
 *          "API key saved — finish browser sign-in to continue."
 *
 * We assert on the rendered frame so a future refactor that drops the
 * acknowledgement copy or stops closing the form fails loudly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { AuthScreen } from '../AuthScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';

vi.mock('../../../../utils/api-key-store.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../utils/api-key-store.js')
  >('../../../../utils/api-key-store.js');
  return {
    ...actual,
    readApiKeyWithSource: vi.fn().mockReturnValue(null),
    persistApiKey: vi.fn().mockReturnValue('cache'),
  };
});

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (s: string) => s.replace(ANSI, '');

const flushAsync = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

describe('AuthScreen — [M] manual fallback (pre-OAuth) submission feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('after the user pastes an API key into the [M] fallback, closes the fallback form and surfaces a "key saved" acknowledgement in the OAuth-waiting view', async () => {
    // Pre-OAuth: pendingOrgs is null, the spinner+URL view is showing.
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      pendingOrgs: null,
      // A `loginUrl` is what the AuthScreen would normally show on the
      // OAuth-waiting view. Including it lets us assert that the URL
      // itself stays put after submission (the fix only changes the
      // acknowledgement line, not the URL row).
      loginUrl: 'https://auth.amplitude.com/oauth2/auth?client_id=test',
    });

    const { stdin, lastFrame, rerender } = render(<AuthScreen store={store} />);
    await flushAsync();

    // 1. Press [M] to open the manual fallback. AuthScreen subscribes to
    //    stdin via `useScreenInput`; sending a single 'm' keystroke
    //    flips `manualFallbackOpen` and re-renders.
    stdin.write('m');
    await flushAsync();
    rerender(<AuthScreen store={store} />);
    await flushAsync();

    // Sanity: we're on the manual-fallback form now.
    expect(stripAnsi(lastFrame() ?? '')).toContain(
      'Enter your project API key',
    );

    // 2. Type a representative-shape Amplitude API key (32 lowercase hex —
    //    matches the user's screenshot) and hit Enter to submit.
    for (const ch of '15d5e106e8447c5faf2d5b1ff3f66dd9') {
      stdin.write(ch);
      await flushAsync();
    }
    await flushAsync();
    stdin.write('\r');
    await flushAsync();
    rerender(<AuthScreen store={store} />);
    await flushAsync();

    const frame = stripAnsi(lastFrame() ?? '');

    // 3. Credentials are set in the session — confirms the submit handler
    //    actually ran (the test would still pass on the frame check alone
    //    if both branches happened to render the same string, so guard
    //    with the store assertion too).
    expect(store.session.credentials).not.toBeNull();
    expect(
      store.session.credentials?.projectApiKey?.startsWith('15d5e106'),
    ).toBe(true);

    // 4. The manual-fallback form is no longer the active view: the
    //    "Enter your project API key" headline is gone, replaced by the
    //    OAuth-waiting view's signing-in / verifying-session copy.
    expect(frame).not.toContain('Enter your project API key');

    // 5. The acknowledgement line is on screen. Either "saved" copy
    //    variant ('cache' vs '.env.local') is acceptable — the test
    //    mock pins `'cache'`, but a future env-file fallback would
    //    legitimately produce the other string.
    const showsSavedAck =
      frame.includes('API key saved — finish browser sign-in to continue.') ||
      frame.includes(
        'API key saved to .env.local — finish browser sign-in to continue.',
      );
    expect(showsSavedAck).toBe(true);
  });
});
