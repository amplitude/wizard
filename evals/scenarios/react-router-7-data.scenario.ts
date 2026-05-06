import { Integration } from '../../src/lib/constants.js';
import type { Scenario } from '../runner/types.js';

export const scenario: Scenario = {
  name: 'react-router-7-data',
  ring: 1,
  fixture: 'react-router-7-data',
  integrationHint: Integration.reactRouter,
  buildCommand: ['pnpm', 'build'],
  expectedSdkPackage: '@amplitude/unified',
  expectedEnvPrefix: 'VITE_',
  expectedInitFile: 'src/main.tsx',
  expectedEvents: ['Page Viewed', 'Sign Up', 'Sign In'],
  forbiddenPaths: ['vite.config.ts', 'vite.config.js'],
  notes:
    'React Router 7 data mode — different init surface from framework mode; both ride Ring 1.',
};
