/* Go wizard for Amplitude */
import type { FrameworkConfig } from '../../lib/framework-config';
import { goPackageManager } from '../../lib/package-manager-detection';
import { Integration } from '../../lib/constants';
import { detectGoProject } from './utils';

type GoContext = Record<string, unknown>;

export const GO_AGENT_CONFIG: FrameworkConfig<GoContext> = {
  metadata: {
    name: 'Go',
    integration: Integration.go,
    autocaptureEnabled: false,
    beta: true,
    docsUrl: 'https://amplitude.com/docs/sdks/analytics/go/go-sdk',
  },

  detection: {
    packageName: 'github.com/amplitude/analytics-go',
    packageDisplayName: 'Go',
    usesPackageJson: false,
    getVersion: () => undefined,
    detect: detectGoProject,
    detectPackageManager: goPackageManager,
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey, host) => ({
      AMPLITUDE_API_KEY: apiKey,
      AMPLITUDE_SERVER_URL: host,
    }),
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
      'Framework docs ID: go (use amplitude://docs/frameworks/go for documentation)',
      'SDK: github.com/amplitude/analytics-go',
      'Initialization: config := amplitude.NewConfig(os.Getenv("AMPLITUDE_API_KEY")); client := amplitude.NewClient(config)',
      'Always call client.Shutdown() on application exit to flush queued events',
    ],
  },

  ui: {
    successMessage: 'Amplitude integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: () => [
      'Analyzed your Go project structure',
      'Added github.com/amplitude/analytics-go to go.mod',
      'Configured Amplitude client initialization',
    ],
    getOutroNextSteps: () => [
      'Run your application to verify the integration',
      'Visit your Amplitude dashboard to see incoming events',
      'Use client.Track(amplitude.Event{...}) for custom events',
      'Ensure client.Shutdown() is called on exit to flush queued events',
    ],
  },
};
