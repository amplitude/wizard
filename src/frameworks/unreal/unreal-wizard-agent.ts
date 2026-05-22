/* Unreal Engine wizard for Amplitude */
import type { WizardOptions } from '../../utils/types';
import type { FrameworkConfig } from '../../lib/framework-config';
import { unrealPackageManager } from '../../lib/package-manager-detection';
import { Integration } from '../../lib/constants';
import { BrandColors } from '../../lib/brand-colors';
import { detectUnrealProject, isAmplitudePluginPresent } from './utils';
import {
  SUCCESS_MESSAGE_INTEGRATION_COMPLETE,
  OUTRO_DASHBOARD_LINE,
  emptyEnv,
  frameworkDocsIdLine,
  noVersionFromPackageJson,
} from '../../lib/framework-shared';

type UnrealContext = {
  pluginAlreadyPresent?: boolean;
};

export const UNREAL_AGENT_CONFIG: FrameworkConfig<UnrealContext> = {
  metadata: {
    name: 'Unreal Engine',
    glyph: '🎬',
    glyphColor: BrandColors.gray40,
    integration: Integration.unreal,
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
    getVersion: noVersionFromPackageJson,
    detect: detectUnrealProject,
    detectPackageManager: unrealPackageManager,
  },

  environment: {
    // API key goes in Config/DefaultEngine.ini — no .env files in Unreal projects
    uploadToHosting: false,
    getEnvVars: emptyEnv,
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
        frameworkDocsIdLine('unreal'),
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
    successMessage: SUCCESS_MESSAGE_INTEGRATION_COMPLETE,
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
      OUTRO_DASHBOARD_LINE,
      'Note: events are only sent on iOS, macOS, and tvOS — other platforms are no-ops',
    ],
  },
};
