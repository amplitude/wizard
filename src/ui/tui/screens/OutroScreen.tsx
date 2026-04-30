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
import { PickerMenu, ReportViewer, TerminalLink } from '../primitives/index.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import {
  DEFAULT_AMPLITUDE_ZONE,
  OUTBOUND_URLS,
} from '../../../lib/constants.js';
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

const REPORT_FILE = 'amplitude-setup-report.md';

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
  const [bugReportPathState, setBugReportPathState] = useState<string | null>(
    null,
  );
  // Disk-state about the setup report — captured ONCE on mount so we
  // don't sync-stat the filesystem on every re-render (the picker
  // re-renders on each keypress, and Ink's reconciler can re-render on
  // unrelated store events too). The report file is written by the
  // agent before this screen mounts, so a one-shot read is sufficient.
  const [reportExists, setReportExists] = useState(false);

  const isSuccess = store.session.outroData?.kind === OutroKind.Success;
  const isError = store.session.outroData?.kind === OutroKind.Error;

  // Any-key-to-exit for non-success states; success uses the picker.
  // Exceptions on error: 'l'/'L' opens the log in the OS-default handler,
  // 'c'/'C' writes a sanitized bug report to disk. Both keep the process
  // alive so the user can review the outro after the action completes.
  useScreenInput((input, key) => {
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
      // Signal dismissal first. When we got here via wizardAbort, that
      // caller is awaiting this signal — once it resolves, abort runs
      // its own analytics flush and `process.exit` with the real exit
      // code (NETWORK / AGENT_FAILED / etc.). Don't double-exit in that
      // case: a bare `process.exit(0)` here would (1) force exitCode 0
      // on every error, hiding real failures from CI; (2) skip the
      // analytics shutdown wizardAbort runs after cancel.
      store.signalOutroDismissed();
      // BUT — several screens (DataIngestionCheckScreen `q`, IntroScreen
      // resume-cancel, SetupScreen back-out, ActivationOptionsScreen
      // 'exit') navigate to the cancel outro via `setOutroData` without
      // going through wizardAbort. In that path nobody is awaiting
      // outroDismissed, so the dismissal signal resolves a promise no
      // one is listening to and the process hangs forever — only Ctrl+C
      // escapes. Detect "no abort in flight" and drive the exit
      // ourselves so any-key really does exit.
      if (!isWizardAbortInProgress()) {
        void wizardSuccessExit(0);
      }
      return;
    }
    if (showReport && key.escape) setShowReport(false);
  });

  const outroData = store.session.outroData;
  const visibleEvents = store.eventPlan.filter((e) => e.name.trim().length > 0);

  /** Browser link with sign-in / refresh gate — see `toWizardDashboardOpenUrl`. */
  const dashboardCanonicalUrl = store.session.checklistDashboardUrl;
  const dashboardOpenUrl = dashboardCanonicalUrl
    ? toWizardDashboardOpenUrl(dashboardCanonicalUrl)
    : null;

  if (!outroData) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text color={Colors.muted}>Finishing up{Icons.ellipsis}</Text>
      </Box>
    );
  }

  // Build the report file path from the install directory.
  const installDir = store.session.installDir;
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
          <Text color={Colors.success} bold>
            🎉 Amplitude is live!
          </Text>
          {visibleEvents.length > 0 && (
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
              don't bounce out of the terminal wondering "what now?". */}
          {dashboardOpenUrl && (
            <Box marginTop={1} flexDirection="column">
              <Text color={Colors.accent} bold>
                {Icons.diamond} Your dashboard is ready
              </Text>
              <Box marginLeft={2}>
                <Text color={Colors.body}>
                  <TerminalLink url={dashboardOpenUrl}>{dashboardOpenUrl}</TerminalLink>
                </Text>
              </Box>
              <Box marginLeft={2}>
                <Text color={Colors.muted}>
                  Open it now to see your first charts populate as users hit the
                  app.
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
                const url =
                  dashboardOpenUrl ?? OUTBOUND_URLS.overview[zone];
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
