/**
 * Vue e2e — agent-mode smoke test.
 *
 * This test runs the wizard in `--agent` mode and only asserts on events
 * that fire BEFORE the LLM call (framework detection). LLM-dependent
 * assertions (package installs, event plan, dashboards) are NOT exercised
 * here because recording fixtures for Vue's agent flow is a separate task.
 *
 * To add full coverage, record fixtures with:
 *   RECORD_FIXTURES=true pnpm test:e2e vue
 * and then enable the standard test assertions (packageJson, devMode, etc.).
 */
import { createFrameworkTest } from '../framework-test-creator';

createFrameworkTest({
  name: 'Vue',
  projectDir: 'vue-test-app',
  agentMode: true,
  fixtureFramework: 'vue',
  agentAssertions: {
    expectedFrameworkLabel: 'Vue',
    expectedEvents: [
      (event) =>
        event.type === 'lifecycle' &&
        (event.data as { event?: string } | undefined)?.event === 'intro',
    ],
  },
  expectedOutput: {
    dev: 'Local:',
    prod: 'Local:',
  },
  // Defer runtime assertions — they require recorded LLM fixtures and real
  // `pnpm install` of the test app. The detection smoke is useful on its own.
  tests: {
    packageJson: [],
    devMode: false,
    build: false,
    prodMode: false,
  },
});
