/**
 * ChecklistScreen (v2) — Post-setup checklist for first chart and dashboard.
 *
 * Shown after DataIngestionCheckScreen confirms events are flowing.
 *
 * v2 changes:
 *   - Celebration header: "Your events are flowing!" in success green
 *   - Items framed as opportunities, not homework
 *   - Cleaner labels and consistent styling with v2 palette
 *   - Same business logic: fetchOwnedDashboards, opn, store methods
 */

import { Box, Text } from 'ink';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { Colors, Icons } from '../styles.js';
import { PickerMenu } from '../primitives/index.js';
import { OUTBOUND_URLS } from '../../../lib/constants.js';
import type { AmplitudeZone } from '../../../lib/constants.js';
import opn from 'opn';
import { analytics } from '../../../utils/analytics.js';
import { fetchOwnedDashboards } from '../../../lib/api.js';

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

  // On mount, detect charts/dashboards the user already owns so returning
  // users see the correct state without re-doing completed steps.
  useEffect(() => {
    const {
      credentials,
      selectedOrgId,
      checklistChartComplete,
      checklistDashboardComplete,
    } = store.session;
    if (!credentials || !selectedOrgId) return;
    if (checklistChartComplete && checklistDashboardComplete) return;

    const accessToken = credentials.accessToken;
    const sessionZone = (store.session.region ?? 'us') as AmplitudeZone;
    fetchOwnedDashboards(accessToken, sessionZone, selectedOrgId)
      .then(({ hasCharts, hasDashboards }) => {
        if (hasCharts) store.setChecklistChartComplete();
        if (hasDashboards) store.setChecklistDashboardComplete();
      })
      .catch(() => {
        // fetchOwnedDashboards never rejects — handled defensively
      });
  }, []);

  const chartUrl = OUTBOUND_URLS.newChart(zone, selectedOrgId);
  const dashboardUrl = OUTBOUND_URLS.newDashboard(zone, selectedOrgId);

  function openInBrowser(url: string, item: 'chart' | 'dashboard') {
    setOpening(item);
    analytics.wizardCapture('Checklist Step Opened', { item });
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
        ? `${Icons.checkmark} Build a chart — done`
        : `${Icons.bulletOpen} Build your first chart`,
      hint: checklistChartComplete ? undefined : 'opens in browser',
      disabled: checklistChartComplete,
    },
    {
      value: 'dashboard' as const,
      label: checklistDashboardComplete
        ? `${Icons.checkmark} Create a dashboard — done`
        : `${Icons.bulletOpen} Create your first dashboard`,
      hint: checklistDashboardComplete
        ? undefined
        : checklistChartComplete
        ? 'opens in browser'
        : 'build a chart first',
      disabled: checklistDashboardComplete || !checklistChartComplete,
    },
    {
      value: 'taxonomy' as const,
      label: `${Icons.bulletOpen} Set up taxonomy`,
      hint: 'coming soon',
      disabled: true,
    },
    {
      value: 'continue' as const,
      label: allDone
        ? `${Icons.arrowRight} Done — continue`
        : `${Icons.arrowRight} Skip and continue`,
      hint: allDone ? undefined : 'you can always do these later',
    },
  ];

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      {/* Header — celebration framing */}
      <Box marginBottom={1} flexDirection="column">
        <Text bold color={Colors.success}>
          {Icons.checkmark} Your events are flowing!
        </Text>
        <Text color={Colors.body}>Here&apos;s what to explore next:</Text>
      </Box>

      {opening && (
        <Box marginBottom={1}>
          <Text color={Colors.muted}>
            Opening Amplitude in your browser{Icons.ellipsis}
          </Text>
        </Box>
      )}

      <PickerMenu
        options={options}
        onSelect={(v) => handleSelect(v as ChecklistAction)}
      />
    </Box>
  );
};
