/**
 * RunScreen — Agent dashboard focused on tasks and progress.
 *
 * Tabs:
 *   - Progress (default): full-width ProgressList, elapsed timer, currently
 *     editing file, inline event plan, and compact conditional tips
 *   - Logs: LogViewer tailing the wizard log file
 *   - Snake: easter egg game
 *
 * Queued additional features (LLM, Session Replay) appear in the task list
 * as pending → in_progress → completed items as the stop hook drains the
 * queue. Stripe stays a passive doc-link tip when detected.
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { useScreenHints } from '../hooks/useScreenHints.js';
import type { KeyHint } from '../components/KeyHintBar.js';
import type { WizardStore } from '../store.js';
import {
  TabContainer,
  ProgressList,
  LogViewer,
  SnakeGame,
  EventPlanViewer,
  TerminalLink,
} from '../primitives/index.js';
import type { ProgressItem } from '../primitives/index.js';
import { Colors, Icons, SPINNER_FRAMES, SPINNER_INTERVAL } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { AnimatedAmplitudeLogo } from '../components/AmplitudeLogo.js';
import { RetryStatusChip } from '../components/RetryBanner.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { DiscoveredFeature } from '../../../lib/wizard-session.js';
import {
  ADDITIONAL_FEATURE_LABELS,
  TRAILING_FEATURES,
} from '../session-constants.js';
import { OUTBOUND_URLS } from '../../../lib/constants.js';

const RUN_HINTS: readonly KeyHint[] = Object.freeze([
  { key: '←→', label: 'Tabs' },
  { key: 'Ctrl+C', label: 'Cancel' },
]);

const LOG_FILE = '/tmp/amplitude-wizard.log';

/** File extensions used to detect "currently editing" from status messages. */
const FILE_EXT_PATTERN =
  /\S+\.(?:tsx?|jsx?|py|swift|kt|java|go|dart|cs|cpp|vue|svelte|rb)\b/;

/** Format elapsed seconds as "Xm Ys". */
function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

/** Extract a file path from the most recent status message, if any. */
function extractCurrentFile(messages: string[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const match = messages[i].match(FILE_EXT_PATTERN);
    if (match) return match[0];
  }
  return null;
}

interface RunScreenProps {
  store: WizardStore;
}

/** Compact inline display of planned event names. */
const InlineEventPlan = ({ store }: { store: WizardStore }) => {
  const events = store.eventPlan.filter((e) => e.name);
  if (events.length === 0) return null;

  return (
    <Box marginTop={1} flexDirection="column">
      <Text color={Colors.secondary}>
        <Text bold color={Colors.accent}>
          {Icons.diamond} Events:
        </Text>{' '}
        {events.map((e) => e.name).join(', ')}
      </Text>
    </Box>
  );
};

/** Compact conditional tips — Stripe doc link only (other features are queued tasks). */
const ConditionalTips = ({ store }: { store: WizardStore }) => {
  const { discoveredFeatures } = store.session;
  const tips: ReactNode[] = [];

  if (discoveredFeatures.includes(DiscoveredFeature.Stripe)) {
    tips.push(
      <Text key="stripe" color={Colors.secondary}>
        <Text color={Colors.accent}>{Icons.diamond}</Text> Stripe detected
        {Icons.dash} add as data source:{' '}
        <TerminalLink url={OUTBOUND_URLS.stripeDataSource}>
          {OUTBOUND_URLS.stripeDataSource}
        </TerminalLink>
      </Text>,
    );
  }

  if (tips.length === 0) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      {tips}
    </Box>
  );
};

/** The main Progress tab content. */
const MIN_COLS_FOR_LOGO = 90;
const MIN_ROWS_FOR_LOGO = 22;

const ProgressTab = ({ store }: { store: WizardStore }) => {
  const [cols, rows] = useStdoutDimensions();
  const showLogo = cols >= MIN_COLS_FOR_LOGO && rows >= MIN_ROWS_FOR_LOGO;

  // Single interval drives the spinner, logo animation, and elapsed timer.
  // All three re-render in the same batch — no extra render cycles.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), SPINNER_INTERVAL);
    return () => clearInterval(id);
  }, []);

  // Start time lives in the session so the elapsed counter keeps climbing
  // when the user tabs away and back (TabContainer unmounts inactive tabs).
  // The ?? fallback is defensive — setRunPhase(Running) always stamps this.
  const startedAt = store.session.runStartedAt ?? Date.now();
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const spinnerFrame = tick % SPINNER_FRAMES.length;

  const progressItems: ProgressItem[] = store.tasks.map((t) => ({
    label: t.label,
    activeForm: t.activeForm,
    status: t.status,
  }));

  // Synthesize task items for trailing additional features: completed (in
  // run order), then the one currently being processed by the stop hook
  // (in_progress), then the rest of the queue (pending). Inline features
  // (e.g. Session Replay) are configured during SDK init and surface via
  // the agent's own TodoWrite items, not here.
  const { additionalFeatureCompleted, additionalFeatureCurrent } =
    store.session;
  const queueRemainder = store.session.additionalFeatureQueue.filter(
    (f) =>
      f !== additionalFeatureCurrent &&
      !additionalFeatureCompleted.includes(f) &&
      TRAILING_FEATURES.has(f),
  );
  for (const feature of additionalFeatureCompleted.filter((f) =>
    TRAILING_FEATURES.has(f),
  )) {
    const label = ADDITIONAL_FEATURE_LABELS[feature];
    progressItems.push({
      label: `Set up ${label}`,
      activeForm: `Setting up ${label}...`,
      status: 'completed',
    });
  }
  if (
    additionalFeatureCurrent &&
    TRAILING_FEATURES.has(additionalFeatureCurrent)
  ) {
    const label = ADDITIONAL_FEATURE_LABELS[additionalFeatureCurrent];
    progressItems.push({
      label: `Set up ${label}`,
      activeForm: `Setting up ${label}...`,
      status: 'in_progress',
    });
  }
  for (const feature of queueRemainder) {
    const label = ADDITIONAL_FEATURE_LABELS[feature];
    progressItems.push({
      label: `Set up ${label}`,
      activeForm: `Setting up ${label}...`,
      status: 'pending',
    });
  }

  const rawFile = extractCurrentFile(store.statusMessages);
  const lastFileRef = useRef<string | null>(null);
  if (rawFile) lastFileRef.current = rawFile;
  const currentFile = lastFileRef.current;

  const completed = progressItems.filter(
    (t) => t.status === 'completed',
  ).length;
  const total = progressItems.length;

  return (
    <Box flexDirection="row" flexGrow={1}>
      {/* Left: tasks and status (takes all remaining width) */}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} paddingX={1}>
        {/* Header bar: progress count + elapsed + (transient retry hint) +
            currently editing. Retry status renders inline as a muted chip
            after a 3s grace period — see RetryStatusChip. */}
        <Box marginBottom={1} justifyContent="space-between">
          <Box gap={1}>
            <BrailleSpinner color={Colors.active} frame={spinnerFrame} />
            <Text color={Colors.body} bold>
              {total > 0
                ? `${completed}/${total} tasks complete`
                : 'Agent running'}
            </Text>
            <Text color={Colors.muted}>
              {Icons.dot} {formatElapsed(elapsed)}
            </Text>
            <RetryStatusChip
              retryState={store.session.retryState}
              now={Date.now()}
            />
          </Box>
          {currentFile && (
            <Text color={Colors.muted} wrap="truncate-end">
              {currentFile}
            </Text>
          )}
        </Box>

        {/* Tasks — the hero */}
        <ProgressList items={progressItems} title="Tasks" />

        {/* Inline event plan */}
        <InlineEventPlan store={store} />

        {/* Compact conditional tips */}
        <ConditionalTips store={store} />
      </Box>

      {/* Right: animated logo, steps with spinner tick (hidden on small terminals) */}
      {showLogo && (
        <Box flexShrink={0} marginTop={1} marginRight={1}>
          <AnimatedAmplitudeLogo tick={tick} />
        </Box>
      )}
    </Box>
  );
};

export const RunScreen = ({ store }: RunScreenProps) => {
  useWizardStore(store);
  useScreenHints(RUN_HINTS);

  const lastStatus =
    store.statusMessages.length > 0
      ? store.statusMessages[store.statusMessages.length - 1]
      : undefined;

  const hasEvents = store.eventPlan.length > 0;

  const tabs = [
    {
      id: 'progress',
      label: 'Progress',
      component: <ProgressTab store={store} />,
    },
    ...(hasEvents
      ? [
          {
            id: 'events',
            label: 'Events',
            component: <EventPlanViewer events={store.eventPlan} />,
          },
        ]
      : []),
    {
      id: 'logs',
      label: 'Logs',
      component: <LogViewer filePath={LOG_FILE} />,
    },
    {
      id: 'snake',
      label: 'Snake (WASD)',
      component: (
        <SnakeGame
          music={false}
          keybindings={{
            up: ['w'],
            down: ['s'],
            left: ['a'],
            right: ['d'],
          }}
        />
      ),
    },
  ];

  return (
    <TabContainer
      tabs={tabs}
      statusMessage={lastStatus}
      requestedTab={store.requestedTab}
      onTabConsumed={() => store.clearRequestedTab()}
    />
  );
};
