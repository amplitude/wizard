import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Allow tests to load bin.ts even when running under another Claude Code
// session — the nested-agent detector would otherwise refuse.
process.env.AMPLITUDE_WIZARD_ALLOW_NESTED = '1';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
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
