import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts', 'test/body-store.test.ts', 'test/product-ownership.test.ts',
      'test/rate-limit.test.ts', 'test/ownership-boundaries.test.ts', 'test/request-validation.test.ts',
      'test/image-upload-boundaries.test.ts', 'test/deletion-states.test.ts', 'test/voice-cache-privacy.test.ts',
      'test/consents.test.ts', 'test/registration-store.test.ts', 'test/integrated-migrations.test.ts'],
    setupFiles: ['test/integration.setup.ts'],
    pool: 'forks', maxWorkers: 1, fileParallelism: false,
    testTimeout: 30_000, hookTimeout: 30_000,
  },
});
