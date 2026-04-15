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
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { Screen, Flow } from '../router.js';
import { Colors, Icons, Brand } from '../styles.js';

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
  Auth: [Screen.RegionSelect, Screen.Auth, Screen.DataSetup],
  Setup: [Screen.ActivationOptions, Screen.Setup, Screen.Run, Screen.Mcp],
  Verify: [Screen.DataIngestionCheck],
  Done: [Screen.Slack, Screen.Outro],
};

type StepState = 'completed' | 'active' | 'future';

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

  // Determine if we have room for labels (need ~50 chars for all labels)
  const showLabels = width >= 60;

  const steps = WIZARD_STEPS.map((step) => {
    const state = getStepState(step.label, currentScreen, completedScreens);
    return { ...step, state };
  });

  return (
    <Box paddingX={1}>
      {steps.map((step, i) => {
        const icon =
          step.state === 'completed'
            ? Icons.checkmark
            : step.state === 'active'
              ? Icons.bullet
              : Icons.bulletOpen;

        const color =
          step.state === 'completed'
            ? Brand.lilac
            : step.state === 'active'
              ? Colors.accent
              : Colors.muted;

        return (
          <Box key={step.label}>
            <Text color={color} bold={step.state === 'active'}>
              {icon}
            </Text>
            {showLabels && (
              <Text color={color} bold={step.state === 'active'}>
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
