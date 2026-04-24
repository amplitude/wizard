/**
 * IntroScreen (v2) — Clean, minimal welcome with framework detection.
 *
 * Four states:
 *   0. Checkpoint restored: resume / start fresh / cancel picker
 *   1. Detecting: spinner while bin.ts runs detection
 *   2. Detection failed: auto-selects Generic, then continue/cancel
 *   3. Detection succeeded: show result, then continue/cancel
 *
 * Shows the AmplitudeTextLogo when terminal is wide/tall enough (>=75x20).
 * Calls store.concludeIntro() to advance past this screen.
 */

import path from 'path';
import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { OutroKind } from '../session-constants.js';
import { Integration } from '../../../lib/constants.js';
import { clearCheckpoint } from '../../../lib/session-checkpoint.js';
import { PickerMenu } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { AmplitudeTextLogo } from '../components/AmplitudeTextLogo.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { analytics } from '../../../utils/analytics.js';
import { logToFile } from '../../../utils/debug.js';

interface IntroScreenProps {
  store: WizardStore;
}

const LOGO_MIN_COLS = 75;
const LOGO_MIN_ROWS = 26;
const COMPACT_COLS = 85;
const COMPACT_ROWS = 24;

/**
 * Suffix shown after the framework name. Exported for unit tests.
 * - '' when the user manually picked the framework, or when we fell back
 *   (the main label already reads "none detected" in that case)
 * - ' (detected)' when auto-detection found a real framework
 */
export function getFrameworkLabelSuffix({
  manuallySelected,
  autoFallback,
}: {
  manuallySelected: boolean;
  autoFallback: boolean;
}): string {
  if (manuallySelected || autoFallback) return '';
  return ' (detected)';
}

export const IntroScreen = ({ store }: IntroScreenProps) => {
  useWizardStore(store);

  const [cols, rows] = useStdoutDimensions();

  const [pickingFramework, setPickingFramework] = useState(false);
  const [manuallySelected, setManuallySelected] = useState(false);
  const [autoFallback, setAutoFallback] = useState(false);
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

  // Hide logo when framework picker is open — the long list overlaps in Ink.
  const pickerVisible =
    pickingFramework || (session.menu && needsFrameworkPick);
  const showLogo =
    cols >= LOGO_MIN_COLS && rows >= LOGO_MIN_ROWS && !pickerVisible;
  const compact = rows < COMPACT_ROWS || cols < COMPACT_COLS;
  const narrow = cols < COMPACT_COLS;

  // When detection fails and the user hasn't explicitly opened the picker,
  // auto-select the generic integration so the wizard can proceed.
  // NOTE: we deliberately do NOT call setDetectedFramework here — Generic is a
  // fallback, not a detection. The render derives its label from the config.
  useEffect(() => {
    if (needsFrameworkPick && !session.menu && !showResume) {
      void import('../../../lib/registry.js').then(({ FRAMEWORK_REGISTRY }) => {
        const genericConfig = FRAMEWORK_REGISTRY[Integration.generic];
        store.setFrameworkConfig(Integration.generic, genericConfig);
        setAutoFallback(true);
        logToFile('[intro] no framework matched — falling back to Generic');
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
        {showLogo && <AmplitudeTextLogo />}
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
                analytics.wizardCapture('checkpoint resume action', {
                  action: choice,
                  integration: session.integration,
                  'detected framework': session.detectedFrameworkLabel,
                });

                if (choice === 'resume') {
                  store.concludeIntro();
                } else if (choice === 'fresh') {
                  // Clear checkpoint and reset restored flag so normal flow takes over
                  clearCheckpoint(store.session.installDir);
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
                    selectedEnvName: null,
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
      paddingTop={compact ? 0 : 1}
    >
      {/* Logo (responsive — hidden when terminal is too small) */}
      {showLogo && <AmplitudeTextLogo />}

      {/* Heading — collapses to a single line when the viewport is tight */}
      <Box
        flexDirection="column"
        alignItems="center"
        marginBottom={compact ? 0 : 1}
      >
        <Text bold color={Colors.heading}>
          Amplitude Wizard
        </Text>
        {!compact && (
          <Text color={Colors.muted}>
            AI-powered analytics setup in minutes
          </Text>
        )}
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
          onComplete={(selected) => {
            setPickingFramework(false);
            if (selected) {
              setAutoFallback(false);
              setManuallySelected(true);
            }
          }}
        />
      )}

      {/* Detection results + continue menu */}
      {!detecting && !pickingFramework && (
        <Box flexDirection="column" alignItems="flex-start">
          <Box>
            <Text color={Colors.body}>Directory </Text>
            <Text color={Colors.secondary}>
              /{path.basename(session.installDir)}
            </Text>
            <Text color={Colors.success}> {Icons.checkmark}</Text>
          </Box>

          {frameworkLabel && !autoFallback && (
            <Box>
              <Text color={Colors.body}>Framework </Text>
              {config?.metadata.glyph && (
                <Text color={config.metadata.glyphColor}>
                  {config.metadata.glyph}{' '}
                </Text>
              )}
              <Text color={Colors.secondary}>
                {frameworkLabel}
                {getFrameworkLabelSuffix({ manuallySelected, autoFallback })}
                {config?.metadata.beta && ' [BETA]'}
              </Text>
              <Text color={Colors.success}> {Icons.checkmark}</Text>
            </Box>
          )}

          {autoFallback && (
            <Box marginTop={1}>
              <Text color={Colors.muted}>
                No framework detected. Continue with the generic guide or pick
                one below.
              </Text>
            </Box>
          )}

          {showContinue && (
            <Box marginTop={compact ? 0 : 1}>
              <PickerMenu
                options={[
                  { label: 'Continue', value: 'continue' },
                  {
                    label: 'Change framework',
                    value: 'framework',
                    ...(narrow ? {} : { hint: 'pick manually' }),
                  },
                  {
                    label: 'Cancel',
                    value: 'cancel',
                    ...(narrow ? {} : { hint: 'exit wizard' }),
                  },
                ]}
                onSelect={(value) => {
                  const choice = Array.isArray(value) ? value[0] : value;
                  analytics.wizardCapture('intro action', {
                    action: choice,
                    integration: session.integration,
                    'detected framework': session.detectedFrameworkLabel,
                  });
                  if (choice === 'cancel') {
                    store.setOutroData({
                      kind: OutroKind.Cancel,
                      message: 'Setup cancelled.',
                    });
                  } else if (choice === 'framework') {
                    setPickingFramework(true);
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

const BACK_VALUE = '__back__' as const;
type FrameworkPickerValue = Integration | typeof BACK_VALUE;

/** Framework picker shown when auto-detection fails. */
const FrameworkPicker = ({
  store,
  onComplete,
}: {
  store: WizardStore;
  onComplete?: (selected: boolean) => void;
}) => {
  const [options, setOptions] = useState<
    { label: string; value: FrameworkPickerValue }[]
  >([]);

  // Esc exits the picker without changing the selection.
  useScreenInput((_input, key) => {
    if (key.escape) onComplete?.(false);
  });

  useEffect(() => {
    void import('../../../lib/registry.js').then(({ FRAMEWORK_REGISTRY }) => {
      setOptions([
        { label: '← Back (keep current selection)', value: BACK_VALUE },
        ...PICKER_ORDER.map((integration) => {
          const { glyph, name } = FRAMEWORK_REGISTRY[integration].metadata;
          return {
            label: glyph ? `${glyph}  ${name}` : name,
            value: integration as FrameworkPickerValue,
          };
        }),
      ]);
    });
  }, []);

  if (options.length === 0) return null;

  return (
    <PickerMenu<FrameworkPickerValue>
      centered
      message="Select your framework (Esc to go back)"
      options={options}
      onSelect={(value) => {
        const selected = Array.isArray(value) ? value[0] : value;
        if (selected === BACK_VALUE) {
          onComplete?.(false);
          return;
        }
        const integration = selected;
        analytics.wizardCapture('framework manually selected', { integration });
        void import('../../../lib/registry.js').then(
          ({ FRAMEWORK_REGISTRY }) => {
            const config = FRAMEWORK_REGISTRY[integration];
            store.setFrameworkConfig(integration, config);
            store.setDetectedFramework(config.metadata.name);
            onComplete?.(true);
          },
        );
      }}
    />
  );
};
