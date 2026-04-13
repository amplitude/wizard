/**
 * RunScreen (v2) — Agent dashboard focused on tasks and progress.
 *
 * Tabs:
 *   - Progress (default): full-width ProgressList, elapsed timer, currently
 *     editing file, inline event plan, and compact conditional tips
 *   - Logs: LogViewer tailing the wizard log file
 *   - Snake: easter egg game
 *
 * No marketing tips carousel. Conditional feature tips (Stripe, LLM) are
 * shown as single compact lines when relevant.
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import type { WizardStore } from '../store.js';
import {
  TabContainer,
  ProgressList,
  LogViewer,
  SnakeGame,
} from '../primitives/index.js';
import type { ProgressItem } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { AmplitudeLogo } from '../components/AmplitudeLogo.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { DiscoveredFeature } from '../../../lib/wizard-session.js';
import {
  AdditionalFeature,
  ADDITIONAL_FEATURE_LABELS,
} from '../session-constants.js';
import { OUTBOUND_URLS } from '../../../lib/constants.js';

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

/** Compact conditional tips — Stripe link, LLM toggle. */
const ConditionalTips = ({ store }: { store: WizardStore }) => {
  const { discoveredFeatures } = store.session;
  const tips: ReactNode[] = [];

  if (discoveredFeatures.includes(DiscoveredFeature.Stripe)) {
    tips.push(
      <Text key="stripe" color={Colors.secondary}>
        <Text color={Colors.accent}>{Icons.diamond}</Text> Stripe detected
        {Icons.dash} add as data source:{' '}
        <Text color={Colors.accentSecondary}>
          {OUTBOUND_URLS.stripeDataSource}
        </Text>
      </Text>,
    );
  }

  if (discoveredFeatures.includes(DiscoveredFeature.LLM)) {
    const enabled = store.session.llmOptIn;
    tips.push(
      <Text key="llm" color={Colors.secondary}>
        <Text color={Colors.accent}>{Icons.diamond}</Text>{' '}
        {enabled ? (
          <Text color={Colors.success}>
            {Icons.checkmark} LLM analytics setup queued
          </Text>
        ) : (
          <Text>
            LLM dependencies detected {Icons.dash} press{' '}
            <Text bold color={Colors.accent}>
              L
            </Text>{' '}
            to enable LLM analytics
          </Text>
        )}
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

  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  // Elapsed time counter — update every 5s to reduce re-renders
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Handle LLM toggle key
  useScreenInput((input) => {
    if (
      input.toLowerCase() === 'l' &&
      store.session.discoveredFeatures.includes(DiscoveredFeature.LLM) &&
      !store.session.llmOptIn
    ) {
      store.enableFeature(AdditionalFeature.LLM);
    }
  });

  const progressItems: ProgressItem[] = store.tasks.map((t) => ({
    label: t.label,
    activeForm: t.activeForm,
    status: t.status,
  }));

  // When all tasks are done but the queue has features, show a transitional item
  const queue = store.session.additionalFeatureQueue;
  const allDone =
    progressItems.length > 0 &&
    progressItems.every((t) => t.status === 'completed');
  if (allDone && queue.length > 0) {
    const nextLabel = ADDITIONAL_FEATURE_LABELS[queue[0]];
    progressItems.push({
      label: `Set up ${nextLabel}`,
      activeForm: `Setting up ${nextLabel}...`,
      status: 'in_progress',
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
        {/* Header bar: progress count + elapsed + currently editing */}
        <Box marginBottom={1} justifyContent="space-between">
          <Box gap={1}>
            <BrailleSpinner color={Colors.active} />
            <Text color={Colors.body} bold>
              {total > 0
                ? `${completed}/${total} tasks complete`
                : 'Agent running'}
            </Text>
            <Text color={Colors.muted}>
              {Icons.dot} {formatElapsed(elapsed)}
            </Text>
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

      {/* Right: static logo (hidden on small terminals) */}
      {showLogo && (
        <Box flexShrink={0} marginTop={1} marginRight={1}>
          <AmplitudeLogo />
        </Box>
      )}
    </Box>
  );
};

export const RunScreen = ({ store }: RunScreenProps) => {
  useWizardStore(store);

  const lastStatus =
    store.statusMessages.length > 0
      ? store.statusMessages[store.statusMessages.length - 1]
      : undefined;

  const tabs = [
    {
      id: 'progress',
      label: 'Progress',
      component: <ProgressTab store={store} />,
    },
    {
      id: 'logs',
      label: 'Logs',
      component: <LogViewer filePath={LOG_FILE} />,
    },
    {
      id: 'snake',
      label: 'Snake',
      component: <SnakeGame />,
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
