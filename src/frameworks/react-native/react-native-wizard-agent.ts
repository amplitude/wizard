/* React Native wizard for Amplitude */
import type { WizardOptions } from '../../utils/types';
import type { FrameworkConfig } from '../../lib/framework-config';
import { detectNodePackageManagers } from '../../lib/package-manager-detection';
import { Integration } from '../../lib/constants';
import { detectReactNativeProject, detectExpo } from './utils';

type ReactNativeContext = {
  isExpo?: boolean;
};

export const REACT_NATIVE_AGENT_CONFIG: FrameworkConfig<ReactNativeContext> = {
  metadata: {
    name: 'React Native',
    glyph: '📱',
    glyphColor: '#61DAFB',
    integration: Integration.reactNative,
    beta: true,
    docsUrl:
      'https://amplitude.com/docs/sdks/analytics/react-native/react-native-sdk',
    gatherContext: async (options: WizardOptions) => {
      const isExpo = await detectExpo(options);
      return { isExpo };
    },
  },

  detection: {
    packageName: 'react-native',
    packageDisplayName: 'React Native',
    usesPackageJson: true,
    getVersion: () => undefined,
    detect: detectReactNativeProject,
    detectPackageManager: detectNodePackageManagers,
  },

  environment: {
    uploadToHosting: false,
    // Expo uses EXPO_PUBLIC_ prefix; bare RN uses plain env vars via react-native-config.
    // The agent handles the correct naming based on context — we write a neutral key
    // here as a placeholder and the agent will rename as appropriate.
    getEnvVars: (apiKey, host) => ({
      AMPLITUDE_API_KEY: apiKey,
      AMPLITUDE_SERVER_URL: host,
    }),
  },

  analytics: {
    getTags: (context) => ({
      isExpo: context.isExpo ? 'true' : 'false',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a JavaScript/TypeScript project. Look for package.json with a `react-native` dependency to confirm.',
    packageInstallation:
      'Use the detect_package_manager tool. For Expo projects use `expo install`; for bare React Native use npm/yarn/pnpm. Always install both @amplitude/analytics-react-native AND @react-native-async-storage/async-storage. For bare React Native, also run `cd ios && pod install` after installing.',
    getAdditionalContextLines: (context) => {
      const envVarName = context.isExpo
        ? 'EXPO_PUBLIC_AMPLITUDE_API_KEY'
        : 'AMPLITUDE_API_KEY';
      const installCmd = context.isExpo
        ? 'expo install @amplitude/analytics-react-native @react-native-async-storage/async-storage'
        : 'npm install @amplitude/analytics-react-native @react-native-async-storage/async-storage';
      return [
        `Project type: ${context.isExpo ? 'Expo' : 'Bare React Native'}`,
        `Framework docs ID: react-native (use amplitude://docs/frameworks/react-native for documentation)`,
        `SDK: @amplitude/analytics-react-native — do NOT use @amplitude/unified (not supported for React Native)`,
        `Install command: ${installCmd}`,
        `Environment variable name: ${envVarName}`,
        `Initialization: import { init } from '@amplitude/analytics-react-native'; init(process.env.${envVarName});`,
        context.isExpo
          ? `Expo env vars require the EXPO_PUBLIC_ prefix to be available in client-side code`
          : `For bare RN, use react-native-config or inline the key via a constants file — never commit API keys to source`,
      ];
    },
  },

  ui: {
    successMessage: 'Amplitude integration complete',
    estimatedDurationMinutes: 8,
    getOutroChanges: (context) => {
      const variant = context.isExpo ? 'Expo' : 'Bare React Native';
      return [
        `Analyzed your ${variant} project structure`,
        `Installed @amplitude/analytics-react-native and async-storage peer dependency`,
        `Configured Amplitude initialization`,
      ];
    },
    getOutroNextSteps: (context) => [
      context.isExpo
        ? 'Run `expo start` to launch the app and verify events'
        : 'Run `npx react-native run-ios` or `run-android` to verify events',
      'Visit your Amplitude dashboard to see incoming events',
      "Use track('Event Name', { prop: value }) for custom events",
      'Use setUserId("user@example.com") to associate events with users',
    ],
  },
};
