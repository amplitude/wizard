/**
 * ActivationOptionsScreen — "What would you like to do?" prompt (v2).
 *
 * Shown when the user has the SDK installed but hasn't fully activated yet
 * (1-49 events). Offers next-step options without forcing a full re-run.
 */

import { Box, Text } from 'ink';
import { useState } from 'react';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { PickerMenu } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import { OutroKind } from '../session-constants.js';
import { OUTBOUND_URLS } from '../../../lib/constants.js';
import { writeBugReport } from '../../../lib/bug-report.js';
import { getLogFilePath } from '../../../lib/observability/index.js';
import { analytics } from '../../../utils/analytics.js';
import opn from 'opn';

interface ActivationOptionsScreenProps {
  store: WizardStore;
}

const DOCS_URL = OUTBOUND_URLS.sdkDocs;

export const ActivationOptionsScreen = ({
  store,
}: ActivationOptionsScreenProps) => {
  useWizardStore(store);

  const { snippetConfigured } = store.session;

  const [bugReportPathState, setBugReportPathState] = useState<string | null>(
    null,
  );
  const [bugReportFailed, setBugReportFailed] = useState(false);

  const handleSelect = (value: string) => {
    switch (value) {
      case 'test-locally':
        analytics.wizardCapture('activation options selected', {
          choice: 'test locally',
        });
        // Route to Framework Detection by treating this as a new project
        store.setActivationOptionsComplete();
        break;
      case 'bug-report': {
        analytics.wizardCapture('activation options selected', {
          choice: 'bug report',
        });
        // Write a sanitized support report and open the log file. Stay on
        // screen so the user can read the path before choosing a next step.
        const written = writeBugReport({
          errorMessage: 'User reported they were blocked on activation.',
          integration: store.session.integration,
        });
        analytics.wizardCapture('activation options bug report written', {
          success: written !== null,
        });
        if (written) {
          setBugReportPathState(written);
          setBugReportFailed(false);
          opn(getLogFilePath(), { wait: false }).catch(() => {
            /* opn fails on some headless terminals — non-fatal */
          });
        } else {
          setBugReportFailed(true);
        }
        // Stay on screen — user can still pick another option
        break;
      }
      case 'docs':
        analytics.wizardCapture('activation options selected', {
          choice: 'docs',
        });
        opn(DOCS_URL, { wait: false }).catch(() => {
          /* fire-and-forget */
        });
        // Stay on screen — don't advance
        break;
      case 'exit':
        analytics.wizardCapture('activation options selected', {
          choice: 'exit',
        });
        store.setOutroData({
          kind: OutroKind.Cancel,
          message: 'Come back once your app is deployed and sending events.',
        });
        break;
    }
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Your SDK is{snippetConfigured ? ' installed' : ' partially set up'}{' '}
        {Icons.dash} waiting for events
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text color={Colors.secondary}>
          We can see your project is configured but hasn&apos;t received many
          events yet.
        </Text>
        <Text color={Colors.body}>What would you like to do?</Text>
      </Box>

      <Box marginTop={1}>
        <PickerMenu
          options={[
            {
              value: 'test-locally',
              label: 'Help me test locally',
              hint: 'run the setup agent',
            },
            {
              value: 'bug-report',
              label: "I'm blocked — write a support report",
              hint: 'open log + save shareable report',
            },
            { value: 'docs', label: 'Take me to the docs', hint: DOCS_URL },
            {
              value: 'exit',
              label: "I'm done for now",
              hint: 'exit and resume later',
            },
          ]}
          onSelect={(v) => handleSelect(v as string)}
        />
      </Box>

      {bugReportPathState && (
        <Box marginTop={1} flexDirection="column">
          <Text color={Colors.success}>
            {Icons.checkmark} Wrote support report to:
          </Text>
          <Text bold>{bugReportPathState}</Text>
          <Text color={Colors.secondary}>
            We also tried to open your log file. Share both with support.
          </Text>
        </Box>
      )}

      {bugReportFailed && (
        <Box marginTop={1} flexDirection="column">
          <Text color={Colors.warning}>
            Couldn&apos;t write the support report. You can still send us your
            log file:
          </Text>
          <Text bold>{getLogFilePath()}</Text>
        </Box>
      )}
    </Box>
  );
};
