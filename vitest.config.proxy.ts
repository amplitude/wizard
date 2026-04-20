import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/proxy.test.ts'],
    testTimeout: 60_000,
  },
});
