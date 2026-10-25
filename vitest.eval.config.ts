import { defineConfig } from 'vitest/config';

// Live local-model evaluation; kept out of `npm test` because it needs a running model.
export default defineConfig({
  test: {
    include: ['eval/**/*.eval.ts'],
    environment: 'node',
    testTimeout: 60 * 60 * 1000,
    // Always print the report (or why no measurements were produced).
    silent: false,
  },
});
