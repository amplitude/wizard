import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Several tests in this suite drive React + ink renders or fake timers
    // that fan out into hundreds-to-thousands of microtasks (RunScreen
    // coaching, DataIngestionCheck timeouts, session-checkpoint label
    // resolution, CreateProjectScreen variants). Solo they finish in
    // 1–7s; under the full parallel pool with fs and node:net contention
    // they routinely cross vitest's 5000ms default and trip the
    // pre-commit hook with non-deterministic flakes that have nothing to
    // do with the change under review. 30s is the empirical headroom that
    // holds across cold runs, hot runs, and the second back-to-back run
    // a pre-commit hook triggers. Tests that need MORE than 30s pass an
    // explicit per-test timeout (e.g. RunScreen coaching uses 90_000ms
    // for its 305s timer-advance scenario).
    testTimeout: 30_000,
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.spec.ts',
      'src/**/*.spec.tsx',
    ],
    exclude: ['dist/**', 'node_modules/**', 'e2e-tests/**', '**/proxy.test.ts'],
    coverage: {
      provider: 'v8',
      exclude: ['dist/**'],
    },
    alias: {
      '@anthropic-ai/claude-agent-sdk': fileURLToPath(
        new URL(
          './__mocks__/@anthropic-ai/claude-agent-sdk.ts',
          import.meta.url,
        ),
      ),
    },
  },
});
