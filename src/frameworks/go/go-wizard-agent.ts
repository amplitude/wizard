/* Go wizard for Amplitude */
import type { FrameworkConfig } from '../../lib/framework-config';
import { goPackageManager } from '../../lib/package-manager-detection';
import { Integration } from '../../lib/constants';
import { detectGoProject } from './utils';
import {
  SUCCESS_MESSAGE_INTEGRATION_COMPLETE,
  OUTRO_DASHBOARD_LINE,
  apiKeyAndServerUrlEnv,
  frameworkDocsIdLine,
  noVersionFromPackageJson,
} from '../../lib/framework-shared';

type GoContext = Record<string, unknown>;

export const GO_AGENT_CONFIG: FrameworkConfig<GoContext> = {
  metadata: {
    name: 'Go',
    glyph: '🐹',
    glyphColor: '#00ADD8',
    integration: Integration.go,
    targetsBackend: true,
    beta: true,
    docsUrl: 'https://amplitude.com/docs/sdks/analytics/go/go-sdk',
  },

  detection: {
    packageName: 'github.com/amplitude/analytics-go',
    packageDisplayName: 'Go',
    usesPackageJson: false,
    getVersion: noVersionFromPackageJson,
    detect: detectGoProject,
    detectPackageManager: goPackageManager,
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: apiKeyAndServerUrlEnv,
  },

  analytics: {
    getTags: () => ({}),
  },

  prompts: {
    projectTypeDetection:
      'This is a Go project. Look for go.mod and go.sum to confirm.',
    packageInstallation:
      'Use Go modules: run `go get github.com/amplitude/analytics-go` to add the dependency (go.mod and go.sum are updated automatically).',
    getAdditionalContextLines: () => [
      frameworkDocsIdLine('go'),
      'SDK: github.com/amplitude/analytics-go',
      'Initialization: config := amplitude.NewConfig(os.Getenv("AMPLITUDE_API_KEY")); client := amplitude.NewClient(config)',
      'Always call client.Shutdown() on application exit to flush queued events',
    ],
  },

  ui: {
    successMessage: SUCCESS_MESSAGE_INTEGRATION_COMPLETE,
    estimatedDurationMinutes: 5,
    getOutroChanges: () => [
      'Analyzed your Go project structure',
      'Added github.com/amplitude/analytics-go to go.mod',
      'Configured Amplitude client initialization',
    ],
    getOutroNextSteps: () => [
      'Run your application to verify the integration',
      OUTRO_DASHBOARD_LINE,
      'Use client.Track(amplitude.Event{...}) for custom events',
      'Ensure client.Shutdown() is called on exit to flush queued events',
    ],
  },
};
