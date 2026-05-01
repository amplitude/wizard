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
import { useEffect, useState } from 'react';
import * as fs from 'fs';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { OutroKind } from '../session-constants.js';
import { Colors, Icons } from '../styles.js';
import {
  ChangedFilesView,
  PickerMenu,
  ReportViewer,
  TerminalLink,
} from '../primitives/index.js';
import { buildChangedFileList } from '../primitives/ChangedFilesView.js';
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
import { toWizardDashboardOpenUrl } from '../../../utils/dashboard-open-url.js';
import {
  getDashboardFile,
  pickFreshestExisting,
} from '../../../utils/storage-paths.js';
import { retryFromCheckpoint } from '../../../lib/retry-from-checkpoint.js';
import { isInteractiveOutro } from '../utils/outro-mode.js';

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
  // Disk-state about the setup report — captured ONCE on mount so we
  // don't sync-stat the filesystem on every re-render (the picker
  // re-renders on each keypress, and Ink's reconciler can re-render on
  // unrelated store events too). The report file is written by the
  // agent before this screen mounts, so a one-shot read is sufficient.
  const [reportExists, setReportExists] = useState(false);

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
      // Signal dismissal first. When we got here via wizardAbort, that
      // caller is awaiting this signal — once it resolves, abort runs
      // its own analytics flush and `process.exit` with the real exit
      // code (NETWORK / AGENT_FAILED / etc.). Don't double-exit in that
      // case: a bare exit here would (1) force a hardcoded exitCode on
      // every error, hiding real failures from CI; (2) skip the
      // analytics shutdown wizardAbort runs after cancel.
      store.signalOutroDismissed();
      // BUT — several screens (DataIngestionCheckScreen `q`, IntroScreen
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
      <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color={Colors.accent}>
            Setup Report
          </Text>
          <Text color={Colors.muted}> (Esc to go back)</Text>
        </Box>
        <ReportViewer filePath={reportPath} />
      </Box>
    );
  }

  // ── Main outro views ─────────────────────────────────────────────────

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      {/* ── Success ───────────────────────────────────────────────────── */}
      {outroData.kind === OutroKind.Success && (
        <Box flexDirection="column">
          {/* Heading copy splits on the activation level. Fresh-install
              success deserves the "live!" celebration. Full-activation
              re-runs (returning user, project already healthy) get a
              calmer "your project is healthy" line — the wizard didn't
              just set anything up, so the celebratory tone would feel
              false. Both paths share every other element below. */}
          <Text color={Colors.success} bold>
            {isFullActivationSuccess
              ? `${Icons.checkmark} Your Amplitude project is healthy`
              : '🎉 Amplitude is live!'}
          </Text>
          {isFullActivationSuccess && (
            <Text color={Colors.body}>
              {store.session.selectedProjectName
                ? `${store.session.selectedProjectName} is already ingesting events.`
                : 'This project is already ingesting events.'}
            </Text>
          )}
          {!isFullActivationSuccess && visibleEvents.length > 0 && (
            <Text color={Colors.body}>
              {visibleEvents.length} event
              {visibleEvents.length !== 1 ? 's' : ''} instrumented
              {store.session.selectedEnvName
                ? ` in ${store.session.selectedEnvName}`
                : ''}
              .
            </Text>
          )}

          {/* Changes summary */}
          {outroData.changes && outroData.changes.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {outroData.changes.map((change, i) => (
                <Text key={i} color={Colors.body}>
                  {Icons.bullet} {change}
                </Text>
              ))}
            </Box>
          )}

          {/* Events added */}
          {visibleEvents.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color={Colors.secondary} bold>
                Events
              </Text>
              {visibleEvents.map((event) => (
                <Text key={event.name} color={Colors.body}>
                  {Icons.diamond} <Text bold>{event.name}</Text>
                  <Text color={Colors.muted}> {event.description}</Text>
                </Text>
              ))}
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
          <Box marginTop={1} flexDirection="column">
            <Text color={Colors.secondary}>
              {Icons.arrowRight} Check your API key and network connection
            </Text>
            <Text color={Colors.secondary}>
              {Icons.arrowRight} Run the wizard again with{' '}
              <Text bold>--debug</Text> for more detail
            </Text>
            {showRetryHint && (
              <Text color={Colors.secondary}>
                {Icons.arrowRight} Press <Text bold>R</Text> to retry from where
                we left off
              </Text>
            )}
            <Text color={Colors.secondary}>
              {Icons.arrowRight} Full log: <Text bold>{getLogFilePath()}</Text>{' '}
              <Text color={Colors.muted}>(press L to open)</Text>
            </Text>
            <Text color={Colors.secondary}>
              {Icons.arrowRight} Press <Text bold>C</Text> to write a sanitized
              bug report
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
