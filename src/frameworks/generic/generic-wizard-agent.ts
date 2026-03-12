/* Generic fallback wizard — used when no framework is auto-detected */
import type { FrameworkConfig } from '../../lib/framework-config';
import { Integration } from '../../lib/constants';
import { detectNodePackageManagers } from '../../lib/package-manager-detection';

export const GENERIC_AGENT_CONFIG: FrameworkConfig = {
  metadata: {
    name: 'Generic',
    integration: Integration.generic,
    docsUrl: 'https://amplitude.com/docs/get-started/amplitude-quickstart',
  },

  detection: {
    packageName: '',
    packageDisplayName: 'Generic',
    usesPackageJson: false,
    getVersion: () => undefined,
    detectPackageManager: detectNodePackageManagers,
    detect: async () => false,
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
    projectTypeDetection: 'n/a',
    buildPrompt: ({ projectApiKey, host, typescript }) => `
You are integrating Amplitude analytics into a project.

Project context:
- Amplitude public API key: ${projectApiKey}
- Amplitude host: ${host}
- TypeScript: ${typescript ? 'Yes' : 'No'}

Instructions (follow IN ORDER):

STEP 1: Understand the project.
Use Glob to list key manifest files (package.json, requirements.txt, Gemfile, go.mod, etc.) and read the main entry point to determine the language and framework.

STEP 2: Fetch the Amplitude quickstart guide.
Use WebFetch to load https://amplitude.com/docs/get-started/amplitude-quickstart.
Based on the project, choose the correct Amplitude SDK (Browser, Node.js, Python, etc.) and fetch its specific docs if needed.

STEP 3: Install the Amplitude SDK.
Use the detect_package_manager tool (from wizard-tools) to find the package manager, then install the appropriate SDK package (e.g. @amplitude/analytics-browser, @amplitude/analytics-node, amplitude-analytics-python).
Run the install as a background task and proceed immediately — do not wait for it.

STEP 4: Initialise Amplitude in the project's main entry point.
Follow the quickstart guide. Reference env vars for the API key and host — never hardcode them.

STEP 5: Add a sample tracking call demonstrating the integration.

STEP 6: Set environment variables using the wizard-tools MCP server.
- Use check_env_keys to see what already exists.
- Use set_env_values to write AMPLITUDE_API_KEY=${projectApiKey} and AMPLITUDE_SERVER_URL=${host}.
  The tool ensures .gitignore coverage automatically.

Important: You must read a file immediately before writing it. Always use environment variables — never hardcode the public token.
`.trim(),
  },

  ui: {
    successMessage: 'Amplitude integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: () => ['Amplitude SDK installed and initialized'],
    getOutroNextSteps: () => [
      'Verify events are appearing in your Amplitude project dashboard',
    ],
  },
};
