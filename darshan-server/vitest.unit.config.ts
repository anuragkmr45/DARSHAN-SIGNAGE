import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.unit.test.ts',
      'src/routes/auth-throttle.test.ts',
      'src/realtime/realtime-bus.test.ts',
      'src/utils/document-page-selection.test.ts',
      'src/utils/pdf-metadata.test.ts',
      'src/utils/runtime-dependencies.test.ts',
      'src/utils/resolved-media.test.ts',
      'src/utils/pdf-render.unit.test.ts',
      'src/services/webhook-test-delivery.test.ts',
      'src/deployment/production-command-contracts.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
