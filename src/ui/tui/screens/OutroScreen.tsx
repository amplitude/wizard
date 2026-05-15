/**
 * OutroScreen — Summary after the agent run.
 *
 * Reads store.session.outroData to render success, error, or cancel view.
 * Keeps the process alive until the user presses a key to exit.
 *
 * Success: bold green heading, compact changes + events list, PickerMenu.
 * Error: red heading with error message and suggested fixes.
 * Cancel: clean warning-colored cancel message.
 */

import { Box, Text } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import * as fs from 'fs';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { OutroKind } from '../session-constants.js';
import { Colors, Icons } from '../styles.js';
import { GradientText } from '../components/GradientText.js';
import {
  ChangedFilesView,
  PickerMenu,
  ReportViewer,
  TerminalLink,
} from '../primitives/index.js';
import { buildChangedFileList } from '../primitives/ChangedFilesView.js';
import { DiffViewer } from '../components/DiffViewer.js';
import { summarizeLedgerDiffs } from '../../../lib/file-change-diff.js';
import { peekSetupComplete } from '../../../lib/setup-complete-registry.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import {
  DEFAULT_AMPLITUDE_ZONE,
  OUTBOUND_URLS,
} from '../../../lib/constants.js';
import { ExitCode } from '../../../lib/exit-codes.js';
import { resolveZone } from '../../../lib/zone-resolution.js';
import opn from 'opn';
import path from 'path';
import { analytics } from '../../../utils/analytics.js';
import {
  isWizardAbortInProgress,
  wizardSuccessExit,
} from '../../../utils/wizard-abort.js';
import { getLogFilePath } from '../../../lib/observability/index.js';
import { writeBugReport } from '../../../lib/bug-report.js';
import { HotkeyPills, type HotkeyPill } from '../components/HotkeyPills.js';
import { buildLastActivityFooter } from './outro-last-activity.js';
import { toWizardDashboardOpenUrl } from '../../../utils/dashboard-open-url.js';
import {
  getDashboardFile,
  pickFreshestExisting,
} from '../../../utils/storage-paths.js';
import { readDraftEventPlanMeta } from '../../../lib/wizard-tools.js';
import { retryFromCheckpoint } from '../../../lib/retry-from-checkpoint.js';
import { isInteractiveOutro } from '../utils/outro-mode.js';
import {
  executeRollbackWithStatus,
  getFileChangeLedger,
} from '../../../lib/file-change-ledger.js';
import {
  classifyPlanAgainstWiredCode,
  collectWiredEventNames,
} from '../../../lib/wired-event-instrumentation.js';

const REPORT_FILE = 'amplitude-setup-report.md';

/**
 * Map an outro kind to the process exit code emitted by the
 * screen-initiated dismissal path (the `setOutroData(...) → key →
 * wizardSuccessExit` flow used when the user cancels from
 * IntroScreen / SetupScreen / DataIngestionCheckScreen /
 * ActivationOptionsScreen).
 *
 * Why a pure helper: this mapping is easy to ship the wrong way (PR
 * #379 hardcoded `0` for the entire path, silently flipping every
 * user-cancelled run to "success" in CI), so we extract it to a
 * named function with a unit test guarding the invariant.
 *
 * - Cancel  → 130 (POSIX SIGINT convention; matches what
 *                  graceful-exit also emits on Ctrl+C).
 * - Error   → 10  (AGENT_FAILED — generic failure that didn't go
 *                  through wizardAbort, so we don't have a more
 *                  specific code).
 * - Success → 0   (unreachable in practice — success outros are
 *                  dismissed via the picker, not this any-key path —
 *                  but mapped for symmetry / defense in depth).
 */
export function exitCodeForOutroKind(kind: OutroKind | undefined): number {
  if (kind === OutroKind.Cancel) return ExitCode.USER_CANCELLED;
  if (kind === OutroKind.Error) return ExitCode.AGENT_FAILED;
  return ExitCode.SUCCESS;
}

/**
 * Format the cancel-outro file-state line from a snapshot of the
 * ledger's `{ size, rolledBack }` state captured at mount. Pulled out
 * as a pure helper so the branching (no entries / pending revert /
 * already reverted) is unit-testable without rendering Ink.
 *
 * The wording branches on `rolledBack` because the timing of cleanup
 * differs between the `wizardAbort` (Ctrl+C, cleanup runs before mount)
 * and screen-initiated (`/exit`, IntroScreen back-out, etc. — cleanup
 * runs AFTER any-key) cancel paths. Bugbot caught the past-tense lie
 * for the latter path on PR #741.
 */
export function renderCancelFileStateLine(state: {
  size: number;
  rolledBack: boolean;
}): string {
  if (state.size === 0) return 'No files were changed.';
  const noun = state.size === 1 ? 'file' : 'files';
  if (state.rolledBack) {
    return `Reverted ${state.size} ${noun} the wizard had started writing.`;
  }
  return `${state.size} ${noun} will be reverted before exit.`;
}

interface OutroScreenProps {
  store: WizardStore;
}

export const OutroScreen = ({ store }: OutroScreenProps) => {
  useWizardStore(store);

  // Defensive: if the slash console was active when the wizard transitioned
  // to the outro (e.g. user typed `/feedback`, then an MCP call errored
  // before the input deactivated), `commandMode` stays true and
  // `useScreenInput` remains gated off — meaning every keypress on the
  // outro is silently swallowed by the dormant text input and "Press any
  // key to exit" appears broken. Force-deactivate on mount so the outro
  // always owns input. Safe to clobber: the run is over, so any in-flight
  // slash-prompt input is meaningless past this point.
  useEffect(() => {
    store.setCommandMode(false);
  }, [store]);

  // Memoize the diff summary so we don't re-run `structuredPatch` on every
  // render frame (Bugbot: outro is mounted post-run, ledger is frozen, so a
  // single computation per mount is correct). The ledger reference itself is
  // stable for the lifetime of the wizard run.
  //
  // `includePatch: false` skips the redundant `createPatch` call per entry —
  // we only render DiffViewer in summary mode here (no `filePath` prop), and
  // summary mode reads `additions`/`deletions`/`operation` only, never the
  // unified-patch text. Computing the patch for every file (up to the ledger
  // FIFO cap) doubled the diff work and could cause a visible hang on outro
  // mount after a large run.
  const meaningfulDiffs = useMemo(() => {
    const diffs = summarizeLedgerDiffs(getFileChangeLedger(), {
      includePatch: false,
    });
    return diffs.filter(
      (d) => d.additions > 0 || d.deletions > 0 || d.operation !== 'modify',
    );
  }, []);

  const [showReport, setShowReport] = useState(false);
  const [showChangedFiles, setShowChangedFiles] = useState(false);
  // Once R fires off `retryFromCheckpoint`, every subsequent keystroke
  // would otherwise drop into the dismissal path and call `process.exit`
  // while the spawned retry child is still running — directly violating
  // the "do NOT call `process.exit` while the child is still running"
  // invariant in retry-from-checkpoint.ts. Guard the input handler with
  // a ref so the second R is also a no-op (no duplicate child).
  const [retryInProgress, setRetryInProgress] = useState(false);
  const [bugReportPathState, setBugReportPathState] = useState<string | null>(
    null,
  );
  // Tracks the user's resolution of the `[K] Keep / [R] Revert` prompt
  // shown on `preserveFiles` error outros (currently AUTH_ERROR only).
  // null     → still showing the prompt; default = keep on dismissal.
  // 'kept'   → user pressed K; files stay on disk.
  // 'reverted' → user pressed R; the ledger has already been rolled back.
  // Once set, the prompt copy collapses to a confirmation line so a
  // subsequent any-key dismissal doesn't re-fire the action.
  const [preserveResolution, setPreserveResolution] = useState<
    'kept' | 'reverted' | null
  >(null);
  // Captured count from the rollback so the confirmation copy can show
  // exactly how many files were reverted. Set only on the R path.
  const [revertCount, setRevertCount] = useState<{
    filesReverted: number;
    filesRemoved: number;
  } | null>(null);
  // Disk-state about the setup report — captured ONCE on mount so we
  // don't sync-stat the filesystem on every re-render (the picker
  // re-renders on each keypress, and Ink's reconciler can re-render on
  // unrelated store events too). The report file is written by the
  // agent before this screen mounts, so a one-shot read is sufficient.
  const [reportExists, setReportExists] = useState(false);

  // Cancel-outro file-state snapshot — addresses TUI Auditor T4 (the
  // cancel branch never confirmed what was preserved). Captured ONCE on
  // mount so the count reflects the ledger as of the moment we render,
  // not the moment a stray re-render happens.
  //
  // We capture BOTH the entry count and whether rollback has already
  // run. Two cancel paths reach this screen and they differ in timing:
  //
  //   1. `wizardAbort` (Ctrl+C) — agent-runner's cleanup hook calls
  //      `ledger.rollback()` synchronously BEFORE the outro mounts. So
  //      `hasRolledBack` is true and the past-tense "Reverted N files"
  //      message is honest.
  //   2. `/exit` / IntroScreen back-out / SetupScreen back-out — these
  //      call `setOutroData` directly without going through
  //      `wizardAbort`. The outro mounts BEFORE any cleanup hook fires
  //      (those fire later, when `wizardSuccessExit` iterates the hook
  //      registry after the user presses a key). So `hasRolledBack` is
  //      false and we must promise future-tense ("will be reverted
  //      before exit") instead of lying past-tense. Bugbot caught the
  //      lie on PR #741.
  //
  // Meanings of `cancelLedgerState`:
  //   null  → ledger absent (pre-agent cancel, or test fixture with no
  //           ledger init). We omit the file-state line entirely rather
  //           than asserting "0 files" with uncertainty.
  //   { size: 0, … }        → no writes tracked. Render
  //                            "No files were changed."
  //   { size: N, rolledBack: true }  → rollback already ran → past tense.
  //   { size: N, rolledBack: false } → rollback pending → future tense.
  const [cancelLedgerState] = useState<{
    size: number;
    rolledBack: boolean;
  } | null>(() => {
    const ledger = getFileChangeLedger();
    if (!ledger) return null;
    return { size: ledger.size(), rolledBack: ledger.hasRolledBack() };
  });

  // `isSuccess` / `isError` drive input handling and the action picker.
  // We compute them off the raw session.outroData (so error/cancel paths
  // are unaffected) and the activationLevel === 'full' synthetic-success
  // case (so re-runs of healthy projects render the success picker
  // instead of "Press any key to exit").
  const isFullActivationSuccess =
    store.session.activationLevel === 'full' && !store.session.outroData;
  const isSuccess =
    store.session.outroData?.kind === OutroKind.Success ||
    isFullActivationSuccess;
  const isError = store.session.outroData?.kind === OutroKind.Error;
  const isCancel = store.session.outroData?.kind === OutroKind.Cancel;
  // Auth failures must NOT advertise retry — re-running with the same
  // (still-bad) credentials will fail the same way. agent-runner sets
  // `promptLogin: true` on the OutroData when it routes through
  // AUTH_ERROR; honor that as a single-flag opt-out.
  const isAuthFailure =
    isError && store.session.outroData?.promptLogin === true;
  const canRetry = (isError || isCancel) && !isAuthFailure;
  const showRetryHint = canRetry && isInteractiveOutro();
  // `preserveFiles` is set by agent-runner.ts on failure classes where
  // the agent's writes are demonstrably consistent (currently AUTH_ERROR
  // only). Skips the automatic ledger rollback and lets the user choose
  // `[K] Keep` (default) / `[R] Revert` here.
  const preserveFiles =
    isError && store.session.outroData?.preserveFiles === true;
  const showPreservePrompt =
    preserveFiles && preserveResolution === null && isInteractiveOutro();

  // Any-key-to-exit for non-success states; success uses the picker.
  // Exceptions on error: 'l'/'L' opens the log in the OS-default handler,
  // 'c'/'C' writes a sanitized bug report to disk. Both keep the process
  // alive so the user can review the outro after the action completes.
  useScreenInput((input, key) => {
    // The retry child has been spawned; swallow all further keystrokes
    // until it exits (it will drive the exit itself).
    if (retryInProgress) return;
    if (!isSuccess) {
      if (isError && (input === 'l' || input === 'L')) {
        analytics.wizardCapture('error outro log opened', {});
        opn(getLogFilePath(), { wait: false }).catch(() => {
          /* opn fails on some headless terminals — non-fatal */
        });
        return;
      }
      if (isError && (input === 'c' || input === 'C')) {
        const written = writeBugReport({
          errorMessage: store.session.outroData?.message ?? null,
          integration: store.session.integration,
        });
        analytics.wizardCapture('error outro bug report written', {
          success: written !== null,
        });
        setBugReportPathState(written);
        return;
      }
      // Preserve-files prompt — `[K] Keep` / `[R] Revert`. Only active
      // while the prompt is unresolved. K is the safe default and is
      // also what every non-K-non-R keypress (Enter, Space, etc.) maps
      // to via the dismissal handler below — pressing K explicitly is a
      // shortcut for that same outcome plus an analytics event so we
      // can see how often users override the default.
      //
      // Track explicit resolution so the implicit-keep branch below
      // doesn't double-fire `'preserve files resolution'` after the K
      // shortcut falls through — `setPreserveResolution('kept')` doesn't
      // update `showPreservePrompt` until the next render, so checking
      // the prompt flag alone is not enough within this same handler
      // invocation.
      let preservePromptResolvedThisTick = false;
      if (showPreservePrompt && (input === 'k' || input === 'K')) {
        analytics.wizardCapture('preserve files resolution', {
          resolution: 'kept',
          source: 'keystroke',
        });
        setPreserveResolution('kept');
        preservePromptResolvedThisTick = true;
        // Fall through to the dismissal block below — keeping files is
        // the no-op default, so we don't need to do anything else
        // before exiting.
      }
      if (showPreservePrompt && (input === 'r' || input === 'R')) {
        // Run the same revert path the cleanup hook would have taken
        // automatically — just gated on the user's explicit choice.
        // `executeRollbackWithStatus` is idempotent, so even if the
        // cleanup fired despite `preserveFiles` (e.g. a future ordering
        // bug), this is a no-op rather than a double revert.
        let outcome: { filesReverted: number; filesRemoved: number } | null =
          null;
        try {
          const result = executeRollbackWithStatus((msg: string) =>
            store.pushStatus(msg),
          );
          if (result.executed) {
            outcome = {
              filesReverted: result.filesReverted,
              filesRemoved: result.filesRemoved,
            };
          }
        } catch {
          /* ledger errors are surfaced to the log by
             executeRollbackWithStatus — keep the screen alive. */
        }
        analytics.wizardCapture('preserve files resolution', {
          resolution: 'reverted',
          source: 'keystroke',
          'files reverted': outcome?.filesReverted ?? 0,
          'files removed': outcome?.filesRemoved ?? 0,
        });
        setRevertCount(outcome);
        setPreserveResolution('reverted');
        // Stay on screen so the user can read the confirmation copy.
        // Any subsequent keystroke flows through the dismissal handler
        // below; `preserveResolution !== null` keeps the K/R branch
        // inert on re-entry so we don't double-revert.
        return;
      }
      // Press R to retry from checkpoint. Available on Error AND Cancel
      // outros (the cancel path benefits too — user hit Esc, regretted it,
      // wants back in). Disabled for auth failures: those will fail again
      // with the same stored creds, so advertising retry there would be a
      // misleading dead-end. The retry helper itself spawns a child wizard
      // that picks up the existing checkpoint and waits for it to exit.
      if (canRetry && (input === 'r' || input === 'R')) {
        // Fire-and-forget — `retryFromCheckpoint` resolves only after the
        // child exits, at which point it calls process.exit itself.
        // Lock further keystrokes so a second R doesn't spawn a duplicate
        // child and unrelated keys don't race into `process.exit` while
        // the child is still running.
        setRetryInProgress(true);
        void retryFromCheckpoint(store);
        return;
      }
      // If the prompt was visible and the user dismissed without
      // explicitly picking K/R, record the implicit-keep so we can
      // distinguish "user actively chose to keep" from "user dismissed
      // and we defaulted to keep" in analytics.
      if (showPreservePrompt && !preservePromptResolvedThisTick) {
        analytics.wizardCapture('preserve files resolution', {
          resolution: 'kept',
          source: 'default',
        });
        setPreserveResolution('kept');
      }
      // Signal dismissal first. When we got here via wizardAbort, that
      // caller is awaiting this signal — once it resolves, abort runs
      // its own analytics flush and `process.exit` with the real exit
      // code (NETWORK / AGENT_FAILED / etc.). Don't double-exit in that
      // case: a bare exit here would (1) force a hardcoded exitCode on
      // every error, hiding real failures from CI; (2) skip the
      // analytics shutdown wizardAbort runs after cancel.
      store.signalOutroDismissed();
      // BUT — several screens (DataIngestionCheckScreen `x`, IntroScreen
      // resume-cancel, SetupScreen back-out, ActivationOptionsScreen
      // 'exit') navigate to the cancel/error outro via `setOutroData`
      // without going through wizardAbort. In that path nobody is
      // awaiting outroDismissed, so the dismissal signal resolves a
      // promise no one is listening to and the process hangs forever
      // — only Ctrl+C escapes. Detect "no abort in flight" and drive
      // the exit ourselves so any-key really does exit, BUT honor the
      // outro kind in the exit code: Cancel → 130, Error → 10. The
      // earlier version (#379) hardcoded `0` on this path, so every
      // user-cancelled run looked successful to CI/orchestrators.
      // ExitCode.SUCCESS for the Success path is unreachable here —
      // success outros use the picker (below), not this dismissal
      // handler — but we map it explicitly for symmetry.
      if (!isWizardAbortInProgress()) {
        void wizardSuccessExit(
          exitCodeForOutroKind(store.session.outroData?.kind),
        );
      }
      return;
    }
    if (showReport && key.escape) setShowReport(false);
    // `O` while the report sub-view is up opens the dashboard URL in
    // the OS-default browser. Mirrors the picker's "Open Amplitude"
    // option so users don't have to leave the report to take the
    // forward action — the report itself is read-only chrome.
    if (showReport && (input === 'o' || input === 'O')) {
      // ReportViewer's own input handler eats arrow keys for scrolling
      // but does not claim O — safe to consume here. resolveZone
      // tier 1 (in-session credentials) is authoritative this late in
      // the flow; readDisk: false avoids re-walking the project root.
      const zone = resolveZone(store.session, DEFAULT_AMPLITUDE_ZONE, {
        readDisk: false,
      });
      const url = dashboardOpenUrl ?? OUTBOUND_URLS.overview[zone];
      analytics.wizardCapture('outro action', {
        action: 'dashboard',
        'outro kind': store.session.outroData?.kind,
        source: 'report-cta',
      });
      opn(url, { wait: false }).catch(() => {
        /* fire-and-forget — opn failures are non-fatal */
      });
      return;
    }
    // `D` while the success picker is showing pops the changed-files
    // view as a parallel review surface to the setup report. Cheap
    // shortcut so users can audit what was touched without leaving the
    // picker. ChangedFilesView owns Esc/scroll once it's mounted.
    if (
      isSuccess &&
      !showReport &&
      !showChangedFiles &&
      (input === 'd' || input === 'D')
    ) {
      const peeked = peekSetupComplete();
      const written = peeked?.files?.written ?? [];
      const modified = peeked?.files?.modified ?? [];
      // De-dupe via the same builder the picker path uses. Without this
      // a path that lands in both `written` and `modified` (the registry
      // allows that — see registerSetupComplete) would inflate the
      // keystroke-path count vs. the picker's deduped `changedFiles.length`,
      // making the 'file count' property unreliable for cross-source
      // comparison in analytics. Bugbot caught this on PR #412.
      const fileCount = buildChangedFileList(written, modified).length;
      if (fileCount > 0) {
        analytics.wizardCapture('view changes opened', {
          'file count': fileCount,
          source: 'keystroke',
        });
        setShowChangedFiles(true);
      }
    }
  });

  const rawOutroData = store.session.outroData;
  const visibleEvents = store.eventPlan.filter((e) => e.name.trim().length > 0);

  // ── Wired-code classification ──────────────────────────────────────
  //
  // The persisted plan (`store.eventPlan`) is the user-approved list of
  // events the wizard SAID it would set up. The actual on-disk truth
  // lives in the file-change ledger — every Write / Edit / MultiEdit
  // the agent ran is captured there with its `afterContent`. We grep
  // those snapshots for `track("...")` callsites and split the plan
  // into two buckets:
  //
  //   - **Instrumented**: plan event whose name (case-insensitive)
  //     appears in some `track()` callsite. The celebration shows the
  //     wired-code casing, not the plan's normalized Title Case.
  //   - **Covered by autocapture**: plan event NOT found in any wired
  //     file. Web SDKs autocapture sessions / page views / form
  //     interactions / clicks, so the agent intentionally skips
  //     `track()` for these.
  //
  // Without this split the outro confidently lists every plan event as
  // "instrumented in the Wizard API" — even when the agent actually
  // routed half of them through autocapture. The Setup Report has
  // always distinguished these; this brings the outro into line.
  //
  // Memoize on `visibleEvents` identity — the ledger is per-run and
  // frozen post-agent, so once the agent finishes the classification is
  // stable. Without `useMemo`, this IIFE re-walked the ledger and
  // re-ran `TRACK_CALL_RE` against every wired file on every render
  // (and every keypress in the outro picker drives a render). When the
  // ledger isn't initialized (e.g. tests, the synthetic full-activation
  // success path where the agent never ran), we fall back to
  // "everything instrumented" so legacy behavior holds.
  const wiredClassification = useMemo(() => {
    const ledger = getFileChangeLedger();
    if (!ledger) {
      return {
        instrumented: visibleEvents.map((e) => ({
          name: e.name,
          description: e.description,
        })),
        autocaptured: [],
      };
    }
    const wiredNames = collectWiredEventNames(ledger.getEntries());
    return classifyPlanAgainstWiredCode(visibleEvents, wiredNames);
  }, [visibleEvents]);
  const instrumentedEvents = wiredClassification.instrumented;
  const autocapturedEvents = wiredClassification.autocaptured;

  // For activationLevel === 'full' users, the agent run is skipped — so
  // `outro()` on InkUI never fires and `outroData` stays null when the
  // router lands them here. Without this defaulting, those users would
  // see the "Finishing up…" placeholder forever (a mute dead-end at the
  // tail of an otherwise healthy re-run). Treat "reached Outro with full
  // activation and no error" as Success so the success view renders.
  const isFullActivation = store.session.activationLevel === 'full';
  const outroData =
    rawOutroData ??
    (isFullActivation
      ? { kind: OutroKind.Success, changes: [] as string[] }
      : null);

  // Disk-resident dashboard URL for full-activation re-runs. The agent
  // never runs, so the in-process watcher in agent-interface.ts that
  // populates `checklistDashboardUrl` is bypassed. Read directly from
  // `.amplitude/dashboard.json` (or the legacy `.amplitude-dashboard.json`)
  // so the user still sees a clickable link to the dashboard the agent
  // created on a prior run. One-shot read on mount — see comment on
  // `reportExists` below for the same pattern.
  const installDir = store.session.installDir;
  const [diskDashboardUrl, setDiskDashboardUrl] = useState<string | null>(null);
  useEffect(() => {
    if (store.session.checklistDashboardUrl) return;
    const url = readDashboardUrlFromDisk(installDir);
    if (url) setDiskDashboardUrl(url);
  }, [installDir, store.session.checklistDashboardUrl]);

  // When the run ends with unresolved confirm_event_plan feedback the
  // outro safety net in agent-runner.ts persists a DRAFT events.json
  // (wrapper shape with `draft: true` and the user's last feedback).
  // Surface that here so the user understands why the listed events
  // aren't fully instrumented and what to do about it. One-shot read on
  // mount — same pattern as `reportExists` and the dashboard URL above.
  const [draftMeta, setDraftMeta] = useState<{ lastFeedback: string } | null>(
    null,
  );
  useEffect(() => {
    try {
      setDraftMeta(readDraftEventPlanMeta(installDir));
    } catch {
      // Non-fatal — the draft hint is purely additive.
      setDraftMeta(null);
    }
  }, [installDir]);

  /**
   * Resolve the canonical dashboard URL: in-session value (set by
   * agent-interface's watcher during a fresh run) wins, then the
   * disk-resident value (full-activation re-runs where the agent skips).
   */
  const dashboardCanonicalUrl =
    store.session.checklistDashboardUrl ?? diskDashboardUrl;
  /**
   * Provisioning magic link wins over the checklist's wizard-gated open
   * URL because it ALREADY authenticates the user end-to-end (JS
   * #108967), skipping the sign-in / refresh-token bounce
   * `toWizardDashboardOpenUrl` would otherwise add. Falls through to the
   * gated URL when no magic link is on the session, which covers the
   * non-signup happy path and full-activation re-runs alike.
   */
  const signupMagicLinkUrl = store.session.signupMagicLinkUrl;
  const dashboardOpenUrl = signupMagicLinkUrl
    ? signupMagicLinkUrl
    : dashboardCanonicalUrl
    ? toWizardDashboardOpenUrl(dashboardCanonicalUrl)
    : null;

  if (!outroData) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text color={Colors.muted}>Finishing up{Icons.ellipsis}</Text>
      </Box>
    );
  }

  // Build the report file path from the install directory. `installDir`
  // is already declared above for the dashboard-URL effect; reuse it
  // rather than redeclaring.
  const reportPath = installDir.endsWith(path.sep)
    ? `${installDir}${REPORT_FILE}`
    : `${installDir}${path.sep}${REPORT_FILE}`;

  // One-shot existence check — see `reportExists` declaration above for
  // why this isn't done inline in render. Re-runs only when the install
  // dir or report path changes, which is effectively never within a
  // single mount of this screen.
  useEffect(() => {
    try {
      setReportExists(fs.existsSync(reportPath));
    } catch {
      // Treat unreadable filesystem as "no report" rather than throwing
      // — the worst outcome is hiding the picker option, never a crash.
      setReportExists(false);
    }
  }, [reportPath]);

  // ── Changed files (peeked, not consumed) ─────────────────────────────
  // We peek the registry rather than consume so the downstream
  // wizardSuccessExit emission of `setup_complete` still gets the full
  // payload. The peek returns a live reference — treated read-only here.
  const setupCompleteSnapshot = peekSetupComplete();
  const changedFiles = buildChangedFileList(
    setupCompleteSnapshot?.files?.written ?? [],
    setupCompleteSnapshot?.files?.modified ?? [],
  );

  // ── Changed-files sub-view ───────────────────────────────────────────

  if (showChangedFiles && isSuccess) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <ChangedFilesView
          files={changedFiles}
          cwd={installDir}
          onClose={() => setShowChangedFiles(false)}
        />
      </Box>
    );
  }

  // ── Report sub-view ──────────────────────────────────────────────────

  if (showReport) {
    return (
      // `overflow="hidden"` is critical: ReportViewer's content height is
      // a sibling-aware estimate (`siblingRows` deducted from the content
      // area). If marked-terminal renders a markdown table whose row
      // count exceeds that estimate (long-running setup with 20+ events,
      // or a viewport shorter than the estimate accounted for), the
      // overflow must clip rather than overdraw the `[O] Open in browser
      // · [Esc] Back` strip that sits directly below it. This matches
      // App.tsx's content-area Box which already sets `overflow="hidden"`
      // — duplicated here so the showReport sub-tree is robust on its
      // own.
      <Box
        flexDirection="column"
        flexGrow={1}
        paddingX={2}
        paddingY={1}
        overflow="hidden"
      >
        {/* Header: bold accent title + small dim subtitle. The previous
            "(Esc to go back)" inline next to the title visually competed
            with the title itself — pulled down to the dedicated key-hint
            line below the report so the eye lands on the CTA first. */}
        <Box marginBottom={1} flexDirection="column">
          <Text bold color={Colors.accent}>
            {Icons.diamond} Setup Report
          </Text>
          <Text color={Colors.muted}>
            What the wizard added to your project
          </Text>
        </Box>
        {/* Tell the viewer how many rows of sibling chrome it has to
            share the content area with so the scroll area doesn't push
            the CTA / key-hint footer off the bottom of the viewport.
            Breakdown:
              - paddingY={1} on this Box: 2 rows
              - Header column (title + subtitle + marginBottom=1): 3 rows
              - CTA box (marginTop=1 + 1 line): 2 rows when shown
              - Key-hints box (marginTop adjusts; +1 line content): 1-2 rows
            Without this, ReportViewer used a fixed `rows - 10` which
            pre-dated the new sibling content this PR adds and would
            clip the CTA off-screen on shorter terminals. */}
        <ReportViewer
          filePath={reportPath}
          siblingRows={dashboardOpenUrl ? 8 : 7}
        />
        {/* Primary next-action — the report is read-only chrome; the
            forward path is "open Amplitude". Surface it as the loudest
            line on the screen so users don't bounce out of the terminal
            wondering what to do after they finish reading. */}
        {dashboardOpenUrl && (
          <Box marginTop={1} flexDirection="column">
            <Text>
              <Text color={Colors.accent} bold>
                {Icons.arrowRight} Open Amplitude:
              </Text>{' '}
              <TerminalLink url={dashboardOpenUrl}>
                {dashboardOpenUrl}
              </TerminalLink>
            </Text>
          </Box>
        )}
        <Box marginTop={dashboardOpenUrl ? 0 : 1}>
          <Text color={Colors.muted}>
            <Text bold color={Colors.accent}>
              [O]
            </Text>{' '}
            Open in browser ·{' '}
            <Text bold color={Colors.accent}>
              [Esc]
            </Text>{' '}
            Back
          </Text>
        </Box>
      </Box>
    );
  }

  // ── Main outro views ─────────────────────────────────────────────────

  return (
    // `overflow="hidden"` defends against content overflowing the parent's
    // computed content area on real terminals. Without it, a tall success
    // body (changes + events + dashboard CTA + diff summary + report
    // hint + D-key hint) could push the PickerMenu off the bottom and
    // visually overlap the ConsoleView chrome below — the family of
    // overdraw bugs in the PR description (e.g. "[3] Exit setup
    // reportmplitude.com)" where picker rows mash into other content).
    <Box
      flexDirection="column"
      flexGrow={1}
      paddingX={2}
      paddingY={1}
      overflow="hidden"
    >
      {/* ── Success ───────────────────────────────────────────────────── */}
      {outroData.kind === OutroKind.Success && (
        <Box flexDirection="column">
          {/* Heading copy splits on the activation level. Fresh-install
              success deserves the "live!" celebration. Full-activation
              re-runs (returning user, project already healthy) get a
              calmer "your project is healthy" line — the wizard didn't
              just set anything up, so the celebratory tone would feel
              false. Both paths share every other element below.

              Wordmark gradient (PR A2 #1): success outros render the
              heading text with the Amplitude brand violet → blueOnDark
              gradient — the same brand pairing the IntroScreen logo
              uses — so the wizard's terminal celebration matches the
              tone of the rest of the product. The emoji / checkmark
              prefix stays in a plain <Text> so font rendering of the
              glyph is unaffected by the per-character color stripe.
              Error and Cancel outros below keep the minimal monochrome
              treatment — the gradient is reserved for success states. */}
          <Box flexDirection="row" gap={1}>
            <Text color={Colors.success} bold>
              {isFullActivationSuccess ? Icons.checkmark : '🎉'}
            </Text>
            <GradientText>
              {isFullActivationSuccess
                ? 'Your Amplitude project is healthy'
                : 'Amplitude is live!'}
            </GradientText>
          </Box>
          {isFullActivationSuccess && (
            <Text color={Colors.body}>
              {store.session.selectedProjectName
                ? `${store.session.selectedProjectName} is already ingesting events.`
                : 'This project is already ingesting events.'}
            </Text>
          )}
          {!isFullActivationSuccess && visibleEvents.length > 0 && (
            <Text color={Colors.body}>
              {instrumentedEvents.length} event
              {instrumentedEvents.length !== 1 ? 's' : ''} instrumented
              {autocapturedEvents.length > 0
                ? ` · ${autocapturedEvents.length} covered by autocapture`
                : ''}
              {store.session.selectedEnvName
                ? ` in ${store.session.selectedEnvName}`
                : ''}
              .
            </Text>
          )}

          {/* Changes summary. Each bullet is a single <Text> with
              `wrap="truncate-end"` so a long change description can
              never wrap to a 2nd line and visually merge with the next
              bullet (e.g. "tracking plang Yarn V1" — bullet 1 wrapping
              into bullet 2 on a real terminal). */}
          {outroData.changes && outroData.changes.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {outroData.changes.map((change, i) => (
                <Text key={i} color={Colors.body} wrap="truncate-end">
                  {Icons.bullet} {change}
                </Text>
              ))}
            </Box>
          )}

          {/* Events added — split into two sections so the celebration
              tells the truth:
                - Instrumented: plan events whose `track()` call landed
                  in the wired code (names show with their wired-code
                  spelling, not the plan's normalized Title Case).
                - Covered by autocapture: plan events where the agent
                  intentionally did NOT write a track() call because the
                  SDK's autocapture surfaces them automatically.
              The Setup Report has always made this distinction; this
              block brings the outro into line so all three sources
              (diff, report, outro) agree. */}
          {visibleEvents.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {/* Draft notice — only when events.json is the wrapper-shaped
                  draft persisted by the outro safety net (i.e. the user
                  gave feedback during confirm_event_plan and the agent
                  never circled back). Tells them the events below are
                  the LAST proposal, not what's in the code, so re-running
                  is the right next step. */}
              {draftMeta && (
                <Box flexDirection="column" marginBottom={1}>
                  <Text color={Colors.warning}>
                    {Icons.bullet} Feedback was given but the plan was never
                    finalized — re-run the wizard to continue iterating.
                  </Text>
                  {draftMeta.lastFeedback && (
                    <Text color={Colors.muted}>
                      Your feedback: {draftMeta.lastFeedback}
                    </Text>
                  )}
                </Box>
              )}
              {instrumentedEvents.length > 0 && (
                <Box flexDirection="column">
                  <Text color={Colors.secondary} bold>
                    Instrumented ({instrumentedEvents.length} event
                    {instrumentedEvents.length === 1 ? '' : 's'} with track()
                    calls)
                  </Text>
                  {instrumentedEvents.map((event) => (
                    <Text key={`i:${event.name}`} color={Colors.body}>
                      {Icons.diamond} <Text bold>{event.name}</Text>
                      <Text color={Colors.muted}> {event.description}</Text>
                    </Text>
                  ))}
                </Box>
              )}
              {autocapturedEvents.length > 0 && (
                <Box
                  flexDirection="column"
                  marginTop={instrumentedEvents.length > 0 ? 1 : 0}
                >
                  <Text color={Colors.secondary} bold>
                    Covered by autocapture ({autocapturedEvents.length} event
                    {autocapturedEvents.length === 1 ? '' : 's'} — no track()
                    needed)
                  </Text>
                  {autocapturedEvents.map((event) => (
                    <Text key={`a:${event.name}`} color={Colors.body}>
                      {Icons.bullet} <Text bold>{event.name}</Text>
                      <Text color={Colors.muted}> {event.description}</Text>
                    </Text>
                  ))}
                </Box>
              )}
            </Box>
          )}

          {/* Dashboard link — the hero of the outro. The wizard always creates
              a dashboard during the conclude phase; surface it as a clickable
              link with a clear "this is your next step" framing so users
              don't bounce out of the terminal wondering "what now?".
              For full-activation re-runs the dashboard URL is read from
              `.amplitude/dashboard.json` on disk (the agent never ran this
              session) — same hero block, slightly recalibrated copy: the
              user has been collecting data for a while, so we lead with
              "Open it now" rather than "first charts populate". */}
          {dashboardOpenUrl && (
            <Box marginTop={1} flexDirection="column">
              <Text color={Colors.accent} bold>
                {Icons.diamond} Your dashboard is ready
              </Text>
              <Box marginLeft={2}>
                <Text color={Colors.body}>
                  <TerminalLink url={dashboardOpenUrl}>
                    {dashboardOpenUrl}
                  </TerminalLink>
                </Text>
              </Box>
              <Box marginLeft={2}>
                <Text color={Colors.muted}>
                  {isFullActivationSuccess
                    ? 'Open it now to see what your users are up to today.'
                    : 'Open it now to see your first charts populate as users hit the app.'}
                </Text>
              </Box>
            </Box>
          )}

          {/* Per-file diff summary — additive, complements the
              setup-report. Shows +N/-M counts so users see the
              magnitude of each change at a glance. Sourced from the
              session-scoped FileChangeLedger; empty when capture
              didn't fire (probe runs, full-activation re-runs). */}
          {meaningfulDiffs.length > 0 && (
            <Box marginTop={1}>
              <DiffViewer
                diffs={meaningfulDiffs}
                installDir={installDir}
              />
            </Box>
          )}

          {/* Single-line review note — only when a fresh report was actually
              written this run. Without the existence check, a stale report
              from a previous run (different workspace) would be advertised
              as if it described this run. The check is captured once on
              mount (see `reportExists` declaration) rather than re-stat'd
              on every render. */}
          {reportExists && (
            <Box marginTop={1}>
              <Text color={Colors.muted}>
                Review changes in{' '}
                <Text bold color={Colors.secondary}>
                  ./amplitude-setup-report.md
                </Text>
              </Text>
            </Box>
          )}

          {/* Discovery hint for the keystroke shortcut. The picker also
              has an entry for this, but a one-liner here builds trust
              that the wizard has nothing to hide — every file change is
              one keystroke away from inspection. */}
          {changedFiles.length > 0 && (
            <Box marginTop={reportExists ? 0 : 1}>
              <Text color={Colors.muted}>
                Press{' '}
                <Text bold color={Colors.accent}>
                  D
                </Text>{' '}
                to review the {changedFiles.length} file
                {changedFiles.length === 1 ? '' : 's'} changed.
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* ── Error ─────────────────────────────────────────────────────── */}
      {outroData.kind === OutroKind.Error && (
        <Box flexDirection="column">
          <Text color={Colors.error} bold>
            {Icons.cross} Setup failed
          </Text>
          {outroData.message && (
            <Box marginTop={1}>
              <Text color={Colors.body}>{outroData.message}</Text>
            </Box>
          )}
          {/* Structured login/resume hints — under WIZARD_NEW_UX, the
              error variant ALWAYS surfaces the two recovery commands
              the orchestrator-facing NDJSON would emit. Mirrors the
              `loginCommand` / `resumeCommand` payload on
              `emitAuthRequired` so a TUI user has the same actionable
              copy as a CI/agent-mode operator reading the JSON stream.
              Login command renders only when the error class implies
              an auth issue (`promptLogin`); resume command renders on
              every error (any failure can be retried from checkpoint).
              The legacy view (gate off) keeps its existing layout. */}
          {process.env.WIZARD_NEW_UX === '1' && (
            <Box marginTop={1} flexDirection="column">
              {outroData.promptLogin && (
                <Text color={Colors.secondary}>
                  {Icons.arrowRight} Sign in:{' '}
                  <Text bold>npx @amplitude/wizard login</Text>
                </Text>
              )}
              <Text color={Colors.secondary}>
                {Icons.arrowRight} Resume:{' '}
                <Text bold>npx @amplitude/wizard</Text>
              </Text>
            </Box>
          )}
          {/* Last-activity anchor — when the run actually started AND any
              task transitioned past pending, surface a one-line
              "Started at HH:MM:SS · Step: <label>" so the user has a
              concrete entry-point into the log file before they open it.
              The bullets below ("Press L to open the log", "--debug",
              "Press C to write a bug report") all reference the log
              indirectly; this line tells the user *where* in the log to
              look. Rendered as a muted sub-line so it sits visually
              under the error message rather than competing with the
              actionable bullets that follow. */}
          {(() => {
            const footer = buildLastActivityFooter({
              runStartedAt: store.session.runStartedAt,
              tasks: store.tasks,
            });
            if (!footer) return null;
            return (
              <Box marginTop={1}>
                <Text color={Colors.muted}>
                  Started at <Text bold>{footer.startedAt}</Text> {Icons.dot}{' '}
                  Step: <Text bold>{footer.stepLabel}</Text>
                </Text>
              </Box>
            );
          })()}
          <Box marginTop={1} flexDirection="column">
            <Text color={Colors.secondary}>
              {Icons.arrowRight} Check your API key and network connection
            </Text>
            <Text color={Colors.secondary}>
              {Icons.arrowRight} Run the wizard again with{' '}
              <Text bold>--debug</Text> for more detail
            </Text>
            <Text color={Colors.secondary}>
              {Icons.arrowRight} Full log: <Text bold>{getLogFilePath()}</Text>
            </Text>
            {bugReportPathState && (
              <Text color={Colors.success}>
                {Icons.checkmark} Bug report written to{' '}
                <Text bold>{bugReportPathState}</Text>
              </Text>
            )}
            {outroData.docsUrl && (
              <Text color={Colors.secondary}>
                {Icons.arrowRight} Docs:{' '}
                <TerminalLink url={outroData.docsUrl}>
                  {outroData.docsUrl}
                </TerminalLink>
              </Text>
            )}
          </Box>

          {/* Hotkey pill bar — high-contrast, accent-coloured `[K] label`
              row so users scanning the screen for "what can I press?"
              find the action surface in one glance. Replaces the
              previous inline "(press L to open)" / "Press C to …"
              hints, which were rendered in muted secondary text inside
              the troubleshooting bullets above and easy to miss.

              Pill keys are gated on the same conditions as their input
              handlers (above) so the bar never advertises a hotkey that
              would be a no-op. `showPreservePrompt` suppresses the
              standard bar entirely — the K/R prompt below has its own
              dedicated affordances and a second pill row would
              compete with it. */}
          {!showPreservePrompt && (
            <Box marginTop={1}>
              <HotkeyPills
                pills={(() => {
                  const pills: HotkeyPill[] = [];
                  if (showRetryHint) pills.push({ key: 'R', label: 'Retry' });
                  pills.push({ key: 'L', label: 'Open log' });
                  pills.push({ key: 'C', label: 'Write bug report' });
                  return pills;
                })()}
              />
            </Box>
          )}

          {/* Preserve-files prompt — only when the failure class is one
              where the agent's writes are demonstrably consistent (e.g.
              AUTH_ERROR, where the bearer expired AFTER the event plan
              was approved and `track()` calls landed). Without this
              prompt the cleanup hook would silently revert every file
              touched during the run, penalising the user for a token
              refresh bug. The default is Keep — the safer of the two
              outcomes. */}
          {showPreservePrompt && (
            <Box marginTop={1} flexDirection="column">
              <Text color={Colors.warning} bold>
                Your changes are still on disk
              </Text>
              <Text color={Colors.body}>
                The instrumentation completed successfully — only the final
                handshake failed. Choose what to do with the files the wizard
                wrote:
              </Text>
              <Box marginTop={1} flexDirection="column">
                <Text color={Colors.secondary}>
                  Press{' '}
                  <Text bold color={Colors.accent}>
                    K
                  </Text>{' '}
                  to keep changes <Text color={Colors.muted}>(default)</Text>
                </Text>
                <Text color={Colors.secondary}>
                  Press{' '}
                  <Text bold color={Colors.accent}>
                    R
                  </Text>{' '}
                  to revert every file the wizard touched
                </Text>
              </Box>
            </Box>
          )}
          {preserveResolution === 'reverted' && (
            <Box marginTop={1}>
              <Text color={Colors.warning}>
                {Icons.dash} Reverted the wizard's writes
                {revertCount
                  ? ` (${revertCount.filesReverted} file${
                      revertCount.filesReverted === 1 ? '' : 's'
                    } reverted, ${revertCount.filesRemoved} file${
                      revertCount.filesRemoved === 1 ? '' : 's'
                    } removed)`
                  : ''}
                . Press any key to exit.
              </Text>
            </Box>
          )}
          {preserveResolution === 'kept' && (
            <Box marginTop={1}>
              <Text color={Colors.success}>
                {Icons.checkmark} Kept the wizard's changes on disk.
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* ── Cancel ────────────────────────────────────────────────────── */}
      {outroData.kind === OutroKind.Cancel && (
        <Box flexDirection="column">
          <Text color={Colors.warning} bold>
            {Icons.dash} Setup cancelled
          </Text>
          {outroData.message && (
            <Box marginTop={1}>
              <Text color={Colors.body}>{outroData.message}</Text>
            </Box>
          )}
          {/* File-state line — TUI Auditor T4. "Closure is empathy when
              the user knows exactly what's on disk." Rendered in muted
              tone (not warning / not success) so it informs without
              shouting. Omitted entirely when the ledger is absent — we
              don't have evidence either way, so asserting "0 files"
              would be the same uncertainty the audit flagged.

              Past- vs future-tense depends on whether the cleanup hook
              has already reverted the ledger (see the `cancelLedgerState`
              capture above and Bugbot finding on PR #741). */}
          {cancelLedgerState !== null && (
            <Box marginTop={1}>
              <Text color={Colors.muted}>
                {renderCancelFileStateLine(cancelLedgerState)}
              </Text>
            </Box>
          )}
          {/* Resume-later note — closes the cancel outro on a forward-
              looking beat instead of a dead stop. The wizard is checkpoint-
              aware (session-checkpoint.ts) so re-running in the same dir
              picks up region/org/framework selections automatically. */}
          <Box marginTop={1} flexDirection="column">
            <Text color={Colors.secondary} bold>
              Resume later
            </Text>
            <Text color={Colors.body}>
              Pick up where you left off — run{' '}
              <Text bold color={Colors.heading}>
                npx @amplitude/wizard
              </Text>{' '}
              in this directory anytime.
            </Text>
            {showRetryHint && (
              <Text color={Colors.secondary}>
                {Icons.arrowRight} Or press <Text bold>R</Text> now to resume
                immediately
              </Text>
            )}
          </Box>
          {outroData.docsUrl && (
            <Box marginTop={1}>
              <Text color={Colors.secondary}>
                Manual setup:{' '}
                <TerminalLink url={outroData.docsUrl}>
                  {outroData.docsUrl}
                </TerminalLink>
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <Box marginTop={1}>
        {isSuccess ? (
          <PickerMenu
            // Dashboard first — it's the most useful next step. Report comes
            // second, and only when a fresh one exists on disk for this run.
            // Without the existsSync gate, the option would point at a stale
            // report from a previous run (e.g. against a different workspace).
            options={(() => {
              const dashboardUrl = dashboardOpenUrl;
              return [
                {
                  label: dashboardUrl
                    ? 'Open your analytics dashboard'
                    : 'Open Amplitude',
                  value: 'dashboard',
                  hint: dashboardUrl
                    ? 'Recommended next step'
                    : 'amplitude.com',
                },
                ...(reportExists
                  ? [{ label: 'View setup report', value: 'report' }]
                  : []),
                // Conditional on a non-empty file list — empty entry is
                // a dead-end, hide it. Hint shows the count so users
                // know what to expect before they enter the view.
                ...(changedFiles.length > 0
                  ? [
                      {
                        label: 'View files changed',
                        value: 'changes',
                        hint: `${changedFiles.length} file${
                          changedFiles.length === 1 ? '' : 's'
                        }`,
                      },
                    ]
                  : []),
                { label: 'Exit', value: 'exit' },
              ];
            })()}
            onSelect={(value) => {
              const choice = Array.isArray(value) ? value[0] : value;
              analytics.wizardCapture('outro action', {
                action: choice,
                'outro kind': outroData.kind,
              });
              if (choice === 'report') {
                setShowReport(true);
              } else if (choice === 'changes') {
                analytics.wizardCapture('view changes opened', {
                  'file count': changedFiles.length,
                  source: 'picker',
                });
                setShowChangedFiles(true);
              } else if (choice === 'dashboard') {
                // readDisk: false — outro runs at the end of the wizard, far
                // past the RegionSelect gate. Tier 1 is authoritative.
                const zone = resolveZone(
                  store.session,
                  DEFAULT_AMPLITUDE_ZONE,
                  {
                    readDisk: false,
                  },
                );
                const url = dashboardOpenUrl ?? OUTBOUND_URLS.overview[zone];
                opn(url, { wait: false }).catch(() => {
                  /* fire-and-forget */
                });
              } else {
                // Route through wizardSuccessExit so the
                // 'outro action' wizardCapture above (and any other
                // analytics events queued during this session) flush
                // before process.exit fires. A bare process.exit(0)
                // here would drop the trailing telemetry.
                void wizardSuccessExit(0);
              }
            }}
          />
        ) : (
          <Text color={Colors.muted}>Press any key to exit</Text>
        )}
      </Box>
    </Box>
  );
};

/**
 * Read the persisted dashboard URL from `<installDir>/.amplitude/dashboard.json`
 * (or the legacy `<installDir>/.amplitude-dashboard.json`, whichever is fresher).
 *
 * Used by full-activation re-runs where the agent never executes — the
 * in-process watcher in agent-interface.ts that normally pushes the URL
 * onto the session is bypassed entirely. Without this, returning users
 * with already-healthy projects would never see their dashboard surfaced
 * in the outro and would bounce out of the terminal wondering whether
 * the wizard did anything.
 *
 * Returns null on every failure mode (missing file, invalid JSON, missing
 * `dashboardUrl` field). The caller falls back to the canonical
 * "Open Amplitude" link.
 */
function readDashboardUrlFromDisk(installDir: string): string | null {
  const chosenPath = pickFreshestExisting([
    getDashboardFile(installDir),
    path.join(installDir, '.amplitude-dashboard.json'),
  ]);
  if (!chosenPath) return null;

  try {
    const content = fs.readFileSync(chosenPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { dashboardUrl?: unknown }).dashboardUrl === 'string'
    ) {
      const url = (parsed as { dashboardUrl: string }).dashboardUrl;
      // Sanity-check: the wizard always writes a fully-qualified
      // `https://` URL, so anything else is a stale placeholder, a
      // hand-edited file, or an attempt to redirect the user's browser
      // somewhere unencrypted. Reject `http://` too — accepting it would
      // open a small phishing vector for a local attacker who can edit
      // `.amplitude/dashboard.json` since this URL is opened directly
      // via `opn()`.
      if (url.startsWith('https://')) {
        return url;
      }
    }
  } catch {
    // Read or JSON.parse failed — treat as no URL.
  }
  return null;
}
