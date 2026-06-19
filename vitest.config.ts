import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    fileParallelism: false, // Run test files sequentially to avoid SQLite locks and race conditions
    poolOptions: {
      threads: {
        singleThread: true, // Run in a single thread
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules',
        'dist',
        'src/test/**',
        '**/*.test.ts',
        'src/server.ts',
        'prisma/**',
      ],
    },
  },
});
