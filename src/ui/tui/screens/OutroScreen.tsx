/**
 * OutroScreen — Summary after the agent run.
 * Reads store.session.outroData to render success, error, or cancel view.
 * Keeps the process alive until the user presses a key to exit.
 */

import { Box, Text } from 'ink';
import { useState } from 'react';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { OutroKind } from '../../../lib/wizard-session.js';
import { Colors } from '../styles.js';
import { PickerMenu, ReportViewer } from '../primitives/index.js';
import { OUTBOUND_URLS } from '../../../lib/constants.js';
import type { AmplitudeZone } from '../../../lib/constants.js';
import opn from 'opn';
import path from 'path';
import { analytics } from '../../../utils/analytics.js';

const REPORT_FILE = 'amplitude-setup-report.md';

interface OutroScreenProps {
  store: WizardStore;
}

export const OutroScreen = ({ store }: OutroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showReport, setShowReport] = useState(false);

  const isSuccess = store.session.outroData?.kind === OutroKind.Success;

  // Any-key-to-exit only for non-success states; success uses a picker.
  useScreenInput((input, key) => {
    if (!isSuccess) process.exit(0);
    if (showReport && key.escape) setShowReport(false);
  });

  const outroData = store.session.outroData;

  if (!outroData) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text color={Colors.muted}>Finishing up...</Text>
      </Box>
    );
  }

  // installDir comes from --install-dir CLI flag (defaults to process.cwd()).
  // REPORT_FILE is a compile-time constant with no path separators, so string
  // concatenation is safe and avoids path.join/path.resolve on user-supplied input.
  const installDir = store.session.installDir;
  const reportPath = installDir.endsWith(path.sep)
    ? `${installDir}${REPORT_FILE}`
    : `${installDir}${path.sep}${REPORT_FILE}`;

  if (showReport) {
    return (
      <Box flexDirection="column" flexGrow={1}>
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

  return (
    <Box flexDirection="column" flexGrow={1}>
      {outroData.kind === OutroKind.Success && (
        <Box flexDirection="column">
          <Text color="green" bold>
            {'\u2714'} Successfully installed Amplitude!
          </Text>

          <Box marginTop={1}>
            <Text>
              Check <Text bold>./amplitude-setup-report.md</Text> for details
              about your integration
            </Text>
          </Box>

          {outroData.changes && outroData.changes.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="cyan" bold>
                What the agent did:
              </Text>
              {outroData.changes.map((change, i) => (
                <Text key={i}>
                  {'\u2022'} {change}
                </Text>
              ))}
            </Box>
          )}

          {store.eventPlan.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="cyan" bold>
                Events added:
              </Text>
              {store.eventPlan.map((event) => (
                <Text key={event.name}>
                  {'\u2022'} <Text bold>{event.name}</Text>
                  <Text color={Colors.muted}> {event.description}</Text>
                </Text>
              ))}
            </Box>
          )}

          {outroData.docsUrl && (
            <Box marginTop={1}>
              <Text>
                Learn more: <Text color="cyan">{outroData.docsUrl}</Text>
              </Text>
            </Box>
          )}

          {outroData.continueUrl && (
            <Box>
              <Text>
                Continue onboarding:{' '}
                <Text color="cyan">{outroData.continueUrl}</Text>
              </Text>
            </Box>
          )}

          <Box marginTop={1}>
            <Text color={Colors.muted}>
              Note: This wizard uses an LLM agent to analyze and modify your
              project. Please review the changes made.
            </Text>
          </Box>
          <Box>
            <Text color={Colors.muted}>
              How did this work for you? Drop us a line: wizard@amplitude.com
            </Text>
          </Box>
        </Box>
      )}

      {outroData.kind === OutroKind.Error && (
        <Box flexDirection="column">
          <Text color="red" bold>
            {'\u2718'} {outroData.message || 'An error occurred'}
          </Text>
        </Box>
      )}

      {outroData.kind === OutroKind.Cancel && (
        <Box flexDirection="column">
          <Text color="yellow" bold>
            {'\u25A0'} {outroData.message || 'Cancelled'}
          </Text>
          {outroData.docsUrl && (
            <Box marginTop={1}>
              <Text>
                Manual setup guide:{' '}
                <Text color="cyan">{outroData.docsUrl}</Text>
              </Text>
            </Box>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        {isSuccess ? (
          <PickerMenu
            options={[
              { label: 'View setup report', value: 'report' },
              { label: 'Open Amplitude dashboard', value: 'dashboard' },
              { label: 'Exit', value: 'exit' },
            ]}
            onSelect={(value) => {
              const choice = Array.isArray(value) ? value[0] : value;
              analytics.wizardCapture('outro action', {
                action: choice,
                outro_kind: outroData.kind,
              });
              if (choice === 'report') {
                setShowReport(true);
              } else if (choice === 'dashboard') {
                const zone = (store.session.region ?? 'us') as AmplitudeZone;
                const url = OUTBOUND_URLS.overview[zone];
                opn(url, { wait: false }).catch(() => {
                  /* fire-and-forget */
                });
                process.exit(0);
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
