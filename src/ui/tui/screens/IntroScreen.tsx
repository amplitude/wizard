/**
 * IntroScreen — Welcome, framework detection, and continue/cancel prompt.
 *
 * Three states:
 *   1. Detecting: spinner while bin.ts runs detection
 *   2. Detection failed: auto-selects Generic, then continue/cancel
 *   3. Detection succeeded: show result, then continue/cancel
 *
 * Calls store.completeSetup() which unblocks bin.ts to start runWizard.
 */

import { readFileSync } from 'node:fs';
import path from 'path';
import { Box, Text } from 'ink';
import { useState, useEffect, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { OutroKind } from '../../../lib/wizard-session.js';
import { Integration } from '../../../lib/constants.js';
import { PickerMenu, LoadingBox } from '../primitives/index.js';

const LOGO_LINES = [
  ' █████╗ ███╗   ███╗██████╗ ██╗     ██╗████████╗██╗   ██╗██████╗ ███████╗',
  '██╔══██╗████╗ ████║██╔══██╗██║     ██║╚══██╔══╝██║   ██║██╔══██╗██╔════╝',
  '███████║██╔████╔██║██████╔╝██║     ██║   ██║   ██║   ██║██║  ██║█████╗  ',
  '██╔══██║██║╚██╔╝██║██╔═══╝ ██║     ██║   ██║   ██║   ██║██║  ██║██╔══╝  ',
  '██║  ██║██║ ╚═╝ ██║██║     ███████╗██║   ██║   ╚██████╔╝██████╔╝███████╗',
  '╚═╝  ╚═╝╚═╝     ╚═╝╚═╝     ╚══════╝╚═╝   ╚═╝    ╚═════╝ ╚═════╝ ╚══════╝',
];

const AMP_BLUE = '#1E61F0';
const AMP_CYAN = '#00D4AA';

function lerpColor(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t).toString(16).padStart(2, '0');
  const g = Math.round(ag + (bg - ag) * t).toString(16).padStart(2, '0');
  const bv = Math.round(ab + (bb - ab) * t).toString(16).padStart(2, '0');
  return `#${r}${g}${bv}`;
}

export const AmplitudeLogo = () => (
  <Box flexDirection="column" alignItems="center" marginBottom={1}>
    {LOGO_LINES.map((line, i) => {
      const chars = line.split('');
      const last = chars.length - 1;
      return (
        <Box key={i} flexDirection="row">
          {chars.map((char, j) => (
            <Text key={j} color={lerpColor(AMP_BLUE, AMP_CYAN, last > 0 ? j / last : 0)}>
              {char}
            </Text>
          ))}
        </Box>
      );
    })}
  </Box>
);
const AMPLITUDE_LOGO = (() => {
  try {
    return readFileSync(
      new URL('../assets/amplilogo.txt', import.meta.url),
      'utf-8',
    ).trimEnd();
  } catch {
    return '';
  }
})();

interface IntroScreenProps {
  store: WizardStore;
}

export const IntroScreen = ({ store }: IntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [pickingFramework, setPickingFramework] = useState(false);
  const [manuallySelected, setManuallySelected] = useState(false);

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
    if (needsFrameworkPick && !session.menu) {
      void import('../../../lib/registry.js').then(({ FRAMEWORK_REGISTRY }) => {
        const genericConfig = FRAMEWORK_REGISTRY[Integration.generic];
        store.setFrameworkConfig(Integration.generic, genericConfig);
        store.setDetectedFramework(genericConfig.metadata.name);
      });
    }
  }, [needsFrameworkPick, session.menu]);
  const showContinue =
    session.frameworkConfig !== null && !detecting && !pickingFramework;
  const showDescription = showContinue;

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
    >
      <AmplitudeLogo />
      <Box flexDirection="column" alignItems="center" marginBottom={1}>
        <Text bold>
          {detecting ? 'Amplitude Wizard starting up' : 'Amplitude Wizard'}
        </Text>

        {showDescription && (
          <Box flexDirection="column" alignItems="center" marginTop={1}>
            {AMPLITUDE_LOGO && (
              <Box marginBottom={1}>
                <Text color="white">{AMPLITUDE_LOGO}</Text>
              </Box>
            )}
            <Text dimColor>
              We'll use AI to analyze your project and integrate Amplitude.
            </Text>
            <Text dimColor>
              .env* file contents will not leave your machine.
            </Text>
            <Box marginTop={1}>
              <Text>From zero to first tracked event in 5 minutes.</Text>
            </Box>
          </Box>
        )}
      </Box>

      {detecting && (
        <Box marginY={1}>
          <LoadingBox message="Detecting project framework..." />
        </Box>
      )}

      {config?.metadata.preRunNotice && (
        <Text color="yellow">{config.metadata.preRunNotice}</Text>
      )}

      {(pickingFramework || (session.menu && needsFrameworkPick)) && (
        <FrameworkPicker
          store={store}
          onComplete={() => setPickingFramework(false)}
        />
      )}

      {!detecting && !pickingFramework && (
        <Box flexDirection="column">
          <Text>
            <Text>
              Directory <Text color="green">{'\u2714'}</Text>{' '}
            </Text>
            <Text>
              {'/'}
              {path.basename(session.installDir)}{' '}
            </Text>
          </Text>
          {frameworkLabel && (
            <Text>
              <Text>
                Framework <Text color="green">{'\u2714'}</Text>{' '}
              </Text>
              <Text>
                {frameworkLabel}
                {!manuallySelected && ' (detected)'}{' '}
                {config?.metadata.beta && '[BETA]'}
              </Text>
            </Text>
          )}
          {showContinue && (
            <PickerMenu
              options={[
                { label: 'Continue', value: 'continue' },
                { label: 'Change framework', value: 'framework' },
                { label: 'Cancel', value: 'cancel' },
              ]}
              onSelect={(value) => {
                const choice = Array.isArray(value) ? value[0] : value;
                if (choice === 'cancel') {
                  store.setOutroData({ kind: OutroKind.Cancel, message: 'Setup cancelled.' });
                } else if (choice === 'framework') {
                  setPickingFramework(true);
                  setManuallySelected(true);
                } else {
                  store.completeSetup();
                }
              }}
            />
          )}
        </Box>
      )}
    </Box>
  );
};

/** Framework picker shown when auto-detection fails. */
const FrameworkPicker = ({
  store,
  onComplete,
}: {
  store: WizardStore;
  onComplete?: () => void;
}) => {
  // Build options from the framework registry (loaded dynamically to avoid circular deps)
  const options = Object.values(Integration).map((value) => ({
    label: value,
    value,
  }));

  return (
    <PickerMenu<Integration>
      centered
      columns={2}
      message="Select your framework"
      options={options}
      onSelect={(value) => {
        const integration = Array.isArray(value) ? value[0] : value;
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
