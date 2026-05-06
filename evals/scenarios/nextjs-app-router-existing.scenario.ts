import { Integration } from '../../src/lib/constants.js';
import type { Scenario } from '../runner/types.js';

/**
 * Augment-don't-replace scenario. The pristine fixture already has
 * `@amplitude/analytics-browser` wired into the app shell. The agent should
 * upgrade to `@amplitude/unified` cleanly without leaving the legacy package
 * dangling and without a second `init()` call. Catches the SDK-major
 * coexistence regression class.
 */
export const scenario: Scenario = {
  name: 'nextjs-app-router-existing',
  ring: 1,
  fixture: 'nextjs-app-router-existing',
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
    "Pre-existing @amplitude/analytics-browser. Verifies augment-don't-replace and SDK-major coexistence handling.",
};
