import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.unit.test.ts',
      'src/routes/auth-throttle.test.ts',
      'src/jobs/webpage-processing.test.ts',
      'src/realtime/realtime-bus.test.ts',
      'src/utils/document-page-selection.test.ts',
      'src/utils/pdf-metadata.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
