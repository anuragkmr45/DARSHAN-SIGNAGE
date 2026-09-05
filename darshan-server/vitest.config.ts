import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Route suites use a shared integration database. File-level parallelism
    // makes fleet/count assertions observe unrelated fixtures mid-test.
    fileParallelism: false,
    // The suite mutates a PostgreSQL database. Test workers always run in
    // test mode and globalSetup rejects any DATABASE_URL that is not a
    // dedicated *_test database before test modules execute.
    env: {
      NODE_ENV: 'test',
    },
    globalSetup: './vitest.global-setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'drizzle/',
        '**/*.d.ts',
        '**/*.config.ts',
        '**/index.ts',
      ],
      lines: 70,
      functions: 70,
      branches: 70,
      statements: 70,
    },
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    exclude: ['node_modules', 'dist', 'drizzle'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
