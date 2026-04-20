/* Unity wizard for Amplitude */
import type { WizardOptions } from '../../utils/types';
import type { FrameworkConfig } from '../../lib/framework-config';
import { unityPackageManager } from '../../lib/package-manager-detection';
import { Integration } from '../../lib/constants';
import { detectUnityProject, isAmplitudePluginPresent } from './utils';

type UnityContext = {
  pluginAlreadyPresent?: boolean;
};

export const UNITY_AGENT_CONFIG: FrameworkConfig<UnityContext> = {
  metadata: {
    name: 'Unity',
    integration: Integration.unity,
    beta: true,
    docsUrl: 'https://amplitude.com/docs/sdks/analytics/unity/unity-sdk',
    preRunNotice:
      'Close the Unity Editor before running the wizard to avoid file conflicts.',
    gatherContext: (options: WizardOptions) => {
      const pluginAlreadyPresent = isAmplitudePluginPresent(options);
      return Promise.resolve({ pluginAlreadyPresent });
    },
  },

  detection: {
    packageName: 'com.amplitude.unity-plugin',
    packageDisplayName: 'Unity',
    usesPackageJson: false,
    getVersion: () => undefined,
    detect: detectUnityProject,
    detectPackageManager: unityPackageManager,
  },

  environment: {
    // Unity C# doesn't read from .env files — API key is stored in a
    // ScriptableObject, Resources asset, or directly in initialization code
    uploadToHosting: false,
    getEnvVars: () => ({}),
  },

  analytics: {
    getTags: (context) => ({
      pluginAlreadyPresent: context.pluginAlreadyPresent ? 'true' : 'false',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a Unity project. Look for ProjectSettings/ProjectVersion.txt to confirm.',
    packageInstallation:
      'Install via Unity Package Manager by editing Packages/manifest.json: add "com.amplitude.unity-plugin": "https://github.com/amplitude/unity-plugin.git?path=/Assets" to the dependencies object. Do not use npm or any other package manager.',
    getAdditionalContextLines: (context) => {
      const lines = [
        `Framework docs ID: unity (use amplitude://docs/frameworks/unity for documentation)`,
        `SDK: amplitude/unity-plugin — install via UPM git URL in Packages/manifest.json`,
        `Initialization (C#):`,
        `  Amplitude amplitude = Amplitude.getInstance();`,
        `  amplitude.setServerUrl("https://api2.amplitude.com");`,
        `  amplitude.trackSessionEvents(true);`,
        `  amplitude.init("YOUR_API_KEY");`,
        `Event tracking: amplitude.logEvent("Button Clicked", new Dictionary<string, object> {{ "key", "value" }});`,
        `EU data residency (SDK 2.4.0+): amplitude.setServerZone(AmplitudeServerZone.EU);`,
        `Store the API key in a Unity ScriptableObject or Resources asset — never hardcode it in a file committed to source control`,
        `NOT supported: WebGL, Unity Editor-only builds`,
      ];

      if (context.pluginAlreadyPresent) {
        lines.unshift(
          'Amplitude plugin is already present — skip installation, proceed to initialization.',
        );
      }

      return lines;
    },
  },

  ui: {
    successMessage: 'Amplitude integration complete',
    estimatedDurationMinutes: 8,
    getOutroChanges: (context) => [
      context.pluginAlreadyPresent
        ? 'Amplitude plugin was already present — skipped installation'
        : 'Added amplitude/unity-plugin to Packages/manifest.json via UPM',
      'Configured Amplitude initialization in a C# script',
      'Added event tracking calls',
    ],
    getOutroNextSteps: () => [
      'Open the Unity Editor — it will automatically resolve and download the package',
      'Attach the Amplitude initialization script to a persistent GameObject (e.g. GameManager)',
      'Visit your Amplitude dashboard to see incoming events',
      'Use amplitude.logEvent("Event Name") for custom events',
      'Note: WebGL builds are not supported',
    ],
  },
};
