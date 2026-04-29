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

import { Box, Text } from 'ink';
import { useState, useEffect, useMemo } from 'react';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { OutroKind } from '../session-constants.js';
import { Integration } from '../../../lib/constants.js';
import { clearCheckpoint } from '../../../lib/session-checkpoint.js';
import { analyzeWorkspace } from '../../../lib/workspace-analysis.js';
import { PickerMenu } from '../primitives/index.js';
import { PathInput } from '../components/PathInput.js';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { AmplitudeTextLogo } from '../components/AmplitudeTextLogo.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { useScreenHints } from '../hooks/useScreenHints.js';
import { analytics } from '../../../utils/analytics.js';
import { logToFile } from '../../../utils/debug.js';
import type { KeyHint } from '../components/KeyHintBar.js';

const INTRO_HINTS: readonly KeyHint[] = Object.freeze([
  { key: '↑↓', label: 'Navigate' },
  { key: 'Enter', label: 'Select' },
]);

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
  useScreenHints(INTRO_HINTS);

  const [cols, rows] = useStdoutDimensions();

  const [pickingFramework, setPickingFramework] = useState(false);
  const [manuallySelected, setManuallySelected] = useState(false);
  // True while the user is typing a new install directory in the inline
  // PathInput. Suppresses the picker + spinner so the input gets the
  // full screen, then flips back to false when the user hits Enter or
  // Esc. The actual re-detection runs through the store action — this
  // local flag is purely UI-state.
  const [changingDirectory, setChangingDirectory] = useState(false);
  const [showResume, setShowResume] = useState(
    () => store.session._restoredFromCheckpoint,
  );

  const { session } = store;

  // Workspace analysis runs once per installDir change. The checks are
  // sync filesystem reads — fine to do during render, and memoizing keeps
  // them off the hot path on every re-render.
  const workspace = useMemo(
    () => analyzeWorkspace(session.installDir),
    [session.installDir],
  );
  const config = session.frameworkConfig;
  const frameworkLabel =
    session.detectedFrameworkLabel ?? config?.metadata.name;
  const detecting = !session.detectionComplete;
  const needsFrameworkPick =
    session.detectionComplete && !session.frameworkConfig;
  // Derive fallback state from session so it survives component remount
  // (e.g. ScreenErrorBoundary retries). Generic is never reachable via
  // the manual picker — it's excluded from PICKER_ORDER — so integration
  // === generic uniquely identifies the auto-fallback path.
  const autoFallback = session.integration === Integration.generic;

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
                  // Clear checkpoint and reset restored flag so normal
                  // flow takes over. Route through the explicit store
                  // action so all per-key listeners fire (the previous
                  // direct `store.session = {...}` assignment worked for
                  // version-based subscribers but silently bypassed
                  // nanostores' per-key change events).
                  clearCheckpoint(store.session.installDir);
                  store.resetForFreshStart();
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

      {/*
        Inline path-input takes over the screen when the user picks
        "Change directory". Everything else (target summary, spinner,
        picker) is hidden until they submit or cancel. That single
        focus point matters — typing a path into a screen that's
        also showing a picker is confusing.
      */}
      {changingDirectory && (
        <Box marginY={1} flexDirection="column" alignItems="flex-start">
          <PathInput
            initialValue={session.installDir}
            onSubmit={(absolutePath) => {
              analytics.wizardCapture('install dir change submitted', {
                'detected framework': session.detectedFrameworkLabel,
              });
              setChangingDirectory(false);
              // Reset framework selection state so the spinner re-runs
              // cleanly against the new tree.
              setManuallySelected(false);
              store.changeInstallDir(absolutePath);
            }}
            onCancel={() => {
              analytics.wizardCapture('install dir change cancelled', {});
              setChangingDirectory(false);
            }}
          />
        </Box>
      )}

      {/*
        Target summary block — visible BOTH during detection and after.
        Showing it during the spinner is critical: if the user is staring
        at "Detecting project framework…" against the wrong directory,
        they need to be able to spot it before detection finishes. Hidden
        only when the user is mid-edit on a new path or the framework
        picker is open.
      */}
      {!changingDirectory && !pickingFramework && (
        <TargetSummary
          displayPath={workspace.displayPath}
          frameworkLabel={frameworkLabel ?? null}
          frameworkGlyph={config?.metadata.glyph}
          frameworkGlyphColor={config?.metadata.glyphColor}
          frameworkBeta={config?.metadata.beta ?? false}
          frameworkSuffix={
            !detecting
              ? getFrameworkLabelSuffix({ manuallySelected, autoFallback })
              : ''
          }
          region={session.region}
          detecting={detecting}
        />
      )}

      {/* Detection spinner — sits below the target so the user sees
          which directory we're scanning while it spins. */}
      {detecting && !changingDirectory && (
        <Box marginY={1} gap={1}>
          <BrailleSpinner />
          <Text color={Colors.secondary}>
            Scanning {workspace.displayPath}
            {Icons.ellipsis}
          </Text>
        </Box>
      )}

      {/* Workspace ambiguity warnings — shown alongside the picker so
          the user has full context before choosing. Hidden during the
          spinner (we don't know the framework yet, no point worrying
          the user) and during inline path input. */}
      {!detecting && !changingDirectory && !pickingFramework && (
        <WorkspaceWarnings
          hasManifest={workspace.hasManifest}
          isMonorepo={workspace.isMonorepo}
          workspaceGlobs={workspace.workspaceGlobs}
        />
      )}

      {/* Pre-run notice from framework config */}
      {config?.metadata.preRunNotice &&
        !detecting &&
        !changingDirectory &&
        !pickingFramework && (
          <Box marginBottom={1}>
            <Text color={Colors.warning}>{config.metadata.preRunNotice}</Text>
          </Box>
        )}

      {/* Generic-fallback explainer — shown when auto-detection found
          nothing usable. Pairs with the manual picker option below. */}
      {autoFallback &&
        !detecting &&
        !changingDirectory &&
        !pickingFramework && (
          <Box marginTop={1}>
            <Text color={Colors.muted}>
              No framework detected. Continue with the generic guide or pick one
              below.
            </Text>
          </Box>
        )}

      {/* Framework picker (when auto-detection fails or user requests change) */}
      {(pickingFramework || (session.menu && needsFrameworkPick)) &&
        !changingDirectory && (
          <FrameworkPicker
            store={store}
            onComplete={(selected) => {
              setPickingFramework(false);
              if (selected) {
                setManuallySelected(true);
              }
            }}
          />
        )}

      {/* Action picker — Continue is always first; the rest are escape
          hatches grouped together so a hurried user with the wrong
          directory doesn't have to scan past meaningless options
          (region, framework) to find the way out. */}
      {showContinue && !changingDirectory && (
        <Box marginTop={compact ? 0 : 1}>
          <PickerMenu
            options={[
              { label: 'Continue', value: 'continue' },
              {
                label: 'Change framework',
                value: 'framework',
                ...(narrow ? {} : { hint: 'pick manually' }),
              },
              ...(session.region
                ? [
                    {
                      label: 'Change region',
                      value: 'region',
                      ...(narrow ? {} : { hint: 'pick US or EU' }),
                    },
                  ]
                : []),
              {
                label: 'Change directory',
                value: 'directory',
                ...(narrow ? {} : { hint: 'point at another project' }),
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
                'has manifest': workspace.hasManifest,
                'is monorepo': workspace.isMonorepo,
              });
              if (choice === 'cancel') {
                store.setOutroData({
                  kind: OutroKind.Cancel,
                  message: 'Setup cancelled.',
                });
              } else if (choice === 'directory') {
                setChangingDirectory(true);
              } else if (choice === 'framework') {
                setPickingFramework(true);
              } else if (choice === 'region') {
                // Force RegionSelect to appear after Continue. Must
                // conclude the intro so the main flow advances past it
                // into the (now re-shown) RegionSelect screen.
                store.setRegionForced();
                store.concludeIntro();
              } else {
                store.concludeIntro();
              }
            }}
          />
        </Box>
      )}
    </Box>
  );
};

/**
 * Labels-first summary of the current target. Renders a compact 2-3
 * line block:
 *
 *   Target      ~/projects/my-app
 *   Framework   ▲  Next.js  (detected)
 *   Region      US
 *
 * Always shows the Target line — even during detection — so the user
 * can spot a wrong directory before the wizard finishes scanning it.
 * Framework / Region only appear once they're known. We keep the label
 * column at a fixed width so values align on a 9-character grid.
 */
const LABEL_WIDTH = 11;

function padLabel(label: string): string {
  if (label.length >= LABEL_WIDTH) return label;
  return label + ' '.repeat(LABEL_WIDTH - label.length);
}

interface TargetSummaryProps {
  displayPath: string;
  frameworkLabel: string | null;
  frameworkGlyph: string | undefined;
  frameworkGlyphColor: string | undefined;
  frameworkBeta: boolean;
  frameworkSuffix: string;
  region: string | null;
  detecting: boolean;
}

const TargetSummary = ({
  displayPath,
  frameworkLabel,
  frameworkGlyph,
  frameworkGlyphColor,
  frameworkBeta,
  frameworkSuffix,
  region,
  detecting,
}: TargetSummaryProps) => {
  return (
    <Box flexDirection="column" alignItems="flex-start">
      <Box>
        <Text color={Colors.muted}>{padLabel('Target')}</Text>
        <Text color={Colors.heading}>{displayPath}</Text>
      </Box>

      {/* Framework only renders once detection is done — during the
          spinner the row would show a stale value or empty slot. */}
      {!detecting && frameworkLabel && (
        <Box>
          <Text color={Colors.muted}>{padLabel('Framework')}</Text>
          {frameworkGlyph && (
            <Text color={frameworkGlyphColor}>{frameworkGlyph} </Text>
          )}
          <Text color={Colors.body}>
            {frameworkLabel}
            {frameworkSuffix}
            {frameworkBeta && ' [BETA]'}
          </Text>
        </Box>
      )}

      {region && (
        <Box>
          <Text color={Colors.muted}>{padLabel('Region')}</Text>
          <Text color={Colors.body}>{region.toUpperCase()}</Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Workspace ambiguity warnings — surfaced before the user hits
 * Continue so they can bail out without ever touching the agent run.
 *
 * Two distinct cases:
 *   - No project manifest at all → likely the wrong directory entirely.
 *     We don't list every accepted manifest type here (that was noise
 *     in the v1 of this screen). The "Change directory" picker option
 *     is the resolution; we don't repeat that hint inside the warning.
 *   - Monorepo root → instrumentation almost always belongs inside a
 *     specific workspace, not at the root. We surface up to three
 *     detected workspace globs so the user has a hint for which
 *     direction to go.
 *
 * Both warnings end with a soft pointer to `wizard plan` for users who
 * want to preview changes without committing. The plan-mode entry
 * point already exists — this is the first time the intro mentions it.
 */
interface WorkspaceWarningsProps {
  hasManifest: boolean;
  isMonorepo: boolean;
  workspaceGlobs: string[];
}

const WorkspaceWarnings = ({
  hasManifest,
  isMonorepo,
  workspaceGlobs,
}: WorkspaceWarningsProps) => {
  const showAny = !hasManifest || isMonorepo;
  if (!showAny) return null;

  return (
    <Box marginTop={1} flexDirection="column" alignItems="flex-start">
      {!hasManifest && (
        <Text color={Colors.warning}>
          {Icons.warning} No project manifest found here. This may not be the
          project you meant.
        </Text>
      )}

      {isMonorepo && (
        <Box flexDirection="column">
          <Text color={Colors.warning}>
            {Icons.warning} This looks like a monorepo root. Pick a workspace
            instead of instrumenting the whole tree.
          </Text>
          {workspaceGlobs.length > 0 && (
            <Text color={Colors.muted}>
              {' '}
              Workspaces: {workspaceGlobs.slice(0, 3).join(', ')}
              {workspaceGlobs.length > 3 ? ', …' : ''}
            </Text>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={Colors.muted}>
          {Icons.dot} Tip: run{' '}
          <Text color={Colors.accentSecondary}>wizard plan</Text> to preview
          changes without writing files.
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Popularity-ordered list for the manual framework picker.
 * Excludes `generic` — the wizard auto-selects it when detection fails.
 *
 * Ordering rationale: put JavaScript (Web) at the top as the safest default
 * for users who aren't sure (it covers most React/Vanilla/SPA projects).
 * Then group web → mobile → backend → games so the list scans cleanly.
 * Number-key shortcuts [1]-[9],[0] map to the first ten entries.
 */
const PICKER_ORDER: Integration[] = [
  Integration.javascript_web,
  Integration.nextjs,
  Integration.reactRouter,
  Integration.vue,
  Integration.reactNative,
  Integration.javascriptNode,
  Integration.python,
  Integration.django,
  Integration.flask,
  Integration.fastapi,
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
  onComplete?: (selected: boolean) => void;
}) => {
  const [options, setOptions] = useState<
    { label: string; value: Integration }[]
  >([]);

  // Esc exits the picker without changing the selection.
  useScreenInput((_input, key) => {
    if (key.escape) onComplete?.(false);
  });

  useEffect(() => {
    void import('../../../lib/registry.js').then(({ FRAMEWORK_REGISTRY }) => {
      setOptions(
        PICKER_ORDER.map((integration) => {
          const { glyph, name } = FRAMEWORK_REGISTRY[integration].metadata;
          return {
            label: glyph ? `${glyph}  ${name}` : name,
            value: integration,
          };
        }),
      );
    });
  }, []);

  if (options.length === 0) return null;

  return (
    <PickerMenu<Integration>
      centered
      message="Select your framework (Esc to go back)"
      options={options}
      onSelect={(value) => {
        const integration = Array.isArray(value) ? value[0] : value;
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
