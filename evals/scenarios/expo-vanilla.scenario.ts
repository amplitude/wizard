import { Integration } from '../../src/lib/constants.js';
import type { Scenario } from '../runner/types.js';

export const scenario: Scenario = {
  name: 'expo-vanilla',
  ring: 1,
  fixture: 'expo-vanilla',
  integrationHint: Integration.reactNative,
  buildCommand: ['pnpm', 'expo', 'export'],
  expectedSdkPackage: '@amplitude/analytics-react-native',
  expectedEnvPrefix: 'EXPO_PUBLIC_',
  expectedInitFile: 'app/_layout.tsx',
  expectedEvents: ['Page Viewed', 'Sign Up', 'Sign In'],
  forbiddenPaths: ['metro.config.js', 'babel.config.js'],
  notes: 'Expo Router app from `npx create-expo-app`.',
};
