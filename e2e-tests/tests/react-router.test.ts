/**
 * React Router e2e — agent-mode smoke test.
 *
 * Asserts the wizard detects the test app as React Router v7 Declarative mode
 * (the test app uses `<BrowserRouter>` from `react-router-dom@^7`). LLM-side
 * assertions are deferred until fixtures are recorded with:
 *   RECORD_FIXTURES=true pnpm test:e2e react-router
 */
import { createFrameworkTest } from '../framework-test-creator';

createFrameworkTest({
  name: 'React Router',
  projectDir: 'react-router-test-app',
  agentMode: true,
  fixtureFramework: 'react-router',
  agentAssertions: {
    // gatherContext emits `React Router <mode name>` via setDetectedFramework.
    // The test app pins v7 + `<BrowserRouter>` which maps to V7_DECLARATIVE.
    expectedFrameworkLabel: 'React Router v7 Declarative mode',
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
