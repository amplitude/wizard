/**
 * StatusOverlayScreen — TUI rendering of the orchestration store.
 *
 * Invoked via the `/status` slash command. v2 PR 5 reframes this as
 * the "Operator Overview" — the accessible "what's happening?" surface
 * the brief calls for.
 *
 * Layout (top to bottom):
 *
 *   ◆ Operator overview                              [mode badge]
 *   <one-line summary of where the wizard is>
 *
 *   Session — id / goal / branch / worktree (when active)
 *
 *   Primary work       <user-directed work the wizard is on right now>
 *     <one row per active task with shared lifecycle glyph>
 *
 *   Background work    <scheduled / autofix / supervisor-tracked>
 *     <ditto, sourced from store.completedTasks + active>
 *
 *   Pending choices    <waiting on user — actionable, full UX contract>
 *   Pending verifications <ditto>
 *   MCP capabilities   <wizard-installed AI-tool integrations>
 *
 *   Owned artifacts    <branches/worktrees/PRs the wizard owns>
 *
 *   ⮕ Next: <recommended next action>  ·  resume: <command>
 *
 * Every primary surface uses the shared glyph palette from
 * `src/ui/tui/utils/lifecycle-display.ts`, so the user only has to
 * learn ○ ⏸ › … ✓ ✗ ⊘ ⮕ once.
 *
 * The component does NOT subscribe to a separate stream. Every render
 * pulls a fresh snapshot from `OrchestrationStore` (cheap; the file is
 * small) wrapped in a single `withReadCache` block — so all sections
 * see a consistent slice. PR 4's `useOrchestrationStore` hook plus the
 * file-watch wrapper push fresh versions when sibling shells call
 * `wizard choice answer …`.
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
import { resolveMode } from '../utils/mode-badge.js';
import {
  lifecycleDisplay,
  type LifecycleDisplay,
} from '../utils/lifecycle-display.js';
import { TaskLifecycle } from '../../../lib/orchestration/lifecycle.js';

interface StatusOverlayScreenProps {
  store: WizardStore;
}

/** Compact "glyph + label" badge used in every section. */
const StateBadge = ({ display }: { display: LifecycleDisplay }) => (
  <Text color={display.color} bold>
    {display.glyph}{' '}
    <Text color={display.color}>{display.label}</Text>
  </Text>
);

/**
 * Section header — bold, secondary color, with a count badge.
 * Pulled out so the operator overview's many sections share the same
 * tight visual rhythm without us re-typing the same JSX seven times.
 */
const SectionHeader = ({
  title,
  count,
  emptyHint,
}: {
  title: string;
  count: number;
  emptyHint?: string;
}) => (
  <Text color={Colors.secondary} bold>
    {title} ({count})
    {count === 0 && emptyHint ? (
      <Text color={Colors.muted}>{`  ${Icons.dot} ${emptyHint}`}</Text>
    ) : null}
  </Text>
);

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
  const mode = resolveMode();

  // Split active tasks into "primary" (running/waiting/blocked) and
  // "background" (everything else among the active set — supervisor's
  // heartbeat-tracked tasks etc.). Today the orchestration store
  // doesn't yet tag tasks with a primary/background flag, so the
  // surface uses lifecycle as a heuristic: anything currently running
  // or waiting-for-user is primary; blocked tasks are surfaced as
  // primary too because they need user attention; queued tasks are
  // background (about to start, not actionable).
  const primaryStates = new Set<TaskLifecycle>([
    TaskLifecycle.Running,
    TaskLifecycle.WaitingForUser,
    TaskLifecycle.Blocked,
  ]);
  const primaryTasks = lsp.activeTasks.filter((t) => primaryStates.has(t.state));
  const backgroundTasks = lsp.activeTasks.filter(
    (t) => !primaryStates.has(t.state),
  );

  const summary =
    data.pendingChoices.length > 0
      ? `Waiting on ${data.pendingChoices.length} choice${
          data.pendingChoices.length === 1 ? '' : 's'
        } from you.`
      : data.pendingVerifications.length > 0
      ? `Waiting on ${data.pendingVerifications.length} manual verification${
          data.pendingVerifications.length === 1 ? '' : 's'
        }.`
      : primaryTasks.length > 0
      ? `${primaryTasks.length} primary task${
          primaryTasks.length === 1 ? '' : 's'
        } in flight.`
      : lsp.currentSessionId
      ? 'Session active — no pending action.'
      : 'No active session.';

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      {/* Header — title + mode badge, then a one-line summary so the
          user always has the answer to "what's the wizard doing?" up
          top. Pinning the summary to the header (rather than burying
          it in the next-action footer) means even on a 24-row terminal
          where lower sections clip, the headline answer is visible. */}
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text bold color={Colors.accent}>
            {Icons.diamond} Operator overview
          </Text>
          <Text color={Colors.subtle}> {Icons.dot} </Text>
          <Text color={mode.color} bold>
            [{mode.label}]
          </Text>
        </Box>
        <Text color={Colors.body}>{summary}</Text>
        <Text color={Colors.muted}>
          Live snapshot — press <Text bold>Esc</Text> to close.
        </Text>
      </Box>

      {/* Session + mode */}
      <Box flexDirection="column" marginBottom={1}>
        <SectionHeader
          title="Session"
          count={lsp.currentSessionId ? 1 : 0}
          emptyHint="No active session"
        />
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
        ) : null}
      </Box>

      {/* Primary work — what's directly in front of the user. */}
      <Box flexDirection="column" marginBottom={1}>
        <SectionHeader
          title="Primary work"
          count={primaryTasks.length}
          emptyHint="Idle"
        />
        {primaryTasks.slice(0, 8).map((t) => {
          const display = lifecycleDisplay(t.state);
          return (
            <Box key={t.id}>
              <Text color={display.color} bold>
                {display.glyph}{' '}
              </Text>
              <Text color={Colors.body}>
                <StateBadge display={display} /> — {t.label}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Background work — scheduled / autofix / supervisor-tracked.
          Hidden when there's nothing to show so the operator overview
          collapses to the rows with content. */}
      {backgroundTasks.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <SectionHeader title="Background" count={backgroundTasks.length} />
          {backgroundTasks.slice(0, 6).map((t) => {
            const display = lifecycleDisplay(t.state);
            return (
              <Box key={t.id}>
                <Text color={display.color}>{display.glyph} </Text>
                <Text color={Colors.muted}>
                  <Text color={display.color}>{display.label}</Text> — {t.label}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Pending choices — the actionable rows.
          Use the full UX contract from ChoiceCheckpointBanner: why-asking,
          recommended option, safe-default, "skipping is/isn't safe",
          consequence, reversibility, resume command. We render an inline
          condensed version here (the overlay can't host the full banner
          for every choice without scrolling) but keep every required
          field so the user can act without leaving the overview. */}
      <Box flexDirection="column" marginBottom={1}>
        <SectionHeader
          title="Pending choices"
          count={data.pendingChoices.length}
          emptyHint="None"
        />
        {data.pendingChoices.slice(0, 5).map((c) => {
          const recommended = c.options.find(
            (o) => o.id === c.recommendedOptionId,
          );
          const isSafeToSkip =
            c.safeDefaultOptionId !== null && !c.requiresHuman && c.reversible;
          return (
            <Box key={c.id} flexDirection="column" marginBottom={1}>
              <Text color={Colors.accent} bold>
                {Icons.diamond} {c.message}
              </Text>
              <Text color={Colors.muted}> why: {c.whyAsking}</Text>
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
                reversible: {c.reversible ? 'yes' : 'no'} {Icons.dot}{' '}
                requires_human: {c.requiresHuman ? 'yes' : 'no'} {Icons.dot}{' '}
                {isSafeToSkip ? 'safe to skip' : 'skipping not safe'}
              </Text>
              <Text color={Colors.muted}>
                {' '}
                resume: <Text bold>{c.resumeCommand.join(' ')}</Text>
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Pending manual verifications */}
      <Box flexDirection="column" marginBottom={1}>
        <SectionHeader
          title="Pending verifications"
          count={data.pendingVerifications.length}
          emptyHint="None"
        />
        {data.pendingVerifications.slice(0, 5).map((v) => (
          <Box key={v.id} flexDirection="column" marginBottom={1}>
            <Text color={Colors.warning} bold>
              {Icons.bullet} {v.whatToVerify}
            </Text>
            <Text color={Colors.muted}> expected: {v.expectedBehavior}</Text>
            {v.unblockerHint && (
              <Text color={Colors.muted}> hint: {v.unblockerHint}</Text>
            )}
            <Text color={Colors.muted}>
              {' '}
              resume: <Text bold>{v.resumeCommand.join(' ')}</Text>
            </Text>
          </Box>
        ))}
      </Box>

      {/* MCP capabilities */}
      {data.capabilities.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <SectionHeader
            title="MCP capabilities"
            count={data.capabilities.length}
          />
          {data.capabilities.slice(0, 6).map((c) => (
            <Text key={c.id} color={Colors.body}>
              {Icons.bullet} <Text bold>{c.kind}</Text> {Icons.dot}{' '}
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
          <SectionHeader
            title="Owned artifacts"
            count={lsp.relevantOwnership.length}
          />
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
