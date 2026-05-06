import { Integration } from '../../src/lib/constants.js';
import type { Scenario } from '../runner/types.js';

export const scenario: Scenario = {
  name: 'react-vite-vanilla',
  ring: 1,
  fixture: 'react-vite-vanilla',
  integrationHint: Integration.javascript_web,
  buildCommand: ['pnpm', 'build'],
  expectedSdkPackage: '@amplitude/unified',
  expectedEnvPrefix: 'VITE_',
  expectedInitFile: 'src/main.tsx',
  expectedEvents: ['Page Viewed', 'Sign Up', 'Sign In'],
  forbiddenPaths: ['vite.config.ts', 'vite.config.js'],
  notes: 'Plain React + Vite starter from `npm create vite@latest`.',
};
