import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    environmentMatchGlobs: [
      ['**/*.test.tsx', 'jsdom'],
    ],
  },
});
