import { defineConfig } from 'vitest/config';

/**
 * Smoke-lane vitest config. Spawns the real wizard CLI under a PTY and
 * asserts on output. Slow (10-50× a unit test); kept out of `pnpm test`
 * by include-pattern scoping.
 *
 * Run via `pnpm test:smoke:pty`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/smoke/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    // PTY tests spawn a child process per case — the default 5s timeout
    // isn't enough for a cold tsx start on a busy machine.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
