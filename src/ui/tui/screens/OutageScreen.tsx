/**
 * OutageScreen — Shown when AI services are degraded (v2).
 *
 * Reads session.serviceStatus and provides a ConfirmationInput to continue
 * or exit. While shown, polls the same statuspage rollup that gated the
 * overlay every 30s and auto-dismisses when status flips back to healthy
 * — no more hollow "temporarily unavailable" promises that never resolve.
 *
 * Polling caps at 10 attempts (5min) before stepping aside and letting
 * the user decide manually. Status checks have a 5s internal timeout
 * (see statuspage.ts) so a hung status host can never freeze this screen.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { ConfirmationInput, TerminalLink } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import { wizardAbort } from '../../../utils/wizard-abort.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { checkAmplitudeOverallHealth } from '../../../lib/health-checks/index.js';
import { ServiceHealthStatus } from '../../../lib/health-checks/types.js';
import { logToFile } from '../../../utils/debug.js';

const POLL_INTERVAL_MS = 30_000;
const MAX_POLL_ATTEMPTS = 10;

interface OutageScreenProps {
  store: WizardStore;
}

export const OutageScreen = ({ store }: OutageScreenProps) => {
  useWizardStore(store);

  const serviceStatus = store.session.serviceStatus;
  const [attempts, setAttempts] = useState(0);
  const [recheckInFlight, setRecheckInFlight] = useState(false);
  const cancelledRef = useRef(false);

  // Background poll: every 30s call the same statuspage rollup that
  // pushed this overlay. On healthy → popOverlay() and the user resumes
  // wherever they were. The `cancelledRef` guard prevents a late fetch
  // from acting on an already-popped overlay.
  useEffect(() => {
    if (!serviceStatus) return;
    cancelledRef.current = false;

    const tick = async () => {
      if (cancelledRef.current) return;
      if (attempts >= MAX_POLL_ATTEMPTS) return;
      setRecheckInFlight(true);
      try {
        const result = await checkAmplitudeOverallHealth();
        if (cancelledRef.current) return;
        logToFile(
          `[OutageScreen] recheck attempt=${attempts + 1} status=${
            result.status
          }`,
        );
        if (result.status === ServiceHealthStatus.Healthy) {
          store.popOverlay();
          return;
        }
      } catch (err) {
        logToFile(
          `[OutageScreen] recheck failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      } finally {
        if (!cancelledRef.current) {
          setRecheckInFlight(false);
          setAttempts((a) => a + 1);
        }
      }
    };

    const id = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearTimeout(id);
    };
    // attempts is intentionally a dep so the timer chain advances each tick.
  }, [serviceStatus, attempts]);

  if (!serviceStatus) {
    return null;
  }

  const giveUp = attempts >= MAX_POLL_ATTEMPTS;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color={Colors.warning} bold>
          {Icons.diamond} The setup agent is temporarily unavailable.
        </Text>
        <Text> </Text>
        <Text color={Colors.body}>
          <Text color={Colors.warning}>Status:</Text>{' '}
          {serviceStatus.description}
        </Text>
        <Text color={Colors.body}>
          <Text color={Colors.warning}>Status page:</Text>{' '}
          <TerminalLink url={serviceStatus.statusPageUrl}>
            {serviceStatus.statusPageUrl}
          </TerminalLink>
        </Text>
        <Text> </Text>
        <Text color={Colors.secondary}>
          The wizard may not work reliably while services are affected.
        </Text>

        {/* Inline re-checking indicator: gives the user calm signal that
            the wizard is actively watching, instead of leaving the
            "temporarily unavailable" line as the last word. */}
        {!giveUp && (
          <Box marginTop={1} gap={1}>
            {recheckInFlight ? (
              <BrailleSpinner color={Colors.accent} />
            ) : (
              <Text color={Colors.subtle}>{Icons.dot}</Text>
            )}
            <Text color={Colors.muted}>
              Re-checking{Icons.ellipsis} (attempt {attempts + 1} of{' '}
              {MAX_POLL_ATTEMPTS})
            </Text>
          </Box>
        )}
        {giveUp && (
          <Box marginTop={1}>
            <Text color={Colors.muted}>
              Still degraded after {MAX_POLL_ATTEMPTS} checks. Continue if you
              want to try anyway, or cancel and retry later.
            </Text>
          </Box>
        )}
      </Box>

      <ConfirmationInput
        message="Continue anyway?"
        onConfirm={() => store.popOverlay()}
        onCancel={() => {
          // Outage detected and user chose to bail — route through
          // wizardAbort so the cancel reason is captured to analytics
          // and the user sees a proper exit message instead of a
          // half-rendered overlay.
          void wizardAbort({
            message:
              'Setup paused — services were degraded. Re-run the wizard once the status page clears.',
            exitCode: 0,
          });
        }}
      />
    </Box>
  );
};
