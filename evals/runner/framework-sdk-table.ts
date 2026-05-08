/**
 * Framework → SDK family mapping.
 *
 * Source of truth for criterion 1 ("correct SDK package family"). The
 * project rule is global: browser frameworks use `@amplitude/unified`,
 * Node-side servers use `@amplitude/analytics-node`, mobile uses the
 * platform-native SDK. Encoding this here means a per-scenario typo in
 * `expectedSdkPackage` can't silently flip Layer 0 into a false pass —
 * a scenario that wants to diverge has to opt in via
 * `sdkOverrideReason` (see `scenario-schema.ts`).
 *
 * Keyed on `integrationHint` from `scenario.json`, which mirrors the
 * `Integration` enum in `src/lib/constants.ts`. Add an entry for every
 * new Ring 1/2 framework before its scenario lands.
 */

export const FRAMEWORK_TO_SDK: Record<string, string> = {
  // Browser frameworks — `@amplitude/unified` per project rule
  // (see `src/frameworks/*/`-wizard-agent.ts and `skills/integration/*/`).
  nextjs: '@amplitude/unified',
  'nextjs-app-router': '@amplitude/unified',
  'nextjs-pages-router': '@amplitude/unified',
  vue: '@amplitude/unified',
  react: '@amplitude/unified',
  'react-vite': '@amplitude/unified',
  // The wizard's `Integration` enum exposes a single `react-router` value;
  // the `*-7-*` and `-6` keys here are evals-side aliases that scenarios
  // may carry as a richer ground-truth hint than the CLI accepts. They
  // resolve to the same SDK family.
  'react-router': '@amplitude/unified',
  'react-router-6': '@amplitude/unified',
  'react-router-7-data': '@amplitude/unified',
  'react-router-7-declarative': '@amplitude/unified',
  'react-router-7-framework': '@amplitude/unified',
  // JS/Web fallback (CDN-style, no detected framework) — same family.
  javascript_web: '@amplitude/unified',

  // Server / non-browser JS.
  javascript_node: '@amplitude/analytics-node',

  // Mobile / native — packaged via platform-native channels, but the
  // string form here is what the eval expects to see in package
  // manifests / dependency files. Mobile scorers treat this as a
  // fingerprint to grep for.
  swift: 'AmplitudeSwift',
  android: 'com.amplitude:analytics-android',
  flutter: 'amplitude_flutter',
  'react-native': '@amplitude/analytics-react-native',
  // Expo apps ship the React Native SDK — same package, same scorer
  // surface. There's no `expo` entry in the wizard's Integration enum
  // yet (see skill / detector drift sidebar in docs/evals.md), so live
  // runs of this scenario will fail at `--integration expo`. The Ring 1
  // golden replay still grades the integration shape correctly.
  expo: '@amplitude/analytics-react-native',

  // Server frameworks (non-JS).
  python: 'amplitude-analytics',
  django: 'amplitude-analytics',
  flask: 'amplitude-analytics',
  fastapi: 'amplitude-analytics',
  go: 'github.com/amplitude/analytics-go',
  java: 'com.amplitude:java-sdk',

  // Game engines.
  unity: 'com.amplitude.unity',
  unreal: 'AmplitudeUnreal',

  // Generic / unknown — Layer 0 expects @amplitude/unified for the
  // unknown-framework probe (a stripped React+Vite app should still
  // land on the browser SDK family).
  generic: '@amplitude/unified',
};
