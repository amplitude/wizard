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
import { useState } from 'react';
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
import { getLogFilePath } from '../../../lib/observability/index.js';
import { writeBugReport } from '../../../lib/bug-report.js';

const REPORT_FILE = 'amplitude-setup-report.md';

interface OutroScreenProps {
  store: WizardStore;
}

export const OutroScreen = ({ store }: OutroScreenProps) => {
  useWizardStore(store);

  const [showReport, setShowReport] = useState(false);
  const [bugReportPathState, setBugReportPathState] = useState<string | null>(
    null,
  );

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
      // Signal dismissal instead of process.exit(0) directly. The
      // wizardAbort caller is awaiting this — when it resolves, abort
      // proceeds to its analytics flush + process.exit with the real
      // exit code (NETWORK / AGENT_FAILED / etc.). Calling process.exit
      // here would: (1) force exitCode 0 on every error, hiding real
      // failures from CI; (2) skip the analytics shutdown that
      // wizardAbort runs after cancel; (3) race with the success path
      // below which already routes through process.exit.
      store.signalOutroDismissed();
      return;
    }
    if (showReport && key.escape) setShowReport(false);
  });

  const outroData = store.session.outroData;
  const visibleEvents = store.eventPlan.filter((e) => e.name.trim().length > 0);

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

          {/* Dashboard link — shown when the agent created one */}
          {store.session.checklistDashboardUrl && (
            <Box marginTop={1} flexDirection="column">
              <Text color={Colors.success} bold>
                📊 Dashboard ready:
              </Text>
              <Text color={Colors.muted}>
                {store.session.checklistDashboardUrl}
              </Text>
            </Box>
          )}

          {/* Single-line review note */}
          <Box marginTop={1}>
            <Text color={Colors.muted}>
              Review changes in{' '}
              <Text bold color={Colors.secondary}>
                ./amplitude-setup-report.md
              </Text>
            </Text>
          </Box>
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
            options={(() => {
              const dashboardUrl = store.session.checklistDashboardUrl;
              return [
                { label: 'View setup report', value: 'report' },
                {
                  label: dashboardUrl
                    ? 'Open your analytics dashboard'
                    : 'Open Amplitude',
                  value: 'dashboard',
                  hint: dashboardUrl ? undefined : 'amplitude.com',
                },
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
                  store.session.checklistDashboardUrl ??
                  OUTBOUND_URLS.overview[zone];
                opn(url, { wait: false }).catch(() => {
                  /* fire-and-forget */
                });
              } else {
                process.exit(0);
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
