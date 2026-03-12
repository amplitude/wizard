/**
 * DataSetupScreen — Checks whether the connected Amplitude project has event data.
 *
 * For fresh projects (ampli.json just written): auto-advances with
 * projectHasData = false immediately, routing to Framework Detection (IntroScreen).
 *
 * For returning users whose ampli.json already exists this screen will eventually
 * check the Amplitude API for ingested event counts. For now it also auto-advances
 * with projectHasData = false until the activation-check API is wired up.
 *
 * The router's isComplete predicate (projectHasData !== null) advances past
 * this screen automatically once the value is set.
 */

import { Box, Text } from 'ink';
import { useEffect, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { LoadingBox } from '../primitives/index.js';

interface DataSetupScreenProps {
  store: WizardStore;
}

export const DataSetupScreen = ({ store }: DataSetupScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  // Auto-advance: set projectHasData = false for fresh projects.
  // When the activation-check API is implemented this effect will make the
  // API call and set the real value.
  useEffect(() => {
    if (store.session.projectHasData === null) {
      // Brief delay so the screen is visibly shown before advancing
      const t = setTimeout(() => {
        store.setProjectHasData(false);
      }, 300);
      return () => clearTimeout(t);
    }
  }, []);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <LoadingBox message="Checking project setup…" />
    </Box>
  );
};
