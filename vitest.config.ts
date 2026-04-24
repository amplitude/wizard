import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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
