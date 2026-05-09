/**
 * StatusOverlayScreen — TUI rendering of the orchestration store.
 *
 * PR 3 — invoked via the `/status` slash command. Renders the same data
 * the `wizard orchestration status --json` envelope carries, sectioned
 * into:
 *
 *   - Active session (id, goal, branch, worktree)
 *   - Current mode (interactive / agent / nested-agent)
 *   - Active tasks (state-coloured)
 *   - Pending choices (with why-asking, recommended option, reversibility)
 *   - Pending verifications (with the resume command)
 *   - MCP-app capabilities (state + whyNeeded)
 *   - Owned branches / worktrees / PRs
 *   - Last stopping point + recommended next action
 *
 * The component does NOT subscribe to a separate stream. Every render
 * pulls a fresh snapshot from `OrchestrationStore` (cheap; the file is
 * small) wrapped in a single `withReadCache` block — so all sections
 * see a consistent slice. A `useWizardStore(store)` subscription
 * triggers a rerender whenever the wizard's in-memory state changes,
 * but the orchestration store itself doesn't push events; PR 3 keeps
 * the cadence "rerender when something else in the wizard moves". The
 * brief's "stable transitions / no resize-required redraws" item is
 * covered by the existing `triggerRerender()` bridge in the store.
 *
 * Esc dismisses the overlay.
 */
import { Box, Text } from 'ink';
import { useMemo } from 'react';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useOrchestrationStore } from '../hooks/useOrchestrationStore.js';
import { Colors, Icons } from '../styles.js';
import {
  buildStatusEnvelope,
  withReadCache,
  buildChoicesEnvelope,
  buildVerificationsEnvelope,
  buildMcpCapabilitiesEnvelope,
} from '../../../lib/orchestration/envelopes.js';
import { ChoiceStatus } from '../../../lib/orchestration/checkpoints/choices.js';
import { VerificationStatus } from '../../../lib/orchestration/checkpoints/verifications.js';
import { detectNestedAgent } from '../../../lib/detect-nested-agent.js';
import { TaskLifecycle } from '../../../lib/orchestration/lifecycle.js';

interface StatusOverlayScreenProps {
  store: WizardStore;
}

function lifecycleColor(state: TaskLifecycle): string {
  switch (state) {
    case TaskLifecycle.Completed:
      return Colors.success;
    case TaskLifecycle.Failed:
    case TaskLifecycle.Blocked:
      return Colors.error;
    case TaskLifecycle.Cancelled:
      return Colors.warning;
    case TaskLifecycle.Running:
      return Colors.active;
    case TaskLifecycle.WaitingForUser:
      return Colors.accent;
    default:
      return Colors.muted;
  }
}

export const StatusOverlayScreen = ({ store }: StatusOverlayScreenProps) => {
  // Subscribe so the overlay rerenders if anything else changes session
  // state (e.g. an agent finishes a task and emitChange fires). The
  // orchestration store itself isn't observable, so we recompute its
  // contents on every render — cheap given the file is small.
  useWizardStore(store);

  // useScreenInput respects CommandModeContext — once the user types `/`
  // the overlay's Esc handler steps aside so the slash bar can claim
  // input.
  useScreenInput(
    (_input, key) => {
      if (key.escape) store.hideStatusOverlay();
    },
    { isActive: true },
  );

  const installDir = store.session.installDir;

  // PR 4: live-refresh on orchestration store mutations. The hook
  // subscribes to the file-watch wrapper and returns a version number
  // that changes on every (debounced) write. Feeding this into the
  // useMemo deps forces a recompute when a sibling shell calls
  // `wizard choice answer` etc.
  const orchVersion = useOrchestrationStore(installDir);

  // One snapshot per render, shared across every section.
  const data = useMemo(
    () =>
      withReadCache((cacheKey) => {
        const status = buildStatusEnvelope({ installDir, cacheKey });
        const pendingChoices = buildChoicesEnvelope({
          installDir,
          cacheKey,
          status: ChoiceStatus.Pending,
        });
        const pendingVerifications = buildVerificationsEnvelope({
          installDir,
          cacheKey,
          status: [VerificationStatus.Pending, VerificationStatus.Failed],
        });
        const capabilities = buildMcpCapabilitiesEnvelope({
          installDir,
          cacheKey,
        });
        return {
          status,
          pendingChoices: pendingChoices.choices,
          pendingVerifications: pendingVerifications.verifications,
          capabilities: capabilities.capabilities,
        };
      }),
    // Recompute whenever a re-render is forced — the underlying file
    // could have changed since the prior render. `orchVersion` flips
    // when the watcher fires; `store.getVersion()` flips when the
    // wizard's in-memory state changes.
    [installDir, store.getVersion(), orchVersion],
  );

  const lsp = data.status.lastStoppingPoint;
  const nestedAgent = detectNestedAgent();
  const currentMode = nestedAgent
    ? `nested-agent (${nestedAgent.envVar}=${nestedAgent.envValue})`
    : process.env.AMPLITUDE_WIZARD_AGENT_MODE === '1'
    ? 'agent'
    : 'interactive';

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          {Icons.diamond} What's happening
        </Text>
        <Text color={Colors.muted}>
          Live snapshot of the orchestration store. Press{' '}
          <Text bold>Esc</Text> to close.
        </Text>
      </Box>

      {/* Session + mode */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={Colors.secondary} bold>
          Session
        </Text>
        {lsp.currentSessionId ? (
          <>
            <Text color={Colors.body}>
              {Icons.bullet} id: <Text bold>{lsp.currentSessionId}</Text>
            </Text>
            {lsp.currentGoal && (
              <Text color={Colors.body}>
                {Icons.bullet} goal: {lsp.currentGoal}
              </Text>
            )}
            {lsp.currentBranch && (
              <Text color={Colors.body}>
                {Icons.bullet} branch: {lsp.currentBranch}
              </Text>
            )}
            {lsp.currentWorktree && (
              <Text color={Colors.body}>
                {Icons.bullet} worktree: {lsp.currentWorktree}
              </Text>
            )}
          </>
        ) : (
          <Text color={Colors.muted}>{Icons.dot} No active session.</Text>
        )}
        <Text color={Colors.body}>
          {Icons.bullet} mode: <Text bold>{currentMode}</Text>
        </Text>
      </Box>

      {/* Active tasks */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={Colors.secondary} bold>
          Active tasks ({lsp.activeTasks.length})
        </Text>
        {lsp.activeTasks.length === 0 ? (
          <Text color={Colors.muted}>{Icons.dot} None.</Text>
        ) : (
          lsp.activeTasks.slice(0, 8).map((t) => (
            <Text key={t.id} color={Colors.body}>
              {Icons.bullet}{' '}
              <Text bold color={lifecycleColor(t.state)}>
                {t.state}
              </Text>{' '}
              — {t.label}
            </Text>
          ))
        )}
      </Box>

      {/* Pending choices — the actionable rows */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={Colors.secondary} bold>
          Pending choices ({data.pendingChoices.length})
        </Text>
        {data.pendingChoices.length === 0 ? (
          <Text color={Colors.muted}>{Icons.dot} None.</Text>
        ) : (
          data.pendingChoices.slice(0, 5).map((c) => {
            const recommended = c.options.find(
              (o) => o.id === c.recommendedOptionId,
            );
            return (
              <Box key={c.id} flexDirection="column" marginBottom={1}>
                <Text color={Colors.accent} bold>
                  {Icons.diamond} {c.message}
                </Text>
                <Text color={Colors.muted}>
                  {' '}
                  why: {c.whyAsking}
                </Text>
                {recommended && (
                  <Text color={Colors.muted}>
                    {' '}
                    recommended:{' '}
                    <Text bold color={Colors.success}>
                      {recommended.label}
                    </Text>
                  </Text>
                )}
                <Text color={Colors.muted}>
                  {' '}
                  if skipped: {c.consequenceIfSkipped}
                </Text>
                <Text color={Colors.muted}>
                  {' '}
                  reversible: {c.reversible ? 'yes' : 'no'} ·{' '}
                  requires_human: {c.requiresHuman ? 'yes' : 'no'}
                </Text>
                <Text color={Colors.muted}>
                  {' '}
                  resume:{' '}
                  <Text bold>
                    {c.resumeCommand.join(' ')}
                  </Text>
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      {/* Pending manual verifications */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={Colors.secondary} bold>
          Pending verifications ({data.pendingVerifications.length})
        </Text>
        {data.pendingVerifications.length === 0 ? (
          <Text color={Colors.muted}>{Icons.dot} None.</Text>
        ) : (
          data.pendingVerifications.slice(0, 5).map((v) => (
            <Box key={v.id} flexDirection="column" marginBottom={1}>
              <Text color={Colors.warning} bold>
                {Icons.bullet} {v.whatToVerify}
              </Text>
              <Text color={Colors.muted}>
                {' '}
                expected: {v.expectedBehavior}
              </Text>
              {v.unblockerHint && (
                <Text color={Colors.muted}>
                  {' '}
                  hint: {v.unblockerHint}
                </Text>
              )}
              <Text color={Colors.muted}>
                {' '}
                resume: <Text bold>{v.resumeCommand.join(' ')}</Text>
              </Text>
            </Box>
          ))
        )}
      </Box>

      {/* MCP capabilities */}
      {data.capabilities.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={Colors.secondary} bold>
            MCP capabilities ({data.capabilities.length})
          </Text>
          {data.capabilities.slice(0, 6).map((c) => (
            <Text key={c.id} color={Colors.body}>
              {Icons.bullet} <Text bold>{c.kind}</Text> ·{' '}
              <Text color={Colors.muted}>{c.state}</Text>
              {c.lastStateChangeReason
                ? `  — ${c.lastStateChangeReason}`
                : ''}
            </Text>
          ))}
        </Box>
      )}

      {/* Ownership */}
      {lsp.relevantOwnership.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={Colors.secondary} bold>
            Owned artifacts
          </Text>
          {lsp.relevantOwnership.slice(0, 5).map((o, i) => (
            <Text key={i} color={Colors.body}>
              {Icons.bullet} {o.kind}:{' '}
              {'name' in o
                ? o.name
                : 'path' in o
                ? o.path
                : 'number' in o
                ? `#${o.number} (${o.repo})`
                : ''}
            </Text>
          ))}
        </Box>
      )}

      {/* Next action */}
      <Box flexDirection="column" marginTop={1}>
        <Text color={Colors.accent} bold>
          {Icons.arrowRight} Next: {lsp.nextAction.description}
        </Text>
        <Text color={Colors.muted}>
          {' '}
          resume command: <Text bold>{lsp.resumeCommand}</Text>
        </Text>
      </Box>
    </Box>
  );
};
