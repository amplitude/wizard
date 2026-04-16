/**
 * JavaScript (Web) e2e — agent-mode smoke test.
 *
 * Asserts the wizard falls back to the generic JavaScript (Web) integration
 * when the project has a package.json, a lockfile, and an index.html + Vite
 * bundler — but no framework-specific packages. LLM-side assertions are
 * deferred until fixtures are recorded with:
 *   RECORD_FIXTURES=true pnpm test:e2e javascript-web
 */
import { createFrameworkTest } from '../framework-test-creator';

createFrameworkTest({
  name: 'JavaScript (Web)',
  projectDir: 'javascript-web-test-app',
  agentMode: true,
  fixtureFramework: 'javascript-web',
  agentAssertions: {
    expectedFrameworkLabel: 'JavaScript (Web)',
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
  tests: {
    packageJson: [],
    devMode: false,
    build: false,
    prodMode: false,
  },
});
