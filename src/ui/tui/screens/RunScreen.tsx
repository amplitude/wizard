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
import { useTimedCoaching } from '../hooks/useTimedCoaching.js';
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
import { getLogFile } from '../../../utils/storage-paths.js';

const RUN_HINTS: readonly KeyHint[] = Object.freeze([
  { key: '←→', label: 'Tabs' },
  { key: 'Ctrl+C', label: 'Cancel' },
]);

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

/**
 * Cap a status string for inline display. Belt-and-braces against unbounded
 * streamed content (e.g. raw stream-event JSON forwarded by runAgentLocally
 * before its filter stripped them). Yoga's `truncate-end` is the primary
 * defense once the row is flex-shrinkable, but a JS cap keeps the header
 * sane regardless of layout context.
 */
const STATUS_MAX_LEN = 80;
function truncateStatus(s: string): string {
  if (s.length <= STATUS_MAX_LEN) return s;
  return s.slice(0, STATUS_MAX_LEN - 1) + '…';
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
  const inProgress = progressItems.filter(
    (t) => t.status === 'in_progress',
  ).length;
  const pending = progressItems.filter((t) => t.status === 'pending').length;
  const total = progressItems.length;

  // High-water mark for the "done" counter. The agent can grow its
  // TodoWrite list mid-run, which means the count we display would
  // otherwise visibly regress: 5/5 done → 5/8 done as soon as 3 new
  // tasks land. Pinning the displayed "done" count to its maximum
  // observed value keeps the user-perceived progress monotonically
  // forward; the "to go" side is always the live pending+inProgress
  // count, so new tasks still surface clearly without rewriting the
  // history of work the user already saw finish.
  const completedHighRef = useRef(0);
  if (completed > completedHighRef.current)
    completedHighRef.current = completed;
  const completedDisplay = completedHighRef.current;

  // Coaching tiers for "spinner spins forever". The progress signal is the
  // task count — every time the agent reports a new task, the timer resets
  // because forward motion means the user shouldn't be nagged. Tiers fire
  // at 90s (calm reassurance) and 5min (escalated suggestion).
  // RUN_COACHING_TIER_T1_S=90, RUN_COACHING_TIER_T2_S=300.
  const { tier: coachingTier } = useTimedCoaching({
    thresholds: [90, 300],
    progressSignal: total,
  });

  // Cold-start UX: until the agent finishes its first task the counter sits
  // at "0 done · N to go" with the timer climbing — every screenshot the
  // wizard's collected of users Ctrl+C-ing during Setup has been in this
  // exact gap. The agent IS working (its [STATUS] shows up at the bottom),
  // but the user's eye lands on the spinner header and the header looks
  // dead. Surface the latest status next to the counter, and after 30s of
  // zero completed tasks add an explanatory hint so a slow first response
  // doesn't read as a hung wizard.
  const lastStatus =
    store.statusMessages.length > 0
      ? store.statusMessages[store.statusMessages.length - 1]
      : undefined;
  const showColdStartHint =
    completedDisplay === 0 && total > 0 && elapsed >= 30;

  return (
    <Box flexDirection="row" flexGrow={1}>
      {/* Left: tasks and status (takes all remaining width) */}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} paddingX={1}>
        {/* Header bar: progress count + elapsed + (transient retry hint) +
            currently editing. Retry status renders inline as a muted chip
            after a 3s grace period — see RetryStatusChip. */}
        <Box marginBottom={1} flexDirection="column">
          <Box justifyContent="space-between">
            <Box gap={1}>
              <BrailleSpinner color={Colors.active} frame={spinnerFrame} />
              <Text color={Colors.body} bold>
                {total > 0
                  ? // Avoid "X / Y" — Y can grow as the agent adds new tasks
                    // mid-run, which makes the progress bar look like it's
                    // going backwards (6 tasks → 9 tasks). Show absolute
                    // counts instead so the user sees forward motion.
                    // `completedDisplay` is a high-water mark, so the "done"
                    // count never regresses if new tasks appear after the
                    // user already saw earlier ones finish.
                    pending + inProgress > 0
                    ? `${completedDisplay} done · ${inProgress + pending} to go`
                    : `${completedDisplay} tasks complete`
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
          {/* Show the latest agent status on its own row while nothing is
              finished yet. Stays below the counter (not inline) — long
              status strings used to push the counter siblings to wrap onto
              the next line. Truncated in JS as a belt-and-braces guard
              against unbounded streamed content (e.g. raw stream-event
              JSON from `runAgentLocally`). Once the first task lands, the
              regular status pill below the tabs takes over and we don't
              need to duplicate it in the header. */}
          {completedDisplay === 0 && lastStatus && (
            <Text color={Colors.muted} wrap="truncate-end">
              {Icons.dot} {truncateStatus(lastStatus)}
            </Text>
          )}
          {showColdStartHint && (
            <Text color={Colors.muted}>
              {Icons.dot} Still on the agent's first response — cold start can
              take 30–60s while it loads skills and reads your project. The
              status above shows it's working, not stuck.
            </Text>
          )}
        </Box>

        {/* Tasks — the hero */}
        <ProgressList items={progressItems} title="Tasks" />

        {/* Coaching: surfaces calmly after 90s of no task-count progress.
            The spinner stays — this is a *secondary* line that gives the
            user something to do (open Logs, cancel) instead of staring
            at a frozen indicator. Resets when a new task appears. */}
        {coachingTier >= 1 && (
          <Box marginTop={1}>
            <Text color={Colors.muted}>
              {coachingTier >= 2
                ? "This is unusually slow. The Logs tab (Tab) may show what's stuck — or Ctrl+C to cancel."
                : "Still working — switch to the Logs tab (Tab) to see what's happening, or Ctrl+C to cancel."}
            </Text>
          </Box>
        )}

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
      // Per-project log file under ~/.amplitude/wizard/runs/<hash>/log.txt.
      // Resolving from session.installDir keeps two parallel runs in
      // separate logs (vs. the previous global /tmp/amplitude-wizard.log).
      // PR 322 added getLogFilePath() with a runtime AMPLITUDE_WIZARD_LOG
      // override; per-project pathing supersedes it. If a future PR wants
      // both, getLogFile() can grow an env-override branch.
      component: <LogViewer filePath={getLogFile(store.session.installDir)} />,
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
