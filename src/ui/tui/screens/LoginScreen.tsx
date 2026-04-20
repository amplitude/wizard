/**
 * LoginScreen — Silent token refresh overlay for the /login slash command (v2).
 *
 * On mount, reads the stored refresh token from ~/.ampli.json and exchanges
 * it for a new access token via the Amplitude OAuth2 token endpoint.
 * No browser required. Falls back gracefully if no token is stored or if
 * the refresh fails.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import type { WizardStore } from '../store.js';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import type { AmplitudeZone } from '../../../lib/constants.js';

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

        const user = getStoredUser();
        const zone = (store.session.region ?? 'us') as AmplitudeZone;
        const stored = getStoredToken(user?.id, zone);

        if (!stored) {
          setPhase(Phase.NoToken);
          setTimeout(onComplete, 2500);
          return;
        }

        const result = await refreshAccessToken(stored.refreshToken, zone);

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
        setTimeout(onComplete, 1500);
      } catch (err) {
        // Clear the stale token so the next wizard run forces fresh browser auth
        const { clearStoredCredentials } = await import(
          '../../../utils/ampli-settings.js'
        );
        clearStoredCredentials();
        setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
        setPhase(Phase.Error);
        setTimeout(onComplete, 2500);
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
