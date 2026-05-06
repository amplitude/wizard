import { Integration } from '../../src/lib/constants.js';
import type { Scenario } from '../runner/types.js';

export const scenario: Scenario = {
  name: 'nextjs-app-router-vanilla',
  ring: 1,
  fixture: 'nextjs-app-router-vanilla',
  integrationHint: Integration.nextjs,
  buildCommand: ['pnpm', 'build'],
  expectedSdkPackage: '@amplitude/unified',
  expectedEnvPrefix: 'NEXT_PUBLIC_',
  expectedInitFile: 'app/AmplitudeProvider.tsx',
  expectedEvents: ['Page Viewed', 'Sign Up', 'Sign In'],
  forbiddenPaths: [
    'next.config.js',
    'next.config.mjs',
    'next.config.ts',
    'webpack.config.js',
    'babel.config.js',
  ],
  notes:
    'Canonical App Router scenario. Catches server/client boundary regressions.',
};
