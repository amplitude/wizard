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
import { OUTBOUND_URLS } from '../../../lib/constants.js';
import type { AmplitudeZone } from '../../../lib/constants.js';
import opn from 'opn';
import path from 'path';
import { analytics } from '../../../utils/analytics.js';
import { buildBundle } from '../../../lib/diagnostic-bundle.js';
import {
  uploadBundle,
  type UploadResult,
} from '../../../lib/diagnostic-upload.js';

const REPORT_FILE = 'amplitude-setup-report.md';

interface OutroScreenProps {
  store: WizardStore;
}

export const OutroScreen = ({ store }: OutroScreenProps) => {
  useWizardStore(store);

  const [showReport, setShowReport] = useState(false);
  const [uploadState, setUploadState] = useState<
    | { kind: 'idle' }
    | { kind: 'uploading' }
    | { kind: 'done'; result: UploadResult }
  >({ kind: 'idle' });

  const isSuccess = store.session.outroData?.kind === OutroKind.Success;
  const isError = store.session.outroData?.kind === OutroKind.Error;

  const runUpload = () => {
    if (uploadState.kind !== 'idle') return;
    setUploadState({ kind: 'uploading' });
    analytics.wizardCapture('diagnostic upload started', {});
    let bundle: ReturnType<typeof buildBundle>;
    try {
      bundle = buildBundle();
    } catch {
      setUploadState({ kind: 'idle' });
      return;
    }
    const zone = (store.session.region ?? 'us') as AmplitudeZone;
    const accessToken = store.session.credentials?.accessToken;
    void uploadBundle(bundle, { zone, accessToken })
      .then((result) => {
        setUploadState({ kind: 'done', result });
        analytics.wizardCapture('diagnostic upload finished', {
          outcome: result.kind,
          ...(result.kind === 'uploaded' ? { id: result.id } : {}),
          ...(result.kind === 'local' ? { reason: result.reason } : {}),
        });
      })
      .catch(() => {
        setUploadState({ kind: 'idle' });
      });
  };

  // Any-key-to-exit for non-success states; success uses the picker.
  // Exception: on error, 'u' or 'U' uploads the diagnostic bundle instead of exiting.
  useScreenInput((input, key) => {
    if (!isSuccess) {
      if (isError && (input === 'u' || input === 'U')) {
        runUpload();
        return;
      }
      process.exit(0);
    }
    if (showReport && key.escape) setShowReport(false);
  });

  const outroData = store.session.outroData;

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
            {Icons.checkmark} Amplitude is live!
          </Text>
          {store.eventPlan.length > 0 && (
            <Text color={Colors.body}>
              {store.eventPlan.length} event
              {store.eventPlan.length !== 1 ? 's' : ''} instrumented
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
          {store.eventPlan.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color={Colors.secondary} bold>
                Events
              </Text>
              {store.eventPlan.map((event) => (
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
                {Icons.checkmark} Dashboard ready:
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
            {outroData.docsUrl && (
              <Text color={Colors.secondary}>
                {Icons.arrowRight} Docs:{' '}
                <TerminalLink url={outroData.docsUrl}>
                  {outroData.docsUrl}
                </TerminalLink>
              </Text>
            )}
          </Box>
          <Box marginTop={1} flexDirection="column">
            {uploadState.kind === 'idle' && (
              <Text color={Colors.muted}>
                Press <Text bold>U</Text> to upload a diagnostic trace
              </Text>
            )}
            {uploadState.kind === 'uploading' && (
              <Text color={Colors.muted}>
                {Icons.ellipsis} Uploading diagnostic trace
              </Text>
            )}
            {uploadState.kind === 'done' &&
              uploadState.result.kind === 'uploaded' && (
                <Text color={Colors.success}>
                  {Icons.checkmark} Diagnostic uploaded:{' '}
                  <TerminalLink url={uploadState.result.url}>
                    {uploadState.result.url}
                  </TerminalLink>
                </Text>
              )}
            {uploadState.kind === 'done' &&
              uploadState.result.kind === 'local' && (
                <Text color={Colors.warning}>
                  {Icons.arrowRight} Upload unavailable. Bundle saved to{' '}
                  <Text bold>{uploadState.result.path}</Text>
                </Text>
              )}
            {uploadState.kind === 'done' &&
              uploadState.result.kind === 'skipped' && (
                <Text color={Colors.muted}>
                  {Icons.dash} Diagnostic upload skipped (telemetry disabled).
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
            options={[
              { label: 'View setup report', value: 'report' },
              {
                label: store.session.checklistDashboardUrl
                  ? 'Open your analytics dashboard'
                  : 'Open Amplitude',
                value: 'dashboard',
                hint: store.session.checklistDashboardUrl
                  ? undefined
                  : 'amplitude.com',
              },
              { label: 'Exit', value: 'exit' },
            ]}
            onSelect={(value) => {
              const choice = Array.isArray(value) ? value[0] : value;
              analytics.wizardCapture('outro action', {
                action: choice,
                'outro kind': outroData.kind,
              });
              if (choice === 'report') {
                setShowReport(true);
              } else if (choice === 'dashboard') {
                const zone = (store.session.region ?? 'us') as AmplitudeZone;
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
