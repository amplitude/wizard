/**
 * LogoutScreen — Confirms and clears stored OAuth credentials (v2).
 *
 * Used as an overlay triggered by the /logout slash command.
 * Calls clearStoredCredentials() on confirm, then pops the overlay.
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useRef } from 'react';
import { ConfirmationInput } from '../primitives/index.js';
import { Colors } from '../styles.js';
import { clearStoredCredentials } from '../../../utils/ampli-settings.js';
import { clearStaleProjectState } from '../../../utils/clear-stale-project-state.js';
import { wizardSuccessExit } from '../../../utils/wizard-abort.js';

interface LogoutScreenProps {
  onComplete: () => void;
  installDir: string;
  /** Called to clear in-memory session state after disk credentials are wiped. */
  onLoggedOut?: () => void;
}

enum Phase {
  Confirm = 'confirm',
  Done = 'done',
}

export const LogoutScreen = ({
  onComplete,
  installDir,
  onLoggedOut,
}: LogoutScreenProps) => {
  const [phase, setPhase] = useState<Phase>(Phase.Confirm);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hard mount-guard for the `process.exit(0)` schedule. Without this,
  // any path that unmounts the LogoutScreen between confirm-click and
  // the 1.5s timer firing (overlay swap, ScreenErrorBoundary retry,
  // back-nav before timer drains) would still kill the whole CLI.
  // Process termination must NEVER outlive its owning screen.
  const mountedRef = useRef(true);

  // Clear any pending timer on unmount + flip the mount flag so the
  // exit callback short-circuits if it's already in the macrotask queue.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const handleConfirm = () => {
    clearStoredCredentials();
    // Wipe install-dir-keyed surfaces (keychain, .env.local, bindings,
    // checkpoint). Same helper as successful direct signup — symmetric UX.
    clearStaleProjectState(installDir, 'logout');
    onLoggedOut?.();
    setPhase(Phase.Done);
    // Exit after a short delay so the user sees the confirmation.
    // Routes through wizardSuccessExit so any pending analytics events
    // (logout-confirmed, session metrics) flush before the process
    // tears down.
    //
    // The mount-guard on the inner callback is belt-and-braces with
    // the unmount cleanup above (PR 338) — even if a queued macrotask
    // sneaks past clearTimeout (e.g. unmount races the timer drain on
    // an overloaded event loop), `mountedRef.current` will be false
    // and we'll skip the exit.
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (mountedRef.current) void wizardSuccessExit(0);
    }, 1500);
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Log Out
      </Text>

      <Box marginTop={1} flexDirection="column">
        {phase === Phase.Confirm && (
          <ConfirmationInput
            message="Clear stored Amplitude credentials (wizard session + project binding)?"
            confirmLabel="Log out"
            cancelLabel="Cancel"
            onConfirm={handleConfirm}
            onCancel={onComplete}
          />
        )}

        {phase === Phase.Done && (
          <Text color={Colors.secondary}>
            Logged out. Restart the wizard to re-authenticate.
          </Text>
        )}
      </Box>
    </Box>
  );
};
