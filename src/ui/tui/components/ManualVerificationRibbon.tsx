/**
 * ManualVerificationRibbon — bottom-of-screen banner that lists pending
 * manual verifications.
 *
 * Read-only — every render pulls a fresh snapshot from the orchestration
 * store. Returns `null` when there are no pending verifications, so the
 * ribbon collapses out of layout when nothing's blocking.
 *
 * Mounted by OutroScreen + RunScreen (success / cancel / error variants
 * alike) so the user can never see "everything's done" UI while there's
 * an outstanding manual step to take.
 */
import { Box, Text } from 'ink';
import { useMemo } from 'react';
import type { WizardStore } from '../store.js';
import { Colors, Icons } from '../styles.js';
import { buildVerificationsEnvelope } from '../../../lib/orchestration/envelopes.js';
import { VerificationStatus } from '../../../lib/orchestration/checkpoints/verifications.js';

interface ManualVerificationRibbonProps {
  store: WizardStore;
  /** Show at most this many pending rows; the rest collapse to "+N more". */
  max?: number;
}

export const ManualVerificationRibbon = ({
  store,
  max = 2,
}: ManualVerificationRibbonProps) => {
  const installDir = store.session.installDir;
  // Pull only PENDING here — we don't want failed verifications taking
  // up footer space; they live in `/status` for review.
  const verifications = useMemo(
    () =>
      buildVerificationsEnvelope({
        installDir,
        status: VerificationStatus.Pending,
      }).verifications,
    // Re-evaluate whenever the wizard rerenders, since the orchestration
    // store can mutate underneath us. installDir is stable per session.
    [installDir, store.getVersion()],
  );

  if (verifications.length === 0) return null;

  const visible = verifications.slice(0, max);
  const overflow = verifications.length - visible.length;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={Colors.warning} bold>
        {Icons.bullet} Manual verification pending
      </Text>
      {visible.map((v) => (
        <Text key={v.id} color={Colors.body}>
          {Icons.dash} {v.whatToVerify}
          {v.resumeCommand.length > 0 ? (
            <Text color={Colors.muted}>
              {' — '}resume: <Text bold>{v.resumeCommand.join(' ')}</Text>
            </Text>
          ) : null}
        </Text>
      ))}
      {overflow > 0 && (
        <Text color={Colors.muted}>
          {Icons.dot} +{overflow} more — see{' '}
          <Text bold>wizard verification list</Text>
        </Text>
      )}
    </Box>
  );
};
