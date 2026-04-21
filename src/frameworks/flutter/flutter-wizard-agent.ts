/* Flutter wizard for Amplitude */
import type { FrameworkConfig } from '../../lib/framework-config';
import { flutterPackageManager } from '../../lib/package-manager-detection';
import { Integration } from '../../lib/constants';
import { detectFlutterProject } from './utils';

type FlutterContext = Record<string, unknown>;

export const FLUTTER_AGENT_CONFIG: FrameworkConfig<FlutterContext> = {
  metadata: {
    name: 'Flutter',
    integration: Integration.flutter,
    autocaptureEnabled: false,
    beta: true,
    docsUrl: 'https://amplitude.com/docs/sdks/analytics/flutter/flutter-sdk-4',
  },

  detection: {
    packageName: 'amplitude_flutter',
    packageDisplayName: 'Flutter',
    usesPackageJson: false,
    getVersion: () => undefined,
    detect: detectFlutterProject,
    detectPackageManager: flutterPackageManager,
  },

  environment: {
    // Flutter apps don't use .env files — API keys are passed via --dart-define
    // or stored in a constants file; the agent handles key storage
    uploadToHosting: false,
    getEnvVars: () => ({}),
  },

  analytics: {
    getTags: () => ({}),
  },

  prompts: {
    projectTypeDetection:
      'This is a Flutter project. Look for pubspec.yaml with a flutter SDK reference, and android/ + ios/ directories.',
    packageInstallation:
      'Use Flutter pub: run `flutter pub add amplitude_flutter` to add the dependency (pubspec.yaml and pubspec.lock are updated automatically).',
    getAdditionalContextLines: () => [
      'Framework docs ID: flutter (use amplitude://docs/frameworks/flutter for documentation)',
      'SDK: amplitude_flutter (pub.dev)',
      'Initialization: final amplitude = Amplitude(Configuration(apiKey: const String.fromEnvironment("AMPLITUDE_API_KEY"))); await amplitude.isBuilt;',
      'Always await amplitude.isBuilt before calling track() or flush()',
      'Store the API key via --dart-define at build time (flutter run --dart-define=AMPLITUDE_API_KEY=...), not hardcoded in source',
    ],
  },

  ui: {
    successMessage: 'Amplitude integration complete',
    estimatedDurationMinutes: 8,
    getOutroChanges: () => [
      'Analyzed your Flutter project structure',
      'Added amplitude_flutter to pubspec.yaml via flutter pub add',
      'Configured Amplitude initialization with default session tracking',
    ],
    getOutroNextSteps: () => [
      'Run your app on a device or simulator to verify the integration',
      'Visit your Amplitude dashboard to see incoming events',
      'Use amplitude.track(BaseEvent("Event Name")) for custom events',
      'Pass the API key at build time: flutter run --dart-define=AMPLITUDE_API_KEY=your_key',
    ],
  },
};
