/**
 * JavaScript / Node.js e2e — agent-mode smoke test.
 *
 * Asserts the wizard picks the Node.js integration for a plain Express
 * server (no bundler, no index.html, no framework packages). LLM-side
 * assertions are deferred until fixtures are recorded with:
 *   RECORD_FIXTURES=true pnpm test:e2e javascript-node
 */
import { createFrameworkTest } from '../framework-test-creator';

createFrameworkTest({
  name: 'JavaScript (Node)',
  projectDir: 'javascript-node-test-app',
  agentMode: true,
  fixtureFramework: 'javascript-node',
  agentAssertions: {
    expectedFrameworkLabel: 'Node.js',
    expectedEvents: [
      (event) =>
        event.type === 'lifecycle' &&
        (event.data as { event?: string } | undefined)?.event === 'intro',
    ],
  },
  expectedOutput: {
    dev: 'Listening on port',
    prod: 'Listening on port',
  },
  tests: {
    packageJson: [],
    devMode: false,
    build: false,
    prodMode: false,
  },
});
