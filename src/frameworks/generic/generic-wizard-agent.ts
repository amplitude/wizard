/* Generic fallback wizard — used when no framework is auto-detected */
import type { FrameworkConfig } from '../../lib/framework-config';
import { Integration } from '../../lib/constants';
import { detectNodePackageManagers } from '../../lib/package-manager-detection';
import { BrandColors } from '../../lib/brand-colors';

export const GENERIC_AGENT_CONFIG: FrameworkConfig = {
  metadata: {
    name: 'Generic',
    glyph: '◇',
    glyphColor: BrandColors.gray60,
    integration: Integration.generic,
    docsUrl: 'https://amplitude.com/docs/get-started/amplitude-quickstart',
  },

  detection: {
    packageName: '',
    packageDisplayName: 'Generic',
    usesPackageJson: false,
    getVersion: () => undefined,
    detectPackageManager: detectNodePackageManagers,
    detect: () => Promise.resolve(false),
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
    buildPrompt: ({ projectApiKey, host, typescript }) => {
      // Derive browser-side HTTP API endpoint from the server-side ingestion host.
      // The Browser SDK uses a different endpoint from the server-side SDK.
      const browserApiUrl = host.includes('eu.')
        ? 'https://api.eu.amplitude.com/2/httpapi'
        : 'https://api2.amplitude.com/2/httpapi';

      return `
You are integrating Amplitude analytics into a project.

Project context:
- Amplitude public API key: ${projectApiKey}
- Amplitude server-side host (Node.js / Python / server SDKs): ${host}
- Amplitude browser API URL (Browser SDK / CDN snippet): ${browserApiUrl}
- TypeScript: ${typescript ? 'Yes' : 'No'}

Use [STATUS] <message> at the start of any line to report progress (e.g. "[STATUS] Reading project structure"). These are shown to the user in the terminal.

Instructions (follow IN ORDER):

STEP 1: Check if Amplitude is already integrated.
Search the project for existing Amplitude references (e.g. "amplitude" in source files or templates).
- If Amplitude code is already present: skip to STEP 6 (build verification) and diagnose any issues.
- If not: continue to STEP 2.

STEP 2: Understand the project.
[STATUS] Analysing project structure
Use Glob to list key manifest files (package.json, requirements.txt, Gemfile, go.mod, netlify.toml, config.toml, etc.) and read the main entry point to determine the language and framework.

STEP 3: Choose the SDK and fetch documentation.
[STATUS] Fetching Amplitude documentation
Choose the correct SDK based on the project type, then fetch its docs:

SDK selection (choose the FIRST match):
- Browser / SPA / SSG (JS running in a browser):
    Recommended: @amplitude/unified
      npm install @amplitude/unified
      import { initAll } from '@amplitude/unified';
      initAll(API_KEY, { analytics: { autocapture: true } });
    Alternative: @amplitude/analytics-browser
      npm install @amplitude/analytics-browser
      amplitude.init(API_KEY, { autocapture: { pageViews: true, sessions: true, formInteractions: true, fileDownloads: true } });
    Static site (no build pipeline): CDN snippet — see https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2
- Node.js server:
    npm install @amplitude/analytics-node
    import { init, track, flush } from '@amplitude/analytics-node';
    init(API_KEY); ... await flush().promise;
- Python:
    pip install amplitude-analytics
    from amplitude import Amplitude, BaseEvent
    client = Amplitude(API_KEY)
    client.track(BaseEvent(event_type="Event", user_id="user"))
- EU data residency: pass serverZone: 'EU' (JS) or client.configuration.server_zone = 'EU' (Python)
- Angular: initialize OUTSIDE Angular's zone: ngZone.runOutsideAngular(() => amplitude.init(API_KEY, options))
- SvelteKit/Astro: env var prefix is PUBLIC_ (e.g. PUBLIC_AMPLITUDE_API_KEY)

Env var naming by framework:
- Next.js: NEXT_PUBLIC_AMPLITUDE_API_KEY (browser), AMPLITUDE_API_KEY (server)
- Vite / Vue: VITE_AMPLITUDE_API_KEY
- SvelteKit / Astro: PUBLIC_AMPLITUDE_API_KEY
- Create React App: REACT_APP_AMPLITUDE_API_KEY
- Node.js / Python / generic server: AMPLITUDE_API_KEY

Use WebFetch to load the specific SDK docs if needed for exact API details.

STEP 4: Install and initialise the Amplitude SDK.
[STATUS] Installing Amplitude SDK
If the project uses a package manager: use the detect_package_manager tool to find it, then install the appropriate SDK package as a background task and proceed immediately.
If the project is a static site with no server-side build pipeline (e.g. Zola, Hugo, Jekyll, Eleventy): use the CDN script tag approach instead, and store the API key in the site's config file (e.g. config.toml, config.yaml, _config.yml) — that is the correct pattern for static sites, not a .env file.
For all other projects: reference env vars for the API key — never hardcode them in source files.

Add a sample tracking call demonstrating the integration.

BROWSER SDK / CDN SNIPPET — SERVER URL AND CORS:
When using the Amplitude Browser SDK (whether via CDN <script> tag or npm package in a browser context), you MUST:
1. Set serverUrl to the browser API URL: ${browserApiUrl}
   This is NOT the same as the server-side host. Using the wrong URL will cause CORS errors or silent failures.
   Example initialisation:
     amplitude.init('${projectApiKey}', { serverUrl: '${browserApiUrl}' });
2. If the project is deployed on Netlify (netlify.toml present), add a reverse proxy redirect AND
   CORS headers so events go through the site's own domain (bypasses ad blockers):
   In netlify.toml:
     [[redirects]]
       from = "/amplitude-api/*"
       to = "${
         host.includes('eu.')
           ? 'https://api.eu.amplitude.com'
           : 'https://api2.amplitude.com'
       }/:splat"
       status = 200
       force = true
     [[headers]]
       for = "/amplitude-api/*"
       [headers.values]
         Access-Control-Allow-Origin = "*"
         Access-Control-Allow-Methods = "GET, POST, OPTIONS"
         Access-Control-Allow-Headers = "Content-Type"
   Then set serverUrl to '/amplitude-api/2/httpapi' in the SDK init (or site config file).
3. If the project has a local dev server with a proxy config (Vite, webpack-dev-server, Next.js, etc.),
   add a proxy rule so that requests to /amplitude-api are forwarded to ${browserApiUrl}.
   Then set serverUrl to '/amplitude-api/2/httpapi' in the SDK init.
   Only do this if the framework has a built-in proxy mechanism.
4. If there is no proxy mechanism (plain static site, no dev server, no Netlify), use the direct browserApiUrl.
   CORS is supported by Amplitude's API, so it will work in production. In local development,
   ad blockers or browser extensions may block requests — this is expected and not a code issue.

STEP 4b: Update Content Security Policy (CSP).
[STATUS] Checking Content Security Policy
This is MANDATORY — do not skip it even if the SDK was already present.
Search the entire project for any CSP definitions using Grep:
- Grep for "Content-Security-Policy" across all files
- Also check: netlify.toml, _headers, vercel.json, next.config.*, nginx.conf, .htaccess, any HTML <meta http-equiv="Content-Security-Policy"> tags
If any CSP is found, read the file and add the following to the relevant directives:
- script-src: https://*.amplitude.com
- connect-src: https://*.amplitude.com
Update ALL locations where a CSP is defined (there may be more than one).
If no CSP is found, skip to STEP 5.

STEP 5: Set environment variables (skip for static sites that store config in a site config file).
[STATUS] Writing environment variables
For projects that use env vars: use the wizard-tools MCP server.
- Use check_env_keys to see what already exists.
- Use set_env_values to write the API key and server URL.
  The tool ensures .gitignore coverage automatically.
  Use the naming convention for the framework (e.g. NEXT_PUBLIC_AMPLITUDE_API_KEY for Next.js, VITE_AMPLITUDE_API_KEY for Vite, AMPLITUDE_API_KEY for Node.js/Python/etc.).
  For browser SDK projects, store AMPLITUDE_SERVER_URL=${browserApiUrl}.
  For server-side SDK projects, store AMPLITUDE_SERVER_URL=${host}.

STEP 6: Verify the build.
[STATUS] Verifying build
Run the project's build command and check it exits cleanly:
- Package manager projects: use the detected package manager (e.g. npm run build, pnpm build, cargo build, go build, ./gradlew build)
- Static site generators: run the site's build command (e.g. zola build, hugo, jekyll build, mkdocs build, eleventy)
If the build fails, read the error output, fix the issue, and run it again. Repeat until the build passes or you have exhausted reasonable fixes.

Important: You must read a file immediately before writing it. Always use environment variables — never hardcode the public token.
`.trim();
    },
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
