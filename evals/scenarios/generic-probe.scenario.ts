import { Integration } from '../../src/lib/constants.js';
import type { Scenario } from '../runner/types.js';

/**
 * "Framework markers stripped" scenario. The fixture is React + Vite with
 * `vite.config.ts` removed and the React-specific `package.json` signals
 * scrubbed. The agent should fall through to the generic skill without
 * inventing a framework or hardcoding the wrong env var prefix.
 */
export const scenario: Scenario = {
  name: 'generic-probe',
  ring: 1,
  fixture: 'generic-probe',
  integrationHint: Integration.generic,
  buildCommand: ['pnpm', 'build'],
  expectedSdkPackage: '@amplitude/unified',
  expectedEnvPrefix: '',
  expectedInitFile: 'src/amplitude.ts',
  expectedEvents: ['Page Viewed'],
  forbiddenPaths: ['next.config.js', 'next.config.mjs'],
  notes:
    'Detection-failure path. Catches agent overreach when no framework markers are present.',
};
