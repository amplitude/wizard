# API keys and environment variables

## Two cases

### 1. Server-side / private secrets

Server-side write keys for backend SDKs (`@amplitude/analytics-node`, `amplitude-analytics` Python, etc.), OAuth client secrets, service-role tokens. Store in env vars and read via `process.env` / `os.getenv` / equivalent. Use the wizard-tools MCP (`check_env_keys` / `set_env_values`) to manage `.env` / `.env.local` files. Never write these into source.

### 2. Browser-side / public Amplitude API keys

Anything bundled into the user's browser via `@amplitude/unified`, `@amplitude/analytics-browser`, etc. — Amplitude treats browser keys as public; tenant isolation is enforced server-side. Two acceptable patterns:

**a.** If the framework has a built-in env-var convention that surfaces `.env` values to client code **WITHOUT** modifying any build config, use it. Allowed: Vite `import.meta.env.VITE_AMPLITUDE_API_KEY`, Next.js `process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY`, CRA `process.env.REACT_APP_AMPLITUDE_API_KEY`, Astro `import.meta.env.PUBLIC_AMPLITUDE_API_KEY`, Nuxt `useRuntimeConfig().public.amplitudeApiKey`, SvelteKit `PUBLIC_AMPLITUDE_API_KEY` from `$env/static/public`, Expo `Constants.expoConfig?.extra?.amplitudeApiKey`, Angular `environment.amplitudeApiKey`, React Native bare with `react-native-config` (only if already installed). Verify the framework actually applies before using its convention.

**Vite / monorepos:** many repos commit `.env.development` / `.env.production` as non-secret templates. Put `VITE_*` keys in `.env.development.local` / `.env.production.local` (or `.env.local`) via `set_env_values` — never append keys to tracked template files just because they already exist.

**b.** Otherwise, **INLINE** the API key directly in the SDK init call (`amplitude.init('abc123', {...})`). Correct fallback for plain webpack, custom Rollup, vanilla HTML+JS, unfamiliar build tools, or anything not on the list above.

## Never bridge env through build configs

**NEVER** modify build configs to bridge env vars into client code. Off-limits: `webpack.config.*`, `rollup.config.*`, `vite.config.*` (beyond the framework convention), `next.config.*` (beyond declared `env` / `runtimeConfig`), `babel.config.*`, `craco.config.*`, `vue.config.*`, custom build scripts. Adding `webpack.DefinePlugin`, `process.env` aliases, or `.env` loader plumbing is forbidden — even if it would technically work. Don't install third-party glue (`dotenv-webpack` etc.) to make it work either.

**When in doubt, inline.** A working integration with a hardcoded public key beats a broken integration with half-wired env plumbing. Document the choice in the setup report.
