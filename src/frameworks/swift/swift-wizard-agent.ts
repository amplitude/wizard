/* Swift (iOS/macOS) wizard for Amplitude */
import type { FrameworkConfig } from '../../lib/framework-config';
import { swiftPackageManager } from '../../lib/package-manager-detection';
import { Integration } from '../../lib/constants';
import { detectSwiftProject, detectSwiftPackageManager } from './utils';
import type { SwiftPackageManager } from './utils';

type SwiftContext = {
  packageManager?: SwiftPackageManager;
};

const SWIFT_PACKAGE_INSTALLATION =
  "Use the detect_package_manager tool to determine the package manager. For Swift Package Manager: add the dependency via Xcode (File > Add Package Dependencies) using the URL https://github.com/amplitude/AmplitudeUnified-Swift, or by editing Package.swift. For CocoaPods: add `pod 'AmplitudeUnified'` to the Podfile and run pod install.";

export const SWIFT_AGENT_CONFIG: FrameworkConfig<SwiftContext> = {
  metadata: {
    name: 'Swift',
    integration: Integration.swift,
    beta: true,
    docsUrl: 'https://amplitude.com/docs/sdks/analytics/ios/unified-sdk',
    preRunNotice:
      'Close Xcode before running the wizard to avoid file conflicts.',
    gatherContext: (options) => {
      const packageManager = detectSwiftPackageManager(options);
      return Promise.resolve({ packageManager });
    },
  },

  detection: {
    packageName: 'AmplitudeUnified',
    packageDisplayName: 'Swift',
    usesPackageJson: false,
    getVersion: () => undefined,
    detect: detectSwiftProject,
    detectPackageManager: swiftPackageManager,
  },

  environment: {
    // iOS/macOS apps don't use .env files — the agent stores the key in the project
    uploadToHosting: false,
    getEnvVars: () => ({}),
  },

  analytics: {
    getTags: (context) => ({
      packageManager: context.packageManager ?? 'unknown',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a Swift/iOS/macOS project. Look for *.xcodeproj directories, Podfile, Package.swift, or .swift source files to confirm.',
    packageInstallation: SWIFT_PACKAGE_INSTALLATION,
    getAdditionalContextLines: (context) => {
      const pm = context.packageManager ?? 'spm';
      return [
        `Package manager: ${
          pm === 'cocoapods' ? 'CocoaPods' : 'Swift Package Manager'
        }`,
        `Framework docs ID: swift (use amplitude://docs/frameworks/swift for documentation)`,
        `SDK: AmplitudeUnified — Swift package URL: https://github.com/amplitude/AmplitudeUnified-Swift`,
        `Initialization: let amplitude = Amplitude(apiKey: "YOUR_API_KEY", analyticsConfig: AnalyticsConfig(autocapture: [.sessions, .appLifecycles, .screenViews]))`,
        `Never hardcode the API key in source files — store it in a .xcconfig file or Info.plist and read it at runtime`,
      ];
    },
  },

  ui: {
    successMessage: 'Amplitude integration complete',
    estimatedDurationMinutes: 8,
    getOutroChanges: (context) => {
      const pmLabel =
        context.packageManager === 'cocoapods'
          ? 'CocoaPods'
          : 'Swift Package Manager';
      return [
        `Analyzed your Swift project structure`,
        `Added the AmplitudeUnified package via ${pmLabel}`,
        `Configured Amplitude with autocapture for sessions, app lifecycles, and screen views`,
      ];
    },
    getOutroNextSteps: () => [
      'Build and run your app in the simulator to verify the integration',
      'Visit your Amplitude dashboard to see incoming events',
      'Use amplitude.track(eventType:eventProperties:) for custom events',
      'Use amplitude.setUserId(userId:) to associate events with users',
    ],
  },
};
