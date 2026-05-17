/**
 * JourneyStepper — persistent 1-line progress indicator.
 *
 * Shows where the user is in the wizard flow:
 *   ✓ Welcome  ✓ Auth  ● Setup  ○ Verify  ○ Done
 *
 * Adapts to terminal width: shows labels on wide terminals,
 * dots-only on narrow ones.
 */

import { Box, Text } from 'ink';
import type { WizardStore, WizardSession } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { Screen, Flow } from '../router.js';
import { Colors, Icons, Brand, Layout } from '../styles.js';
import { OutroKind } from '../session-constants.js';

/** Human-readable labels for wizard flow steps. */
const WIZARD_STEPS: Array<{ screen: Screen; label: string }> = [
  { screen: Screen.Intro, label: 'Welcome' },
  { screen: Screen.Auth, label: 'Auth' },
  { screen: Screen.Run, label: 'Setup' },
  { screen: Screen.DataIngestionCheck, label: 'Verify' },
  { screen: Screen.Outro, label: 'Done' },
];

/** Screens that belong to each step (for grouping substeps). */
const STEP_SCREENS: Record<string, Screen[]> = {
  Welcome: [Screen.Intro],
  // Order matches the actual flow path so getCompletedScreens'
  // flatten reflects what the user has already passed: SignupEmail →
  // SigningUp (probe) → ToS → SignupFullName → SigningUp (second) →
  // Auth → DataSetup. The bucket-level stepper is single-label, so
  // the previous order didn't visibly affect anything, but keeping
  // the array in flow order avoids confusion if a future stepper
  // ever exposes sub-steps.
  Auth: [
    Screen.RegionSelect,
    Screen.SignupEmail,
    Screen.SigningUp,
    Screen.ToS,
    Screen.SignupFullName,
    Screen.Auth,
    Screen.DataSetup,
  ],
  Setup: [Screen.ActivationOptions, Screen.Setup, Screen.Run, Screen.Mcp],
  Verify: [Screen.DataIngestionCheck],
  Done: [Screen.Outro, Screen.Slack],
};

type StepState = 'completed' | 'active' | 'future' | 'failed';

/** Glyph and tint for each step state. Resolved via lookup, not ternary chain. */
const STATE_GLYPH: Record<StepState, string> = {
  completed: Icons.checkmark,
  active: Icons.bullet,
  failed: Icons.cross,
  future: Icons.bulletOpen,
};
const STATE_COLOR: Record<StepState, string> = {
  completed: Brand.lilac,
  active: Colors.accent,
  failed: Colors.error,
  future: Colors.muted,
};

function getStepState(
  stepLabel: string,
  currentScreen: string,
  completedScreens: Set<string>,
): StepState {
  const screens = STEP_SCREENS[stepLabel] ?? [];
  const isCurrent = screens.some((s) => (s as string) === currentScreen);
  if (isCurrent) return 'active';

  // A step is completed if all its screens are completed
  const allDone = screens.every((s) => completedScreens.has(s));
  if (allDone) return 'completed';

  return 'future';
}

/**
 * When the wizard halts with an OutroKind.Error, the positional
 * "currentScreen is past it, so it's ✓" logic in getStepState renders
 * every prior phase as completed — including the phase that actually
 * failed. The user sees `✓ Welcome ─ ✓ Auth ─ ✓ Setup ─ ✓ Verify ─ ● Done`
 * followed by "Setup failed", a direct contradiction.
 *
 * Derive the failed phase from session milestones rather than
 * threading new state through OutroData: the milestones already encode
 * "how far did the user actually get?" and don't need the agent runner
 * to remember which phase it was in at crash time.
 *
 * Returns the label of the step that was in-progress when the run died,
 * or `null` when no error is active.
 */
function getFailedStepLabel(session: WizardSession): string | null {
  if (session.outroData?.kind !== OutroKind.Error) return null;

  // Walk milestones in flow order. The FIRST step that isn't fully
  // complete is the one that failed. Falls back to the last step
  // (Done) if every milestone passed — the failure must have been
  // during outro/post-success teardown.
  if (!session.introConcluded) return 'Welcome';
  const authComplete =
    session.credentials !== null &&
    (session.selectedOrgName !== null || session.selectedOrgId !== null) &&
    session.selectedProjectName !== null &&
    session.selectedEnvName !== null;
  if (!authComplete) return 'Auth';
  // Setup is "complete" only when the run finished without erroring.
  // RunPhase.Error means Setup itself blew up; RunPhase.Idle/Running
  // here implies the wizard never got past Setup either.
  if (session.runPhase !== 'completed') return 'Setup';
  if (!session.dataIngestionConfirmed) return 'Verify';
  return 'Done';
}

/**
 * The terminal Done step is special: when the user has actually
 * reached a successful outro, the step has BOTH "I'm here" semantics
 * AND "the journey is over" semantics. Rendering the in-progress
 * `●` glyph (used for active mid-flow steps) makes the screen look
 * like the wizard is still working — visually indistinguishable from
 * Setup or Verify being underway. Switch the active glyph to `✓`
 * when the run has actually concluded with success so the stepper
 * reflects "you made it" rather than "in progress".
 *
 * Returns true only when the user is on the Done step AND the outro
 * shows success (or the synthetic full-activation success path —
 * mirrors `isSuccess` in OutroScreen). Errors and cancels keep the
 * `●` glyph so the visual difference between "succeeded" and
 * "stopped here for some other reason" stays legible.
 */
function isDoneSuccessActive(
  stepLabel: string,
  state: StepState,
  store: WizardStore,
): boolean {
  if (stepLabel !== 'Done' || state !== 'active') return false;
  const kind = store.session.outroData?.kind;
  if (kind === OutroKind.Success) return true;
  // Full-activation re-runs reach the Outro without an explicit
  // outroData — OutroScreen synthesizes Success in that case. Match
  // its detection so the stepper agrees.
  if (
    !kind &&
    store.session.activationLevel === 'full'
  ) {
    return true;
  }
  return false;
}

/** Build set of screens the flow has already passed. */
function getCompletedScreens(currentScreen: string): Set<string> {
  const completed = new Set<string>();
  const allScreensInOrder = WIZARD_STEPS.flatMap(
    (step) => STEP_SCREENS[step.label] ?? [],
  );
  for (const screen of allScreensInOrder) {
    if ((screen as string) === currentScreen) break;
    completed.add(screen);
  }
  return completed;
}

interface JourneyStepperProps {
  store: WizardStore;
  width: number;
}

export const JourneyStepper = ({ store, width }: JourneyStepperProps) => {
  useWizardStore(store);

  // Only show stepper for the main wizard flow
  if (store.router.activeFlow !== Flow.Wizard) return null;

  const currentScreen = store.currentScreen;
  const completedScreens = getCompletedScreens(currentScreen);
  const failedStepLabel = getFailedStepLabel(store.session);

  // Determine if we have room for labels (need ~50 chars for all labels)
  const showLabels = width >= 60;

  // When an error is active we override the positional state for every
  // step from the failed one onward: failed → ✗, everything after → ○.
  // Without this override the stepper renders ✓ on phases that did not
  // actually complete (the "✓ Setup … Setup failed" contradiction).
  let pastFailed = false;
  const steps = WIZARD_STEPS.map((step) => {
    const baseState = getStepState(
      step.label,
      currentScreen,
      completedScreens,
    );
    if (failedStepLabel !== null) {
      if (step.label === failedStepLabel) {
        pastFailed = true;
        return { ...step, state: 'failed' as const };
      }
      if (pastFailed) {
        return { ...step, state: 'future' as const };
      }
    }
    return { ...step, state: baseState };
  });

  return (
    // Span the full content width and use the shared `Layout.paddingX`
    // token so the stepper aligns with the screen content (which lives
    // inside the same horizontal padding via App.tsx's content-area
    // Box). Without an explicit `width`, the Box shrinks to its content
    // and App.tsx's `alignItems="center"` then visually centers the
    // shrunken row — the "marooned in the middle" complaint. Using
    // `paddingX={1}` here while content used `Layout.paddingX={2}` was
    // the other half of the same misalignment ("wide left margin on
    // content, headers hugging the edge").
    <Box width={width} paddingX={Layout.paddingX}>
      {steps.map((step, i) => {
        // When the user has actually landed on Done with a successful
        // outro, swap the in-progress `●` for `✓` and tint it with the
        // success color. The `←` cursor still points at Done so users
        // can locate themselves in the stepper, but the glyph reads as
        // "completed" rather than "still working".
        const doneSuccess = isDoneSuccessActive(step.label, step.state, store);
        const icon = doneSuccess ? Icons.checkmark : STATE_GLYPH[step.state];
        const color = doneSuccess ? Colors.success : STATE_COLOR[step.state];

        return (
          <Box key={step.label}>
            <Text
              color={color}
              bold={step.state === 'active' || step.state === 'failed'}
            >
              {icon}
            </Text>
            {showLabels && (
              <Text
                color={color}
                bold={step.state === 'active' || step.state === 'failed'}
              >
                {step.state === 'active'
                  ? ` ${step.label} ←`
                  : ` ${step.label}`}
              </Text>
            )}
            {i < steps.length - 1 && (
              <Text color={Colors.border}>
                {showLabels ? ` ${Icons.dash} ` : ` ${Icons.dot} `}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
};
