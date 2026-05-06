/**
 * Scenario registry. Imports each scenario module statically so missing or
 * misnamed scenarios fail at type-check time, not at run time.
 */
import type { Scenario } from '../runner/types.js';
import { scenario as nextjsAppRouterVanilla } from './nextjs-app-router-vanilla.scenario.js';
import { scenario as nextjsAppRouterExisting } from './nextjs-app-router-existing.scenario.js';
import { scenario as reactRouter7Framework } from './react-router-7-framework.scenario.js';
import { scenario as reactRouter7Data } from './react-router-7-data.scenario.js';
import { scenario as reactViteVanilla } from './react-vite-vanilla.scenario.js';
import { scenario as expoVanilla } from './expo-vanilla.scenario.js';
import { scenario as genericProbe } from './generic-probe.scenario.js';

export const ALL_SCENARIOS: Scenario[] = [
  nextjsAppRouterVanilla,
  nextjsAppRouterExisting,
  reactRouter7Framework,
  reactRouter7Data,
  reactViteVanilla,
  expoVanilla,
  genericProbe,
];
