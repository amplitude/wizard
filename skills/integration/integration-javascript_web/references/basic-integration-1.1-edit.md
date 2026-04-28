---
title: Amplitude Setup - Edit
description: Implement Amplitude event tracking in the identified files, following best practices and the example project
---

For each of the files and events noted in .amplitude-events.json, make edits to capture events using Amplitude. Make sure to set up any helper files needed. Carefully examine the included example project code: your implementation should match it as closely as possible. Do not spawn subagents.

For browser/frontend projects, use @amplitude/unified as the default SDK — it bundles Analytics, Session Replay, and Experiment in a single package. Only use @amplitude/analytics-browser if the project already has it installed.

For the Amplitude API key, follow the wizard's env-vs-inline rule (browser keys are public-by-design): use a `.env` / `.env.local` value ONLY if the project's framework has a built-in env-var convention that requires no build-config changes (Vite `VITE_*`, Next.js `NEXT_PUBLIC_*`, Create React App `REACT_APP_*`, Astro `PUBLIC_*`, Nuxt `runtimeConfig.public`, SvelteKit `$env/static/public`, Expo `app.config.js` extras). Otherwise INLINE the key directly in the SDK init call. Do NOT modify `webpack.config.js`, `rollup.config.*`, `vite.config.*`, `babel.config.*`, or any other build config to wire env vars into client code. When in doubt, inline.

Event names MUST use Title Case with spaces following the [Noun] + [Past-Tense Verb] pattern (e.g., "Button Clicked", "Sign Up Completed", "Cart Viewed"). Do NOT use snake_case or camelCase for event names. Property names should use snake_case (e.g., button_text, page_url).

If a file already has existing integration code for other tools or services, don't overwrite or remove that code. Place Amplitude code below it.

For each event, add useful properties, and use your access to the Amplitude source code to ensure correctness. You also have access to documentation about creating new events with Amplitude. Consider this documentation carefully and follow it closely before adding events. Your integration should be based on documented best practices. Carefully consider how the user project's framework version may impact the correct Amplitude integration approach.

Remember that you can find the source code for any dependency in the node_modules directory. This may be necessary to properly populate property names. There are also example project code files available via the Amplitude MCP; use these for reference.

Where possible, add calls for Amplitude's `setUserId()` and `identify()` functions on the client side upon events like logins and signups. Use the contents of login and signup forms to identify users on submit. If there is server-side code, pass a consistent user ID to the server-side code to identify the user. On the server side, make sure events have a matching user ID where relevant.

It's essential to do this in both client code and server code, so that user behavior from both domains is easy to correlate.

Remember: Do not alter the fundamental architecture of existing files. Make your additions minimal and targeted.

Remember the documentation and example project resources you were provided at the beginning. Read them now.

## Framework-specific guidelines

Apply **only** the section that matches your active integration skill. Skip all other sections.

### React — all variants
_Applies to: react-vite, react-react-router-6, react-react-router-7-framework, react-react-router-7-data, react-react-router-7-declarative, react-tanstack-router-file-based, react-tanstack-router-code-based, tanstack-start, nextjs-app-router, nextjs-pages-router_

- For feature flags, use the Amplitude Experiment React SDK hooks (`useVariantValue`, `useExperiment`) — they handle loading states and async fetch automatically
- Add analytics track calls in event handlers where user actions occur, NOT in `useEffect` reacting to state changes
- Do NOT use `useEffect` for data transformation — calculate derived values during render instead
- Do NOT use `useEffect` to respond to user events — put that logic in the event handler itself
- Do NOT use `useEffect` to chain state updates — calculate all related updates together in the event handler
- Do NOT use `useEffect` to notify parent components — call the parent callback alongside `setState` in the event handler
- To reset component state when a prop changes, pass the prop as the component's `key` instead of using `useEffect`
- `useEffect` is ONLY for synchronizing with external systems (non-React widgets, browser APIs, network subscriptions)

### Next.js (in addition to React guidelines above)
_Applies to: nextjs-app-router, nextjs-pages-router_

- For Next.js 15.3+, initialize Amplitude in `instrumentation-client.ts` for the simplest setup

### TanStack Router / TanStack Start (in addition to React guidelines above)
_Applies to: react-tanstack-router-file-based, react-tanstack-router-code-based, tanstack-start_

- Use TanStack Router's built-in navigation events for pageview tracking instead of `useEffect`
- Initialize Amplitude once in the root component — `__root.tsx` (file-based) or wherever `createRootRoute()` is called (code-based)

### TanStack Start (in addition to React and TanStack Router guidelines above)
_Applies to: tanstack-start_

- Use `@amplitude/analytics-node` for server-side event tracking in API routes (`src/routes/api/`) — do NOT use `@amplitude/analytics-browser` on the server
- Create a singleton Amplitude server client to avoid re-initialization on every request

### Angular
_Applies to: angular_

- Use `inject()` instead of constructor injection for Amplitude in components and services
- Create a dedicated `AmplitudeService` as a singleton root service that wraps the SDK
- Always use standalone components over NgModules
- Configure Amplitude credentials in `src/environments/environment.ts` — Angular reads env vars from these config files, not from `process.env`

### SvelteKit
_Applies to: sveltekit_

- Set `paths.relative = false` in `svelte.config.js` if needed for client-side SDK compatibility with SSR
- Use the Svelte MCP server tools to check Svelte documentation (`list-sections`, `get-documentation`) and validate components (`svelte-autofixer`) — run `svelte-autofixer` on every new or modified `.svelte` file before finishing

### Astro — all variants
_Applies to: astro-static, astro-ssr, astro-hybrid, astro-view-transitions_

- Always use the `is:inline` directive on Amplitude script tags to prevent Astro from processing them and causing TypeScript errors
- Use `PUBLIC_` prefix for client-side environment variables (e.g., `PUBLIC_AMPLITUDE_API_KEY`)
- Create an `amplitude.astro` component in `src/components/` for reusable initialization across pages
- Import the Amplitude component in a Layout and wrap all pages with that layout

### Astro View Transitions (in addition to Astro base guidelines above)
_Applies to: astro-view-transitions_

- Wrap Amplitude initialization with a `window.__amplitude_initialized` guard to prevent re-initialization during soft navigation
- Use the `astro:page-load` event instead of just `DOMContentLoaded` to re-run scripts after soft navigation

### Astro SSR / Hybrid (in addition to Astro base guidelines above)
_Applies to: astro-ssr, astro-hybrid_

- Use `@amplitude/analytics-node` in API routes under `src/pages/api/` for server-side event tracking
- Store the Amplitude node client as a singleton in `src/lib/amplitude-server.ts` to avoid creating multiple clients

### Astro Hybrid (in addition to Astro SSR guidelines above)
_Applies to: astro-hybrid_

- In Astro 5, use `output: static` (the default) with an adapter — pages are prerendered by default
- Use `export const prerender = false` to opt specific pages into SSR when they need server-side rendering
- Only pages that need server-side Amplitude tracking (such as API-backed forms) should opt out of prerendering

### Python — all variants
_Applies to: python, django, fastapi, flask_

- `amplitude-analytics` is the Python SDK package name
- Install with `pip install amplitude-analytics` or `pip install -r requirements.txt` — do NOT use unquoted version specifiers like `>=` directly in shell commands
- Always initialize with `Amplitude(api_key)` and configure via `Config()` — do NOT use module-level config
- In CLIs and scripts: MUST call `client.shutdown()` before exit or all events are lost. Register it with `atexit.register(client.shutdown)` to flush on exit.
- NEVER send PII in `track()` event properties (no emails, names, phone numbers, addresses, IPs, or user content). PII belongs in `identify()` user properties only. Safe event properties are metadata like `message_length`, `form_type`, boolean flags.
- Source code for the SDK is available in the `venv/site-packages` directory

### Django (in addition to Python guidelines above)
_Applies to: django_

- Initialize the Amplitude client in `AppConfig.ready()` with the API key from environment variables
- Use a singleton pattern — create the client once and reuse it across requests

### FastAPI (in addition to Python guidelines above)
_Applies to: fastapi_

- Initialize Amplitude in the `lifespan` context manager on startup; call `await amplitude.flush()` on shutdown
- Use Pydantic Settings with `@lru_cache` on `get_settings()` for caching and easy test overrides
- Use FastAPI dependency injection (`Depends`) for accessing `current_user` and settings in route handlers

### Flask (in addition to Python guidelines above)
_Applies to: flask_

- Initialize Amplitude globally in `create_app()` (NOT per-request)
- Blueprint registration happens AFTER Amplitude initialization in `create_app()`

### JavaScript Node
_Applies to: javascript_node_

- `@amplitude/analytics-node` is the server-side SDK — do NOT use `@amplitude/analytics-browser` on the server
- Track events in route handlers for meaningful user actions; every route that creates, updates, or deletes data should track an event
- In long-running servers the SDK batches automatically — do NOT set `flushQueueSize` or `flushIntervalMillis` unless you have a specific reason
- For short-lived processes (scripts, CLIs, serverless): call `await amplitude.flush()` before exit
- Reverse proxy is NOT needed for server-side Node.js — only client-side JS may benefit from one to avoid ad blockers
- Source code is available in the `node_modules` directory

### JavaScript Web
_Applies to: javascript_web_

- `@amplitude/analytics-browser` is the browser SDK — do NOT import it in Node.js or server-side contexts
- `amplitude.init()` MUST be called before any other Amplitude methods
- Autocapture is available via the autocapture plugin but is NOT enabled by default — opt in explicitly if requested
- Call `amplitude.reset()` on logout to unlink future events from the current user
- For SPAs without a framework router, use the `pageViewTracking` option in `amplitude.init()` or manually call `amplitude.track('Page Viewed', { path })` for History API routing

### Android
_Applies to: android_

- Adapt dependency configuration to the appropriate `build.gradle(.kts)` file for the project's Gradle version
- Initialize Amplitude in the `Application` class's `onCreate()`: `Amplitude(Configuration(apiKey = ..., context = applicationContext)).also { amplitude = it }` — call this only once
- Ensure every activity has an `android:label` to accurately track screen views

### Swift
_Applies to: swift_

- Read configuration from environment variables via a dedicated enum using `ProcessInfo.processInfo.environment`; fatalError if `AMPLITUDE_API_KEY` is missing
- When adding SPM dependencies to `project.pbxproj`, create three distinct objects with unique UUIDs: a `PBXBuildFile` (with `productRef`), an `XCSwiftPackageProductDependency` (with `package` and `productName`), and an `XCRemoteSwiftPackageReference` (with `repositoryURL` and `requirement`)
- Check the latest release at https://github.com/amplitude/Amplitude-Swift/releases before setting `minimumVersion` — do not hardcode a stale version
- For macOS with App Sandbox: add `ENABLE_OUTGOING_NETWORK_CONNECTIONS = YES` to build settings — do NOT disable the sandbox

### React Native
_Applies to: react-native_

- `@amplitude/analytics-react-native` is the SDK package name
- Use `react-native-config` to load `AMPLITUDE_API_KEY` from `.env` (embedded at build time, not runtime)
- Requires `@react-native-async-storage/async-storage` and `@react-native-community/netinfo` as peer dependencies — install them alongside the SDK
- Initialize Amplitude once at the top level (e.g., `App.tsx`) before any track calls

### Expo
_Applies to: expo_

- `@amplitude/analytics-react-native` is the SDK package name (same as bare RN)
- Use `expo-constants` with `app.config.js` extras for `AMPLITUDE_API_KEY` (NOT `react-native-config`)
- Access it via `Constants.expoConfig?.extra?.amplitudeApiKey`
- For `expo-router`, initialize Amplitude in `app/_layout.tsx` and track screen views manually: `amplitude.track('Screen Viewed', { screen: pathname })`
- Requires `@react-native-async-storage/async-storage` and `@react-native-community/netinfo` as peer dependencies

### Ruby
_Applies to: ruby, ruby-on-rails_

- `amplitude-api` gem (`gem 'amplitude-api'` in Gemfile)
- Use `AmplitudeAPI::Event` and `AmplitudeAPI.send_event`; initialize with `AmplitudeAPI.config.api_key`
- Events take `user_id`, `event_type`, and `event_properties` hash
- Ensure events are flushed before exit; use `begin/rescue/ensure` for cleanup

### Ruby on Rails (in addition to Ruby guidelines above)
_Applies to: ruby-on-rails_

- Initialize AmplitudeAPI in `config/initializers/amplitude.rb`
- Create a dedicated service class for Amplitude tracking to keep controllers clean
- Use background jobs for non-critical tracking to avoid slowing down request handling

### Laravel
_Applies to: laravel_

- Create a dedicated `AmplitudeService` in `app/Services/` — do NOT scatter track calls throughout controllers
- Register Amplitude config in `config/amplitude.php` using `env()` for all settings
- Do NOT use Laravel's event system or observers for analytics — call track explicitly where actions occur
- `amplitude/amplitude-php` is the PHP SDK package (community gem — check `composer.json` for availability)
- Source code is available in the `vendor` directory after `composer install`
- Initialize the Amplitude client once with your API key and reuse it throughout the application

## Status

Status to report in this phase:

- Inserting Amplitude track code
- A status message for each file whose edits you are planning, including a high level summary of changes
- A status message for each file you have edited


---

**Upon completion, continue with:** [basic-integration-1.2-revise.md](basic-integration-1.2-revise.md)