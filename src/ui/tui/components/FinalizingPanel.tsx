/**
 * FinalizingPanel — visible representation of the post-agent step queue.
 *
 * Renders below the agent's task list during the gap between the agent
 * saying "done" (TodoWrite all-✓) and the wizard transitioning past
 * Screen.Run. Without this, that gap is silent for up to 90 seconds and
 * users read it as a hung wizard.
 *
 * Each row mirrors the visual language of ProgressList — open square
 * for pending, triangle for in_progress, filled square for completed —
 * with a fourth "skipped" state (open circle) used when a step couldn't
 * proceed (no events instrumented, couldn't resolve project, MCP write
 * tool unavailable, etc.). The skipped state surfaces a short reason so
 * the user knows what happened without opening Logs.
 *
 * Per-step elapsed time renders next to the active row so the user sees
 * forward motion. A coaching message fires at 20s and 40s anchored on
 * the *active step's* startedAt (not the run's elapsed) — otherwise a
 * 5-min agent run would put us in tier-1 immediately.
 */
import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { PostAgentStep } from '../../../lib/wizard-session.js';
import { PostAgentStepStatus } from '../session-constants.js';
import { Colors, Icons } from '../styles.js';

interface FinalizingPanelProps {
  steps: PostAgentStep[];
}

const TIER_1_THRESHOLD_MS = 20_000;
const TIER_2_THRESHOLD_MS = 40_000;

/** Format elapsed seconds compactly: "8s" or "1m 4s". */
function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s}s`;
}

export const FinalizingPanel = ({ steps }: FinalizingPanelProps) => {
  const hasSteps = steps.length > 0;

  // Tick once per second so the active-step elapsed time and coaching
  // tier transitions render. Only starts when steps are seeded to avoid
  // wasted state-update cycles during the main agent run.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!hasSteps) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasSteps]);

  if (!hasSteps) return null;

  const active = steps.find((s) => s.status === PostAgentStepStatus.InProgress);
  const activeElapsedMs = active?.startedAt ? Date.now() - active.startedAt : 0;
  const tier =
    !active || activeElapsedMs < TIER_1_THRESHOLD_MS
      ? 0
      : activeElapsedMs < TIER_2_THRESHOLD_MS
      ? 1
      : 2;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={Colors.heading}>
        Finalizing in Amplitude
      </Text>
      <Box height={1} />
      {steps.map((step) => {
        const icon =
          step.status === PostAgentStepStatus.Completed
            ? Icons.squareFilled
            : step.status === PostAgentStepStatus.InProgress
            ? Icons.triangleRight
            : step.status === PostAgentStepStatus.Skipped
            ? Icons.bulletOpen
            : Icons.squareOpen;
        const color =
          step.status === PostAgentStepStatus.Completed
            ? Colors.success
            : step.status === PostAgentStepStatus.InProgress
            ? Colors.primary
            : step.status === PostAgentStepStatus.Skipped
            ? Colors.subtle
            : Colors.muted;
        const label =
          step.status === PostAgentStepStatus.InProgress
            ? step.activeForm
            : step.label;
        const isPending = step.status === PostAgentStepStatus.Pending;

        return (
          <Box key={step.id} flexDirection="row">
            <Box flexShrink={0}>
              <Text color={color}>{icon} </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} flexDirection="row" gap={1}>
              <Text color={isPending ? Colors.muted : undefined}>{label}</Text>
              {step.status === PostAgentStepStatus.InProgress &&
                step.startedAt !== undefined && (
                  <Text color={Colors.muted}>
                    {Icons.dot} {formatElapsed(activeElapsedMs)}
                  </Text>
                )}
              {step.status === PostAgentStepStatus.Skipped && step.reason && (
                <Text color={Colors.muted}>
                  {Icons.dash} {step.reason}
                </Text>
              )}
            </Box>
          </Box>
        );
      })}
      {tier >= 1 && active && (
        <Box marginTop={1}>
          <Text color={Colors.muted}>
            {tier >= 2
              ? `${Icons.dot} If this stalls, press Ctrl+C and re-run — we'll resume from where we left off.`
              : `${Icons.dot} Still working in Amplitude — this can take up to 30s for new projects.`}
          </Text>
        </Box>
      )}
    </Box>
  );
};
