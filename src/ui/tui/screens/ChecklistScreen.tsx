/**
 * ChecklistScreen — Post-setup checklist for first chart and first dashboard.
 *
 * Shown after DataIngestionCheckScreen confirms events are flowing.
 *
 * Items:
 *   [ ] Taxonomy agent   — @todo (in progress in parallel work)
 *   [ ] First chart      — opens Amplitude in browser; marks complete on return
 *   [ ] First dashboard  — unlocked after chart; opens Amplitude in browser
 *
 * The user can "Continue" at any time to skip remaining items and advance
 * to Slack setup.
 *
 * Chart/dashboard creation via direct GraphQL API call is planned as a
 * follow-up; for now the action opens the Amplitude web UI.
 */

import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { PickerMenu } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import { AMPLITUDE_ZONE_SETTINGS } from '../../../lib/constants.js';
import type { AmplitudeZone } from '../../../lib/constants.js';
import opn from 'opn';
import { analytics } from '../../../utils/analytics.js';

interface ChecklistScreenProps {
  store: WizardStore;
}

type ChecklistAction = 'chart' | 'dashboard' | 'taxonomy' | 'continue';

export const ChecklistScreen = ({ store }: ChecklistScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { session } = store;
  const {
    checklistChartComplete,
    checklistDashboardComplete,
    region,
    selectedOrgId,
  } = session;

  const [opening, setOpening] = useState<'chart' | 'dashboard' | null>(null);

  const zone = (region ?? 'us') as AmplitudeZone;
  const { webUrl } = AMPLITUDE_ZONE_SETTINGS[zone];
  // app.amplitude.com uses a different subdomain than data.amplitude.com
  const appBase = webUrl.replace('data.', 'app.');

  // Build deep-link URLs — org-scoped if we have an org ID
  const chartUrl = selectedOrgId
    ? `${appBase}/${selectedOrgId}/chart/new?type=segmentation`
    : `${appBase}/chart/new?type=segmentation`;
  const dashboardUrl = selectedOrgId
    ? `${appBase}/${selectedOrgId}/dashboard/new`
    : `${appBase}/dashboard/new`;

  function openInBrowser(url: string, item: 'chart' | 'dashboard') {
    setOpening(item);
    analytics.wizardCapture('checklist item opened', { item });
    opn(url, { wait: false })
      .catch(() => {
        /* fire-and-forget */
      })
      .finally(() => {
        setOpening(null);
        if (item === 'chart') store.setChecklistChartComplete();
        if (item === 'dashboard') store.setChecklistDashboardComplete();
      });
  }

  function handleSelect(value: ChecklistAction) {
    switch (value) {
      case 'chart':
        openInBrowser(chartUrl, 'chart');
        break;
      case 'dashboard':
        openInBrowser(dashboardUrl, 'dashboard');
        break;
      case 'continue':
        store.setChecklistComplete();
        break;
    }
  }

  const allDone = checklistChartComplete && checklistDashboardComplete;

  const options = [
    {
      value: 'chart' as const,
      label: checklistChartComplete
        ? `${Icons.check} First chart — done`
        : `${Icons.squareOpen} Create your first chart`,
      hint: checklistChartComplete ? undefined : 'opens in browser',
      disabled: checklistChartComplete,
    },
    {
      value: 'dashboard' as const,
      label: checklistDashboardComplete
        ? `${Icons.check} First dashboard — done`
        : checklistChartComplete
        ? `${Icons.squareOpen} Create your first dashboard`
        : `${Icons.squareOpen} Create your first dashboard`,
      hint: checklistDashboardComplete
        ? undefined
        : checklistChartComplete
        ? 'opens in browser'
        : 'create a chart first',
      disabled: checklistDashboardComplete || !checklistChartComplete,
    },
    {
      value: 'taxonomy' as const,
      label: `${Icons.squareOpen} Set up taxonomy`,
      hint: 'coming soon',
      disabled: true,
    },
    {
      value: 'continue' as const,
      label: allDone ? 'Done — continue' : 'Skip remaining and continue',
      hint: allDone ? undefined : 'you can always do these in Amplitude later',
    },
  ];

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={Colors.accent}>
          Set up your analytics
        </Text>
      </Box>

      <Box flexDirection="column" gap={1} marginBottom={2}>
        <Text>
          Your events are flowing. Now let&apos;s build some views of your data.
        </Text>
        {opening && (
          <Text color={Colors.muted}>Opening Amplitude in your browser...</Text>
        )}
      </Box>

      <PickerMenu
        options={options}
        onSelect={(v) => handleSelect(v as ChecklistAction)}
      />
    </Box>
  );
};
