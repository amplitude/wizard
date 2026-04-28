/**
 * LoginScreen — Silent token refresh overlay for the /login slash command (v2).
 *
 * On mount, reads the stored refresh token from ~/.ampli.json and exchanges
 * it for a new access token via the Amplitude OAuth2 token endpoint.
 * No browser required. Falls back gracefully if no token is stored or if
 * the refresh fails.
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useRef } from 'react';
import type { WizardStore } from '../store.js';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { DEFAULT_AMPLITUDE_ZONE } from '../../../lib/constants.js';
import { resolveZone } from '../../../lib/zone-resolution.js';

interface LoginScreenProps {
  store: WizardStore;
  onComplete: () => void;
}

enum Phase {
  Refreshing = 'refreshing',
  Success = 'success',
  NoToken = 'no-token',
  Error = 'error',
}

export const LoginScreen = ({ store, onComplete }: LoginScreenProps) => {
  const [phase, setPhase] = useState<Phase>(Phase.Refreshing);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Tracks the auto-dismiss timer so unmount clears it. Without this
  // ref + cleanup, navigating away from the overlay (Esc back-nav,
  // outer screen swap, ScreenErrorBoundary retry) leaves a dangling
  // setTimeout that fires `onComplete` against an unmounted overlay
  // 1.5–2.5s later — popping the wrong overlay and producing visible
  // navigation glitches.
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (dismissTimerRef.current !== null) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, []);

  /** Schedule onComplete; refuses to schedule on an unmounted screen. */
  const scheduleDismiss = (ms: number): void => {
    if (!mountedRef.current) return;
    if (dismissTimerRef.current !== null) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      if (mountedRef.current) onComplete();
    }, ms);
  };

  useEffect(() => {
    void (async () => {
      try {
        const [
          { getStoredToken, getStoredUser, storeToken },
          { refreshAccessToken },
        ] = await Promise.all([
          import('../../../utils/ampli-settings.js'),
          import('../../../utils/oauth.js'),
        ]);

        if (!mountedRef.current) return;

        const user = getStoredUser();
        // readDisk: true — login runs before the RegionSelect gate; disk
        // tiers are the authoritative source for intent here.
        const zone = resolveZone(store.session, DEFAULT_AMPLITUDE_ZONE, {
          readDisk: true,
        });
        const stored = getStoredToken(user?.id, zone);

        if (!stored) {
          if (!mountedRef.current) return;
          setPhase(Phase.NoToken);
          scheduleDismiss(2500);
          return;
        }

        const result = await refreshAccessToken(stored.refreshToken, zone);

        if (!mountedRef.current) return;

        // Persist updated tokens to ~/.ampli.json
        if (user) {
          storeToken(user, {
            accessToken: result.accessToken,
            idToken: result.idToken,
            refreshToken: result.refreshToken,
            expiresAt: result.expiresAt,
          });
        }

        // Patch the live session credentials without re-running auth flow
        store.updateAccessToken(result.accessToken);

        setPhase(Phase.Success);
        scheduleDismiss(1500);
      } catch (err) {
        // Clear the stale token so the next wizard run forces fresh browser auth
        const { clearStoredCredentials } = await import(
          '../../../utils/ampli-settings.js'
        );
        clearStoredCredentials();
        if (!mountedRef.current) return;
        setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
        setPhase(Phase.Error);
        scheduleDismiss(2500);
      }
    })();
  }, []);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Re-authenticate
      </Text>

      <Box marginTop={1} flexDirection="column">
        {phase === Phase.Refreshing && (
          <Box gap={1}>
            <BrailleSpinner />
            <Text color={Colors.active}>
              Refreshing credentials{Icons.ellipsis}
            </Text>
          </Box>
        )}

        {phase === Phase.Success && (
          <Text color={Colors.success}>
            {Icons.checkmark} Credentials refreshed.
          </Text>
        )}

        {phase === Phase.NoToken && (
          <Text color={Colors.secondary}>
            No stored credentials found. Restart the wizard to re-authenticate.
          </Text>
        )}

        {phase === Phase.Error && (
          <Box flexDirection="column">
            <Text color={Colors.error}>Refresh failed: {errorMsg}</Text>
            <Text color={Colors.secondary}>
              Restart the wizard to re-authenticate.
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
