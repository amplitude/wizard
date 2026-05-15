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
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useTimedCoaching } from '../hooks/useTimedCoaching.js';
import { RunTimeline } from '../components/RunTimeline.js';
import type { KeyHint } from '../components/KeyHintBar.js';
import type { WizardStore } from '../store.js';
import { AskBar } from '../components/AskBar.js';
import * as agentInterrupt from '../lib/agentInterrupt.js';
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
import { RetryStatusChip } from '../components/RetryBanner.js';
import { FileWritesPanel } from '../components/FileWritesPanel.js';
import { FinalizingPanel } from '../components/FinalizingPanel.js';
import {
  ExtrasPanel,
  filterExtrasByFramework,
  type ExtraItem,
} from '../components/ExtrasPanel.js';
import { ActiveTaskSubsteps } from '../components/ActiveTaskSubsteps.js';
import { DiscoveryFeed } from '../components/DiscoveryFeed.js';
import { TypewriterFilename } from '../components/TypewriterFilename.js';
import { resolveRunStatusPill } from './run-status-pill.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { useResolvedZone } from '../hooks/useResolvedZone.js';
import { DiscoveredFeature } from '../../../lib/wizard-session.js';
import {
  ADDITIONAL_FEATURE_LABELS,
  TRAILING_FEATURES,
} from '../session-constants.js';
import { OUTBOUND_URLS } from '../../../lib/constants.js';
import { linkify } from '../utils/terminal-rendering.js';
import path from 'node:path';
import { getLogFile } from '../../../utils/storage-paths.js';
import { getSessionStartMs } from '../../../lib/observability/index.js';

const RUN_HINTS: readonly KeyHint[] = Object.freeze([
  { key: '←→', label: 'Tabs' },
  { key: 'Ctrl+C', label: 'Cancel' },
]);

/** Format elapsed seconds as "Xm Ys". */
function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

/**
 * Tab-to-ask gate. The new-UX experience is opt-in via env var while the
 * Timeline UX redesign is in progress. Legacy users see exactly the
 * existing RunScreen behavior — Tab still activates ConsoleView's
 * slash-command bar via the handler in `ConsoleView.tsx`.
 *
 * Read on every render so toggling the env var inside an integration
 * test takes effect without a process restart.
 */
function isNewUxEnabled(): boolean {
  return process.env.WIZARD_NEW_UX === '1';
}

/**
 * Wizard-side synthetic ack line. Rendered inline in the timeline as
 * soon as the user submits a Tab-to-ask query. This is what satisfies
 * the 500ms acknowledgement contract — see `lib/agentInterrupt.ts` for
 * the broader synthetic-pause architecture and the PR body for what
 * the real Claude Agent SDK wiring would look like.
 *
 * Exported so the snapshot test can pin the exact copy.
 */
export const ASK_ACK_LINE = '› got it, pausing to look at that';

/**
 * Cap a status string before handing it to TabContainer. Belt-and-braces
 * against unbounded streamed content (e.g. raw stream-event JSON forwarded
 * by runAgentLocally before its filter stripped them). Yoga's
 * `overflow="hidden"` in the bottom status bar handles wide terminals, but
 * a JS cap keeps the bar sane regardless of layout context.
 */
const STATUS_MAX_LEN = 160;
function truncateStatus(s: string): string {
  if (s.length <= STATUS_MAX_LEN) return s;
  return s.slice(0, STATUS_MAX_LEN - 1) + '…';
}

/**
 * Resolve the path of the file the inner agent is currently working on.
 *
 * Source of truth: PreToolUse/PostToolUse hooks populate `store.fileWrites`
 * with structured rows (planned → applied/failed). The most recent row is
 * the file the agent has its hands on right now.
 *
 * The previous implementation regex'd `store.statusMessages` for tokens
 * matching `\S+\.(tsx?|jsx?|py|...)`. That worked when status strings were
 * structured `[STATUS]` markers, but `pushStatus` now also receives raw
 * model text deltas and SDK stream-event protocol fragments — both of
 * which can contain `.js`, `.ts`, etc. Production users were seeing
 * markdown code refs (`` `src/index.js` ``, leading backtick included)
 * and partial JSON like `{"type":"content_block_delta","index":0,...}`
 * surface in the "currently editing" slot. The header lied.
 *
 * Reading from `fileWrites` is the structural fix: PreToolUse only fires
 * for actual Edit/Write/MultiEdit invocations, so prose and protocol
 * frames can't contaminate the value. Returns the relative path when an
 * `installDir` is provided (so wide paths don't blow out the header
 * slot).
 */
function extractCurrentFile(
  fileWrites: readonly { path: string }[],
  installDir?: string,
): string | null {
  if (fileWrites.length === 0) return null;
  const filePath = fileWrites[fileWrites.length - 1].path;
  if (
    installDir &&
    filePath.startsWith(installDir) &&
    (filePath.length === installDir.length ||
      filePath[installDir.length] === '/' ||
      filePath[installDir.length] === '\\')
  ) {
    const rel = path.relative(installDir, filePath);
    return rel === '' ? filePath : rel;
  }
  return filePath;
}

interface RunScreenProps {
  store: WizardStore;
}

/**
 * Resolve the bottom-pill / footer-pill status text shown by the agent's
 * Progress tab.
 *
 * The active resolver lives in `./run-status-pill.ts` and surfaces the
 * most-specific live signal the wizard already has — file writes the
 * agent is currently performing, the recent tool call (Reading X /
 * Running Y), retry / compaction stalls, and event-plan sign-off — in
 * that priority order. The original behavior (canonical task activeForm,
 * then trailing pushStatus) is preserved as the bottom two tiers.
 *
 * This thin wrapper exists for backwards-compatibility: the
 * `resolveRunScreenStatus` symbol is still imported by the existing
 * status-pill tests. New tests should import from
 * `./run-status-pill.ts` directly so they can pin `now`.
 */
export function resolveRunScreenStatus(store: WizardStore): string | undefined {
  return resolveRunStatusPill(store);
}

/** Compact inline display of planned event names. */
/**
 * PR 8 — inline ExtrasPanel rendered above the event plan in
 * ProgressTab. Reflects the live MCP / Slack states from the session
 * plus Session Replay (gated by framework via filterExtrasByFramework).
 *
 * Returns null when the panel would be empty (e.g. native framework
 * with nothing else queued) so it doesn't reserve a blank row.
 */
const RunScreenExtras = ({ store }: { store: WizardStore }) => {
  const session = store.session;
  const items: ExtraItem[] = [
    {
      kind: 'mcp',
      label: 'Amplitude MCP',
      state: session.mcpComplete ? 'done' : 'queued',
    },
    {
      kind: 'slack',
      label: 'Slack',
      state: session.slackComplete ? 'done' : 'queued',
      detail: session.selectedOrgName ?? undefined,
    },
    {
      kind: 'session-replay',
      label: 'Session Replay',
      state: 'queued',
    },
  ];
  const filtered = filterExtrasByFramework(items, session.integration);
  if (filtered.length === 0) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <ExtrasPanel items={filtered} />
    </Box>
  );
};

const InlineEventPlan = ({ store }: { store: WizardStore }) => {
  const events = store.eventPlan.filter((e) => e.name);
  if (events.length === 0) return null;

  // Tight stacking — the bold "Events:" prefix is the visual separator.
  // `wrap="truncate-end"` keeps the row on a single line on narrow
  // terminals (the Events list can run long once the agent fills it
  // in); otherwise it would wrap and visually compete with the panels
  // below it for vertical real estate.
  return (
    <Box flexDirection="column">
      <Text color={Colors.secondary} wrap="truncate-end">
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
  const { discoveredFeatures, selectedOrgId } = store.session;
  const zone = useResolvedZone(store.session);
  const tips: ReactNode[] = [];

  if (discoveredFeatures.includes(DiscoveredFeature.Stripe)) {
    const stripeUrl = OUTBOUND_URLS.stripeDataSource(zone, selectedOrgId);
    tips.push(
      <Text key="stripe" color={Colors.secondary}>
        <Text color={Colors.accent}>{Icons.diamond}</Text> Stripe detected
        {Icons.dash} add as data source:{' '}
        <TerminalLink url={stripeUrl}>{stripeUrl}</TerminalLink>
      </Text>,
    );
  }

  if (tips.length === 0) return null;

  return <Box flexDirection="column">{tips}</Box>;
};

/** The main Progress tab content. */
// The wide-terminal threshold below which we collapse the right column
// entirely — Discovered facts move up to the TOP of the content area on
// narrow terminals so the user still sees the established context
// before the active task list. The animated AmplitudeLogo is decoration
// and now hidden in the Progress tab on every viewport (it survives on
// the Welcome screen); the right column belongs to the Discovered
// facts panel, which is real status information.
const MIN_COLS_FOR_RIGHT_COLUMN = 110;
const MIN_ROWS_FOR_RIGHT_COLUMN = 22;

/**
 * Grace window before the sticky "currently editing X" pill clears
 * itself when the most recent file write is in a terminal state. After
 * this much wall-clock time with no new write activity, the pill goes
 * blank — the agent has plainly moved on, so claiming it's still
 * editing the last file would be a lie.
 *
 * Exported for tests so they can pin the threshold without relying on
 * fake-timer advances longer than necessary.
 */
export const STALE_FILE_WRITE_MS = 10_000;

const ProgressTab = ({ store }: { store: WizardStore }) => {
  const [cols, rows] = useStdoutDimensions();
  const showRightColumn =
    cols >= MIN_COLS_FOR_RIGHT_COLUMN && rows >= MIN_ROWS_FOR_RIGHT_COLUMN;

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

  // Synthetic 6th task for the post-agent dashboard fallback. The agent's
  // 5-task TodoWrite list is locked at five and "Build your starter dashboard"
  // covers the agent-side dashboard work. When the agent didn't actually
  // create the dashboard (skill drift, retry exhaustion, abort), the
  // post-agent `createDashboardStep` runs as a slow fallback and sets
  // `dashboardFallbackPhase` to `in_progress`. Without this row the user
  // sees a "5 / 5 tasks complete" header for the duration of the spinner —
  // the bug we fixed in PR #479.
  //
  // Guard: only render this synthetic task when postAgentSteps has NOT
  // been seeded. Once the FinalizingPanel is active it owns the
  // "Create your starter dashboard" row — showing both is a confusing
  // duplicate.
  if (
    store.session.dashboardFallbackPhase === 'in_progress' &&
    store.session.postAgentSteps.length === 0
  ) {
    progressItems.push({
      label: 'Create your starter dashboard',
      activeForm: 'Creating your starter dashboard...',
      status: 'in_progress',
    });
  }

  const rawFile = extractCurrentFile(
    store.fileWrites,
    store.session.installDir,
  );
  // Sticky "currently editing X" pill — must reflect honest agent activity.
  //
  // Before this fix the pill never cleared: `lastFileRef` only ever
  // received a new value when `rawFile` was truthy, so after the inner
  // agent finished its last write the pill kept showing that file for
  // the duration of the Finalizing phase and beyond. The header lied
  // about what the wizard was doing.
  //
  // We clear the sticky value when either condition holds:
  //   1. The most recent `fileWrites` entry is older than
  //      STALE_FILE_WRITE_MS AND its status is terminal
  //      (`applied` / `failed`) — quiet enough that "currently editing"
  //      is no longer true.
  //   2. `postAgentSteps.length > 0` — the agent has moved past the
  //      file-write phase entirely (commit events, create dashboard,
  //      …). Clear immediately, no grace period needed.
  //
  // Re-evaluation cadence: the `tick` setInterval above re-renders the
  // tab on every SPINNER_INTERVAL, so the stale-time check naturally
  // picks up the clock advancing without us having to mount a second
  // timer. We derive the displayed value directly during render rather
  // than through a useEffect — the latter would only re-fire when its
  // dependencies changed, which during a quiet stretch they don't
  // (rawFile stays null, the latest fileWrites entry's timestamps
  // don't move). Computing inline ties the stale check to the render
  // cadence the spinner already drives.
  const hasPostAgentSteps = store.session.postAgentSteps.length > 0;
  const mostRecentWrite =
    store.fileWrites.length > 0
      ? store.fileWrites[store.fileWrites.length - 1]
      : null;
  const isMostRecentWriteStaleAndTerminal =
    mostRecentWrite !== null &&
    (mostRecentWrite.status === 'applied' ||
      mostRecentWrite.status === 'failed') &&
    Date.now() - (mostRecentWrite.completedAt ?? mostRecentWrite.startedAt) >
      STALE_FILE_WRITE_MS;
  const lastFileRef = useRef<string | null>(null);
  if (hasPostAgentSteps || isMostRecentWriteStaleAndTerminal) {
    // Either the agent has moved past the file-write phase entirely
    // (postAgentSteps seeded) or its last write finished long enough
    // ago that calling it "currently editing" would be a lie. Drop
    // the sticky value — TypewriterFilename renders null on null
    // path, so the slot goes blank.
    lastFileRef.current = null;
  } else if (rawFile) {
    lastFileRef.current = rawFile;
  }
  // NB: the spinner `tick` setInterval already re-renders this
  // component on every SPINNER_INTERVAL, so the `Date.now()` check
  // above re-evaluates on its own cadence — no extra subscription
  // needed here. The `void tick` further down keeps that subscription
  // explicit for the lint rule.
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

  // Coaching tiers for "spinner spins forever". The progress signal must
  // change every time the agent does ANYTHING the user can see — finishing
  // a task, emitting a new status line, or writing a file. Using just the
  // task count was a bug: post-#347 the TodoWrite list is locked at exactly
  // 5 todos, so `total` never changes after the first frame, and the tier-1
  // line ("Still working — switch to Logs") plus the tier-2 line ("This is
  // unusually slow") fired on every run at 90s/5min regardless of activity.
  // Calling a 5-minute wizard run "unusually slow" while the agent is
  // actively shipping status updates undermines trust — the wizard
  // shouldn't lie to the user about what it's doing.
  //
  // The new signal concatenates three monotonically-increasing counters:
  //   - `completedDisplay` — high-water-marked completed task count
  //   - `store.statusMessages.length` — every [STATUS] line from the agent
  //   - `store.fileWritesTotal` — every file write the agent initiates (monotonic;
  //     unlike `fileWrites.length`, it keeps climbing past the FIFO cap)
  // Any one of them ticking forward resets the coaching timer. True silence
  // (no status, no file write, no completion) for 90s now means the agent
  // really is on a long thought, and the coaching copy is honest.
  // Tiers fire at 90s (calm reassurance) and 5min (escalated suggestion).
  // RUN_COACHING_TIER_T1_S=90, RUN_COACHING_TIER_T2_S=300.
  // Include `dashboardFallbackPhase` so the coaching timer resets when the
  // post-agent fallback starts running. Otherwise the agent silence right
  // before the fallback could trip the 90s "unusually slow" tier just as
  // we're entering a known-slow path.
  const progressSignal = `${completedDisplay}|${store.statusMessages.length}|${
    store.fileWritesTotal
  }|${store.session.dashboardFallbackPhase ?? ''}`;
  const { tier: coachingTier } = useTimedCoaching({
    thresholds: [90, 300],
    progressSignal,
  });

  // Cold-start UX: until the agent finishes its first task the counter sits
  // at "0 done · N to go" with the timer climbing — every screenshot the
  // wizard's collected of users Ctrl+C-ing during Setup has been in this
  // exact gap. The agent IS working (its [STATUS] shows up in the bottom
  // status pill), but if the user doesn't know cold-starts are normal a
  // quiet header reads as a hung wizard. After 30s of zero completed tasks
  // surface a tiny inline hint next to the elapsed timer — not a 4-line
  // coaching block. The bottom TabContainer status pill remains the single
  // source of truth for "what is the wizard doing right now"; this header
  // is just "how far along" + "is this normally this slow".
  const showColdStartHint =
    completedDisplay === 0 && total > 0 && elapsed >= 30;
  // Reference `tick` so React doesn't dead-code-eliminate the SPINNER
  // interval that drives DiscoveryFeed + FileWritesPanel.
  void tick;

  // Bottom-pill text — what the wizard is doing right now. This used to
  // live in TabContainer's chrome row; it's now the last row of the
  // Progress tab content area so it sits flush with the active work
  // (semantically status content, not navigation chrome) and so that
  // moving the tab bar to its terminal-bottom anchor doesn't strand the
  // pill. Truncated to STATUS_MAX_LEN so streamed protocol fragments
  // can't blow up the row.
  const rawPillStatus = resolveRunScreenStatus(store);
  const pillStatus = rawPillStatus ? truncateStatus(rawPillStatus) : undefined;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* On narrow terminals (< MIN_COLS_FOR_RIGHT_COLUMN) the Discovered
          facts panel renders at the TOP of the content area rather than
          in a right column — established context first, active work
          below. On wide terminals it lives in the right column instead
          (see below). */}
      {!showRightColumn && (
        <Box flexShrink={0}>
          <DiscoveryFeed
            facts={store.session.discoveryFacts}
            tick={tick}
            cols={cols}
          />
        </Box>
      )}

      {/* Two-column row takes its NATURAL height (no flexGrow=1). The
          surrounding tab content area still grows to fill the viewport
          via its own outer Box, so the tab bar stays pinned to the
          bottom — but the columns themselves only take as much
          vertical space as the task list + DiscoveryFeed actually
          need. That keeps the bottom status pill (rendered below this
          row) flush with content instead of getting pushed to the
          bottom of a stretched column. */}
      <Box flexDirection="row" flexShrink={0}>
        {/* Left: tasks and status (takes all remaining width).
            No paddingX here — the parent screen content area in App.tsx
            already applies `Layout.paddingX`. Stacking an additional
            paddingX=1 on top produced the "content sits one column
            further right than the headers" misalignment users called
            out. */}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {/* Header: progress counter + elapsed + retry chip + current file. */}
        <Box marginBottom={1} flexDirection="column">
          <Box justifyContent="space-between">
            <Box gap={1}>
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
                {showColdStartHint ? ' (cold start: ~30–60s)' : ''}
              </Text>
              {/*
                Tab-to-ask "paused" pill (PR 6). New-UX only. When the user
                taps Tab to open AskBar, `store.paused` flips true and we
                surface a small pill next to the elapsed counter so the
                user can confirm at a glance that the wizard heard them.
                The synthetic-pause stub means the agent itself isn't
                actually parked yet (see `lib/agentInterrupt.ts`), but
                the user-visible contract is the same: tabbed in, we
                noticed.
              */}
              {isNewUxEnabled() && store.paused && (
                <Text color={Colors.accent} bold>
                  {Icons.dot} paused
                </Text>
              )}
              <RetryStatusChip
                retryState={store.session.retryState}
                now={Date.now()}
              />
            </Box>
            {/* Typewriter reveal of the path the agent is currently
                writing — fed by the same FileChangeLedger entry as the
                rest of the screen, so no extra signal source. Adds a
                little texture to the file-write progression and makes
                the "the agent is doing real work" pulse legible at a
                glance. The TypewriterFilename component itself caps
                at one filename, restarts on path change, and clears
                when the path becomes null. */}
            {currentFile && <TypewriterFilename path={currentFile} />}
          </Box>
        </Box>

        {/* Tasks — the hero. The `renderActiveSubsteps` slot injects 2-3
            lines of live tool-call narration ("Reading package.json",
            "Running pnpm add …") under whichever task is currently
            in_progress. Sources: PreToolUse hooks in
            `inner-lifecycle.ts` push verb-formed labels into
            `store.toolActivities` via `recordToolActivity`. Hidden on
            terminals < MIN_WIDTH_FOR_SUBSTEPS cols to save space. */}
        <ProgressList
          items={progressItems}
          title="Tasks"
          // The "0 done · N to go · 55s" header above the task list
          // already shows the same X/Y completion + an elapsed timer +
          // a cold-start hint. The default ProgressList footer
          // ("spinner Progress: 0/4 completed") was just a duplicate of
          // that header without the elapsed information — drop it here
          // so the Progress tab doesn't show the same number twice.
          showFooter={false}
          renderActiveSubsteps={() => (
            <ActiveTaskSubsteps
              activities={store.toolActivities}
              width={cols}
            />
          )}
        />

        {/* Live per-file activity from the inner agent's write hooks.
            Hidden until the first PreToolUse fires so it doesn't reserve
            blank space during planning. The panel shares the spinner
            frame so its in-progress rows tick in lockstep with the
            header braille spinner. */}
        <FileWritesPanel
          entries={store.fileWrites}
          installDir={store.session.installDir}
          spinnerFrame={spinnerFrame}
          // Subtract App.tsx's `Layout.paddingX` (2 each side) so the
          // path-budget reflects the actual visible width inside the
          // content area. Previously this was `cols - 2`, which assumed
          // the now-removed inner paddingX=1 instead of the outer
          // Layout.paddingX=2 — paths got more head-truncation budget
          // than they should have, occasionally letting a long path
          // collide with the trailing detail column on tight terminals.
          width={cols - 4}
        />

        {/* Coaching: surfaces calmly after 90s of no task-count progress.
            The spinner stays — this is a *secondary* line that gives the
            user something to do (open Logs, cancel) instead of staring
            at a frozen indicator. Resets when a new task appears.

            NB: tabs switch with ← / → (or number keys); the Tab key is
            wired to opening the slash-command input in ConsoleView. The
            old copy said "(Tab)" and led users to the wrong key. */}
        {coachingTier >= 1 && (
          <Box>
            <Text color={Colors.muted}>
              <Text color={Colors.accent}>{Icons.diamond} tip</Text>
              {Icons.dash}
              {coachingTier >= 2
                ? " This is unusually slow. Press ← / → to switch to the Logs tab and see what's stuck — or Ctrl+C to cancel."
                : " Still working — press ← / → to switch to the Logs tab and see what's happening, or Ctrl+C to cancel."}
            </Text>
          </Box>
        )}

        {/* Post-agent steps (commit events, create dashboard, …).
            Rendered as its own panel below the agent task list — keeps
            the "main agent work done" milestone intact while still
            surfacing the work happening between agent completion and
            the MCP/Verify screens. Empty until agent-runner seeds the
            queue, so it's a no-op during the agent run itself. */}
        <FinalizingPanel steps={store.session.postAgentSteps} />

        {/* PR 8 — ExtrasPanel surfacing MCP / Slack / Session Replay
            inline so the user sees the work that's still ahead while
            the agent finishes. Gated on WIZARD_NEW_UX so legacy runs
            render byte-identical output. */}
        {process.env.WIZARD_NEW_UX === '1' && (
          <RunScreenExtras store={store} />
        )}

        {/* Inline event plan */}
        <InlineEventPlan store={store} />

        {/* Compact conditional tips */}
        <ConditionalTips store={store} />
        </Box>

        {/* Right column: Discovered facts panel (real status), replacing
            the previous decorative AmplitudeLogo. The animation was
            visually heavy and pushed the actual context (framework,
            package manager, TypeScript, region, project) into a
            secondary slot below the task list — a screenshot from a
            real run flagged that as "not in a very convenient
            location". On wide terminals the right column has plenty of
            room, so we put the established facts there. Narrower
            terminals (< MIN_COLS_FOR_RIGHT_COLUMN) collapse this column
            and show the same panel at the top of the content area
            instead (see the early branch above). */}
        {showRightColumn && (
          <Box flexShrink={0} marginLeft={2}>
            <DiscoveryFeed
              facts={store.session.discoveryFacts}
              tick={tick}
              cols={cols}
            />
          </Box>
        )}
      </Box>

      {/* Bottom status pill — flush against the content above. Used to
          live in TabContainer's chrome row, but the chrome cluster (tab
          bar + KeyHintBar) must stay pinned to the terminal bottom as
          one unit. The pill is content semantics ("what is the wizard
          doing right now"), so it now sits as the last row of this
          tab's content area instead. The single 1-row spacer above
          mirrors the chrome's spacer below, keeping the pill visually
          separated from both the panels and the tab bar. */}
      {pillStatus && (
        <Box flexShrink={0} flexDirection="column" marginTop={1}>
          <Box paddingX={1} overflow="hidden">
            <Text color={Colors.muted}>
              {Icons.diamondOpen} {linkify(pillStatus)}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export const RunScreen = ({ store }: RunScreenProps) => {
  useWizardStore(store);
  useScreenHints(RUN_HINTS);

  // ── Timeline UX fork (PR 4) ──────────────────────────────────────
  // When `WIZARD_NEW_UX=1` we render the new vertical RunTimeline
  // composer instead of the tabbed layout. The legacy path below is
  // untouched so the env-unset behavior is byte-for-byte identical.
  // `[l]` toggles a Logs overlay so users keep an escape hatch onto
  // the live log file without bringing back the full tab strip.
  // Snake / Events tabs are deferred under the new UX path (covered
  // by other PRs in the Timeline series).
  if (process.env.WIZARD_NEW_UX === '1') {
    return <RunScreenTimeline store={store} />;
  }

  // The bottom status pill ("what is the wizard doing right now") used
  // to live in TabContainer's chrome row, but it's content semantics,
  // not navigation — and a previous attempt to "rise" the chrome to
  // meet short content split the chrome into two clusters with the
  // KeyHintBar stranded at the terminal bottom. The pill now renders
  // inside ProgressTab as its last content row instead, so:
  //   - tab bar + KeyHintBar stay pinned together as one chrome unit
  //   - the pill stays flush with the active task list
  // See `resolveRunScreenStatus` and ProgressTab for the resolution
  // and rendering details.

  // Tab-to-ask: when WIZARD_NEW_UX === '1', Tab on RunScreen opens
  // AskBar instead of activating the ConsoleView slash-command bar.
  // The legacy path is unchanged because the Tab handler in
  // ConsoleView.tsx is gated to fire only when `showConsoleChrome` is
  // active and we don't mutate its predicate here. In practice both
  // handlers will see the Tab keystroke under new-UX, but flipping
  // `store.paused` and mounting AskBar is the dominant visible
  // signal — the slash-command bar's `activate('')` is idempotent and
  // benign next to it. The new-UX path is opt-in, and the next PR
  // can teach ConsoleView to bail when `store.paused` is true.
  const newUx = isNewUxEnabled();
  // Trailing ack lines we render inline at the bottom of the screen as
  // synthetic "the wizard heard you" responses. Kept in component
  // state (not the store) because they are pure render hints — losing
  // them on tab switch or wizard restart is fine.
  const [askAcks, setAskAcks] = useState<readonly string[]>([]);
  useScreenInput(
    (_input, key) => {
      if (!newUx) return;
      // Tab opens AskBar. We deliberately ignore Tab when AskBar is
      // already open — TextInput owns the input then, and re-flipping
      // `paused` would no-op anyway.
      if (key.tab && !store.paused) {
        store.setPaused(true);
        agentInterrupt.interrupt();
      }
    },
    { isActive: newUx },
  );

  const handleAskSubmit = (rawQuery: string) => {
    // Trim is defensive — AskBar already trims, but the contract is
    // "non-empty string" and we'd rather drop a stray whitespace
    // submission than render a blank ack.
    const query = rawQuery.trim();
    if (!query) return;
    // Synchronous ack contract: we mutate React state and push the
    // wizard-side response into the timeline in this very render tick.
    // The ack line renders below, in the same pass that the AskBar
    // close happens — no setTimeout, no microtask, no Promise.then.
    // That is what meets the 500ms upper-bound guarantee. See
    // ASK_ACK_LINE and `agentInterrupt.ts` for the broader
    // synthetic-pause story.
    setAskAcks((prev) => [...prev, ASK_ACK_LINE]);
    store.pushAskHistory(query);
    agentInterrupt.inject(query);
    // Close AskBar. `paused` stays true — by design, the user
    // explicitly resumes via Esc (or a future agent reply) so the
    // pause pill stays visible while they read the ack. This is the
    // "AskBar unmounted after submit" branch documented in the AC.
    store.setPaused(false);
  };

  const handleAskCancel = () => {
    // Esc resumes the wizard. We do NOT clear the ack lines — the
    // user already saw the wizard acknowledge previous questions, and
    // those acks belong to the timeline now, not the AskBar lifecycle.
    store.setPaused(false);
    agentInterrupt.resume();
  };

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
            // `fileWritesTotal` is a monotonic counter that climbs every
            // time the agent initiates a file write — see store.ts. Using
            // it as `refreshKey` makes EventPlanViewer re-walk the ledger
            // exactly when new `track()` callsites can land, no more
            // often. The user sees pending → wired transitions in
            // real time without per-frame ledger walks.
            component: (
              <EventPlanViewer
                events={store.eventPlan}
                refreshKey={store.fileWritesTotal}
                approved={store.session.eventPlanApproved}
              />
            ),
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
      // Scope the live tail to the current wizard session by default. The
      // per-project log file is append-only across runs (5 MB rotation),
      // so without this scope users see yesterday's runs above today's
      // startup banner. `a` toggles to show the full historical log.
      component: (
        <LogViewer
          filePath={getLogFile(store.session.installDir)}
          sessionStartMs={getSessionStartMs()}
        />
      ),
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

  // Legacy path: just the TabContainer. Identical to the pre-PR-6
  // shape — no extra wrappers, no extra paint, no behavior change.
  if (!newUx) {
    return (
      <TabContainer
        tabs={tabs}
        requestedTab={store.requestedTab}
        onTabConsumed={() => store.clearRequestedTab()}
      />
    );
  }

  // New-UX path: wrap the TabContainer in a column so AskBar (and the
  // wizard-side synthetic ack lines for already-submitted asks) can
  // pin themselves below the existing chrome. `overflow="hidden"` on
  // the outer Box prevents long ack copy from poking past the visible
  // viewport on narrow terminals — Yoga handles the layout, we just
  // declare the boundary.
  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexGrow={1} flexDirection="column">
        <TabContainer
          tabs={tabs}
          requestedTab={store.requestedTab}
          onTabConsumed={() => store.clearRequestedTab()}
        />
      </Box>
      {askAcks.length > 0 && (
        <Box flexDirection="column" flexShrink={0} paddingX={1}>
          {askAcks.map((line, i) => (
            // The ack lines are append-only and never re-ordered;
            // index keys are stable for this render path.
            <Text key={`ack-${i}`} color={Colors.secondary}>
              {line}
            </Text>
          ))}
        </Box>
      )}
      <AskBar
        open={store.paused}
        history={store.askHistory}
        onSubmit={handleAskSubmit}
        onCancel={handleAskCancel}
      />
    </Box>
  );
};

/**
 * Timeline-UX path for RunScreen, gated on `WIZARD_NEW_UX=1`.
 *
 * Replaces the tab strip with a single vertical `RunTimeline` view and
 * exposes a `[l]` keypress that toggles a logs overlay so the user
 * keeps access to the live log file. Esc / `l` close the overlay.
 *
 * Preview merge note (combined branch): PR 6's Tab-to-ask integration
 * originally lived in the legacy `RunScreen` body. Once PR 4's Timeline
 * fork added an early-return for `WIZARD_NEW_UX=1`, that legacy code
 * became unreachable in new-UX. The Tab-to-ask handler and AskBar are
 * inlined here so the new-UX path keeps the killer feature.
 */
const RunScreenTimeline = ({ store }: RunScreenProps) => {
  const [showLogs, setShowLogs] = useState(false);
  const [, rows] = useStdoutDimensions();
  // Trailing wizard-side ack lines for already-submitted asks. Kept in
  // component state (not the store) because they're pure render hints.
  const [askAcks, setAskAcks] = useState<readonly string[]>([]);

  useScreenInput((input, key) => {
    // Logs overlay toggle takes precedence when the overlay is open.
    if (showLogs && (key.escape || input === 'l' || input === 'L')) {
      setShowLogs(false);
      return;
    }
    // Tab opens AskBar. Skip when AskBar is already mounted — TextInput
    // owns input then and flipping `paused` would no-op.
    if (key.tab && !store.paused && !showLogs) {
      store.setPaused(true);
      agentInterrupt.interrupt();
      return;
    }
    if (!showLogs && (input === 'l' || input === 'L') && !store.paused) {
      setShowLogs(true);
    }
  });

  const handleAskSubmit = (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query) return;
    // Synchronous ack — same render tick. See ASK_ACK_LINE above.
    setAskAcks((prev) => [...prev, ASK_ACK_LINE]);
    store.pushAskHistory(query);
    agentInterrupt.inject(query);
    store.setPaused(false);
  };

  const handleAskCancel = () => {
    // Esc resumes; ack history is preserved (it belongs to the timeline).
    store.setPaused(false);
    agentInterrupt.resume();
  };

  if (showLogs) {
    const logHeight = Math.max(8, Math.min(rows - 6, 20));
    return (
      <Box flexDirection="column" overflow="hidden">
        <Box>
          <Text color={Colors.muted}>logs — press [l] or Esc to close</Text>
        </Box>
        <Box overflow="hidden" height={logHeight}>
          <LogViewer
            filePath={getLogFile(store.session.installDir)}
            sessionStartMs={getSessionStartMs()}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexGrow={1} flexDirection="column">
        <RunTimeline store={store} />
      </Box>
      {/* "paused" pill — surfaces alongside AskBar so the user can
          confirm at a glance the wizard heard them. Mirrors the legacy
          path's header pill (see ProgressTab above). */}
      {store.paused && (
        <Box flexShrink={0} paddingX={1}>
          <Text color={Colors.accent} bold>
            {Icons.dot} paused
          </Text>
        </Box>
      )}
      {askAcks.length > 0 && (
        <Box flexDirection="column" flexShrink={0} paddingX={1}>
          {askAcks.map((line, i) => (
            <Text key={`ack-${i}`} color={Colors.secondary}>
              {line}
            </Text>
          ))}
        </Box>
      )}
      <AskBar
        open={store.paused}
        history={store.askHistory}
        onSubmit={handleAskSubmit}
        onCancel={handleAskCancel}
      />
    </Box>
  );
};
