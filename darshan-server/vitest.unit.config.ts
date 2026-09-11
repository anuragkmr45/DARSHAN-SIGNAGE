import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Narrow unit-only runner for contracts and pure helpers that do not touch the
 * database. The default vitest.config.ts intentionally keeps a global
 * *_test-database guard for route/repository/integration suites.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test',
    },
    include: [
      'src/contracts/**/*.test.ts',
      'src/services/android-key-attestation.test.ts',
      'src/utils/device-request-auth-mode.test.ts',
      'src/db/test-database-safety.test.ts',
    ],
    exclude: ['node_modules', 'dist', 'drizzle'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
