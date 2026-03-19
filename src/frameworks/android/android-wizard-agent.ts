/* Android wizard for Amplitude */
import type { FrameworkConfig } from '../../lib/framework-config';
import { gradlePackageManager } from '../../lib/package-manager-detection';
import { Integration } from '../../lib/constants';
import { detectAndroidProject, detectAndroidLanguage } from './utils';

type AndroidContext = {
  language?: 'kotlin' | 'java';
};

const ANDROID_PACKAGE_INSTALLATION =
  'Use the detect_package_manager tool to determine the package manager. Add the Amplitude dependency to the app-level build.gradle (Groovy: `implementation \'com.amplitude:analytics-android:1.+\'`) or build.gradle.kts (Kotlin DSL: `implementation("com.amplitude:analytics-android:1.+")`), then sync the project.';

export const ANDROID_AGENT_CONFIG: FrameworkConfig<AndroidContext> = {
  metadata: {
    name: 'Android',
    integration: Integration.android,
    beta: true,
    docsUrl:
      'https://amplitude.com/docs/sdks/analytics/android/android-kotlin-sdk',
    gatherContext: async (options) => {
      const language = await detectAndroidLanguage(options);
      return { language };
    },
  },

  detection: {
    packageName: 'com.amplitude:analytics-android',
    packageDisplayName: 'Android',
    usesPackageJson: false,
    getVersion: () => undefined,
    detect: detectAndroidProject,
    detectPackageManager: gradlePackageManager,
  },

  environment: {
    // Android apps don't use .env files — the agent stores the key in gradle.properties or BuildConfig
    uploadToHosting: false,
    getEnvVars: () => ({}),
  },

  analytics: {
    getTags: (context) => ({
      language: context.language ?? 'unknown',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is an Android project. Look for AndroidManifest.xml, build.gradle / build.gradle.kts, and settings.gradle to confirm.',
    packageInstallation: ANDROID_PACKAGE_INSTALLATION,
    getAdditionalContextLines: (context) => {
      const lang = context.language ?? 'kotlin';
      const initExample =
        lang === 'kotlin'
          ? 'val amplitude = Amplitude(Configuration(apiKey = AMPLITUDE_API_KEY, context = applicationContext))'
          : 'Amplitude amplitude = new Amplitude(new Configuration(AMPLITUDE_API_KEY, getApplicationContext()));';
      return [
        `Language: ${lang === 'kotlin' ? 'Kotlin' : 'Java'}`,
        `Framework docs ID: android (use amplitude://docs/frameworks/android for documentation)`,
        `SDK: com.amplitude:analytics-android — add to app-level build.gradle`,
        `Initialization: ${initExample}`,
        `Never hardcode the API key in source files — store it in gradle.properties or local.properties and read it via BuildConfig`,
      ];
    },
  },

  ui: {
    successMessage: 'Amplitude integration complete',
    estimatedDurationMinutes: 8,
    getOutroChanges: (context) => {
      const lang = context.language === 'java' ? 'Java' : 'Kotlin';
      return [
        `Analyzed your Android (${lang}) project structure`,
        `Added the Amplitude analytics-android dependency to build.gradle`,
        `Configured Amplitude initialization with autocapture`,
      ];
    },
    getOutroNextSteps: () => [
      'Sync your Gradle project and run the app on a device or emulator',
      'Visit your Amplitude dashboard to see incoming events',
      'Use amplitude.track("Event Name") for custom events',
      'Use amplitude.setUserId("user@example.com") to associate events with users',
    ],
  },
};
