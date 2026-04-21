/* Unreal Engine wizard for Amplitude */
import type { WizardOptions } from '../../utils/types';
import type { FrameworkConfig } from '../../lib/framework-config';
import { unrealPackageManager } from '../../lib/package-manager-detection';
import { Integration } from '../../lib/constants';
import { detectUnrealProject, isAmplitudePluginPresent } from './utils';

type UnrealContext = {
  pluginAlreadyPresent?: boolean;
};

export const UNREAL_AGENT_CONFIG: FrameworkConfig<UnrealContext> = {
  metadata: {
    name: 'Unreal Engine',
    integration: Integration.unreal,
    autocaptureEnabled: false,
    beta: true,
    docsUrl: 'https://amplitude.com/docs/sdks/analytics/unreal/unreal-sdk',
    preRunNotice:
      'Close the Unreal Editor before running the wizard to avoid file conflicts.',
    gatherContext: async (options: WizardOptions) => {
      const pluginAlreadyPresent = await isAmplitudePluginPresent(options);
      return { pluginAlreadyPresent };
    },
  },

  detection: {
    packageName: 'AmplitudeUnreal',
    packageDisplayName: 'Unreal Engine',
    usesPackageJson: false,
    getVersion: () => undefined,
    detect: detectUnrealProject,
    detectPackageManager: unrealPackageManager,
  },

  environment: {
    // API key goes in Config/DefaultEngine.ini — no .env files in Unreal projects
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
      'This is an Unreal Engine project. Look for a .uproject file at the project root to confirm.',
    packageInstallation:
      'There is no package manager for Unreal Engine plugins. Download AmplitudeUnreal.zip from https://github.com/amplitude/Amplitude-Unreal/releases/latest, then extract it into Plugins/AmplitudeUnreal/ inside the project directory. Use Bash to run: mkdir -p Plugins/AmplitudeUnreal && curl -L <release-url> -o /tmp/AmplitudeUnreal.zip && unzip -o /tmp/AmplitudeUnreal.zip -d Plugins/AmplitudeUnreal/',
    getAdditionalContextLines: (context) => {
      const lines = [
        `Framework docs ID: unreal (use amplitude://docs/frameworks/unreal for documentation)`,
        `Plugin: AmplitudeUnreal — manual install into Plugins/AmplitudeUnreal/`,
        `API key storage: Config/DefaultEngine.ini under [Analytics] section`,
        `Required INI settings:`,
        `  [Analytics]`,
        `  ProviderModuleName=Amplitude`,
        `  AmplitudeApiKey=<api_key>`,
        `C++ usage: FAnalytics::Get().GetDefaultConfiguredProvider()->RecordEvent(TEXT("Event Name"));`,
        `IMPORTANT: The Amplitude Unreal plugin only executes on Apple platforms (iOS/macOS/tvOS). On other platforms all calls are no-ops.`,
        `IMPORTANT: No EU data residency, no server zone configuration, and no batch/flush interval settings are available in this SDK.`,
      ];

      if (context.pluginAlreadyPresent) {
        lines.unshift(
          'Amplitude plugin already present at Plugins/AmplitudeUnreal/ — skip download, proceed to INI configuration.',
        );
      }

      return lines;
    },
  },

  ui: {
    successMessage: 'Amplitude integration complete',
    estimatedDurationMinutes: 10,
    getOutroChanges: (context) => [
      context.pluginAlreadyPresent
        ? 'Amplitude plugin was already present — skipped download'
        : 'Downloaded and extracted AmplitudeUnreal plugin into Plugins/AmplitudeUnreal/',
      'Configured AmplitudeApiKey in Config/DefaultEngine.ini',
      'Enabled Amplitude as the analytics provider',
    ],
    getOutroNextSteps: () => [
      'Open the Unreal Editor and enable the plugin: Settings > Plugins > Analytics > AmplitudeUnreal',
      'Rebuild your project from source',
      'Call FAnalytics::Get().GetDefaultConfiguredProvider()->StartSession() on game start',
      'Visit your Amplitude dashboard to see incoming events',
      'Note: events are only sent on iOS, macOS, and tvOS — other platforms are no-ops',
    ],
  },
};
