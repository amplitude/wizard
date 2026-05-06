import { Integration } from '../../src/lib/constants.js';
import type { Scenario } from '../runner/types.js';

export const scenario: Scenario = {
  name: 'react-router-7-framework',
  ring: 1,
  fixture: 'react-router-7-framework',
  integrationHint: Integration.reactRouter,
  buildCommand: ['pnpm', 'build'],
  expectedSdkPackage: '@amplitude/unified',
  // React Router 7 framework mode uses Vite under the hood.
  expectedEnvPrefix: 'VITE_',
  expectedInitFile: 'app/root.tsx',
  expectedEvents: ['Page Viewed', 'Sign Up', 'Sign In'],
  forbiddenPaths: ['vite.config.ts', 'vite.config.js'],
  notes: 'React Router 7 framework mode (file-based routing).',
};
