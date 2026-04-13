/**
 * IntroScreen (v2) — Clean, minimal welcome with framework detection.
 *
 * Four states:
 *   0. Checkpoint restored: resume / start fresh / cancel picker
 *   1. Detecting: spinner while bin.ts runs detection
 *   2. Detection failed: auto-selects Generic, then continue/cancel
 *   3. Detection succeeded: show result, then continue/cancel
 *
 * No ASCII art — compact heading, one-line tagline, inline detection results.
 * Calls store.concludeIntro() to advance past this screen.
 */

import path from 'path';
import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { OutroKind } from '../../../lib/wizard-session.js';
import { Integration } from '../../../lib/constants.js';
import { clearCheckpoint } from '../../../lib/session-checkpoint.js';
import { PickerMenu } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { analytics } from '../../../utils/analytics.js';

interface IntroScreenProps {
  store: WizardStore;
}

export const IntroScreen = ({ store }: IntroScreenProps) => {
  useWizardStore(store);

  const [pickingFramework, setPickingFramework] = useState(false);
  const [manuallySelected, setManuallySelected] = useState(false);
  const [showResume, setShowResume] = useState(
    () => store.session._restoredFromCheckpoint,
  );

  const { session } = store;
  const config = session.frameworkConfig;
  const frameworkLabel =
    session.detectedFrameworkLabel ?? config?.metadata.name;
  const detecting = !session.detectionComplete;
  const needsFrameworkPick =
    session.detectionComplete && !session.frameworkConfig;

  // When detection fails and the user hasn't explicitly opened the picker,
  // auto-select the generic integration so the wizard can proceed.
  useEffect(() => {
    if (needsFrameworkPick && !session.menu && !showResume) {
      void import('../../../lib/registry.js').then(({ FRAMEWORK_REGISTRY }) => {
        const genericConfig = FRAMEWORK_REGISTRY[Integration.generic];
        store.setFrameworkConfig(Integration.generic, genericConfig);
        store.setDetectedFramework(genericConfig.metadata.name);
      });
    }
  }, [needsFrameworkPick, session.menu, showResume]);

  const showContinue =
    session.frameworkConfig !== null && !detecting && !pickingFramework;

  // ── Resume-from-checkpoint prompt ─────────────────────────────────
  if (showResume) {
    const orgLabel =
      session.selectedOrgName ?? session.selectedWorkspaceName ?? null;

    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        alignItems="center"
        justifyContent="flex-start"
        paddingTop={2}
      >
        <Box flexDirection="column" alignItems="center" marginBottom={1}>
          <Text bold color={Colors.heading}>
            Amplitude Wizard
          </Text>
        </Box>

        <Box flexDirection="column" alignItems="flex-start">
          <Text color={Colors.body}>A previous session was interrupted.</Text>

          {frameworkLabel && (
            <Text>
              <Text color={Colors.body}> Framework: </Text>
              <Text color={Colors.secondary}>{frameworkLabel}</Text>
            </Text>
          )}

          {orgLabel && (
            <Text>
              <Text color={Colors.body}> Organization: </Text>
              <Text color={Colors.secondary}>{orgLabel}</Text>
            </Text>
          )}

          <Box marginTop={1}>
            <PickerMenu
              options={[
                { label: 'Resume where you left off', value: 'resume' },
                { label: 'Start fresh', value: 'fresh' },
                { label: 'Cancel', value: 'cancel', hint: 'exit wizard' },
              ]}
              onSelect={(value) => {
                const choice = Array.isArray(value) ? value[0] : value;
                analytics.wizardCapture('Checkpoint Resume Action', {
                  action: choice,
                  integration: session.integration,
                  detected_framework: session.detectedFrameworkLabel,
                });

                if (choice === 'resume') {
                  store.concludeIntro();
                } else if (choice === 'fresh') {
                  // Clear checkpoint and reset restored flag so normal flow takes over
                  clearCheckpoint();
                  store.session = {
                    ...store.session,
                    _restoredFromCheckpoint: false,
                    introConcluded: false,
                    detectionComplete: false,
                    detectedFrameworkLabel: null,
                    integration: null,
                    frameworkConfig: null,
                    frameworkContext: {},
                    region: null,
                    selectedOrgId: null,
                    selectedOrgName: null,
                    selectedWorkspaceId: null,
                    selectedWorkspaceName: null,
                    selectedProjectName: null,
                  };
                  setShowResume(false);
                } else {
                  store.setOutroData({
                    kind: OutroKind.Cancel,
                    message: 'Setup cancelled.',
                  });
                }
              }}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="flex-start"
      paddingTop={2}
    >
      {/* Heading */}
      <Box flexDirection="column" alignItems="center" marginBottom={1}>
        <Text bold color={Colors.heading}>
          Amplitude Wizard
        </Text>
        <Text color={Colors.muted}>AI-powered analytics setup in minutes</Text>
        <Text color={Colors.secondary}>
          Installs the SDK, adds events, and verifies data is flowing.
        </Text>
      </Box>

      {/* Detection spinner */}
      {detecting && (
        <Box marginY={1} gap={1}>
          <BrailleSpinner />
          <Text color={Colors.secondary}>
            Detecting project framework{Icons.ellipsis}
          </Text>
        </Box>
      )}

      {/* Pre-run notice from framework config */}
      {config?.metadata.preRunNotice && (
        <Box marginBottom={1}>
          <Text color={Colors.warning}>{config.metadata.preRunNotice}</Text>
        </Box>
      )}

      {/* Framework picker (when auto-detection fails or user requests change) */}
      {(pickingFramework || (session.menu && needsFrameworkPick)) && (
        <FrameworkPicker
          store={store}
          onComplete={() => setPickingFramework(false)}
        />
      )}

      {/* Detection results + continue menu */}
      {!detecting && !pickingFramework && (
        <Box flexDirection="column" alignItems="flex-start">
          <Text>
            <Text color={Colors.body}>Directory </Text>
            <Text color={Colors.secondary}>
              /{path.basename(session.installDir)}
            </Text>
            <Text color={Colors.success}> {Icons.checkmark}</Text>
          </Text>

          {frameworkLabel && (
            <Text>
              <Text color={Colors.body}>Framework </Text>
              <Text color={Colors.secondary}>
                {frameworkLabel}
                {!manuallySelected && ' (detected)'}
                {config?.metadata.beta && ' [BETA]'}
              </Text>
              <Text color={Colors.success}> {Icons.checkmark}</Text>
            </Text>
          )}

          {showContinue && (
            <Box marginTop={1}>
              <PickerMenu
                options={[
                  { label: 'Continue', value: 'continue' },
                  {
                    label: 'Change framework',
                    value: 'framework',
                    hint: 'pick manually',
                  },
                  { label: 'Cancel', value: 'cancel', hint: 'exit wizard' },
                ]}
                onSelect={(value) => {
                  const choice = Array.isArray(value) ? value[0] : value;
                  analytics.wizardCapture('Intro Action', {
                    action: choice,
                    integration: session.integration,
                    detected_framework: session.detectedFrameworkLabel,
                  });
                  if (choice === 'cancel') {
                    store.setOutroData({
                      kind: OutroKind.Cancel,
                      message: 'Setup cancelled.',
                    });
                  } else if (choice === 'framework') {
                    setPickingFramework(true);
                    setManuallySelected(true);
                  } else {
                    store.concludeIntro();
                  }
                }}
              />
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

/**
 * Popularity-ordered list for the manual framework picker.
 * Excludes `generic` — the wizard auto-selects it when detection fails.
 */
const PICKER_ORDER: Integration[] = [
  Integration.nextjs,
  Integration.reactRouter,
  Integration.vue,
  Integration.reactNative,
  Integration.python,
  Integration.django,
  Integration.flask,
  Integration.fastapi,
  Integration.javascript_web,
  Integration.javascriptNode,
  Integration.swift,
  Integration.android,
  Integration.flutter,
  Integration.go,
  Integration.java,
  Integration.unity,
  Integration.unreal,
];

/** Framework picker shown when auto-detection fails. */
const FrameworkPicker = ({
  store,
  onComplete,
}: {
  store: WizardStore;
  onComplete?: () => void;
}) => {
  const [options, setOptions] = useState<
    { label: string; value: Integration }[]
  >([]);

  useEffect(() => {
    void import('../../../lib/registry.js').then(({ FRAMEWORK_REGISTRY }) => {
      setOptions(
        PICKER_ORDER.map((integration) => ({
          label: FRAMEWORK_REGISTRY[integration].metadata.name,
          value: integration,
        })),
      );
    });
  }, []);

  if (options.length === 0) return null;

  return (
    <PickerMenu<Integration>
      centered
      message="Select your framework"
      options={options}
      onSelect={(value) => {
        const integration = Array.isArray(value) ? value[0] : value;
        analytics.wizardCapture('Framework Manually Selected', { integration });
        void import('../../../lib/registry.js').then(
          ({ FRAMEWORK_REGISTRY }) => {
            const config = FRAMEWORK_REGISTRY[integration];
            store.setFrameworkConfig(integration, config);
            store.setDetectedFramework(config.metadata.name);
            onComplete?.();
          },
        );
      }}
    />
  );
};
