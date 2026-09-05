import 'dotenv/config';
import { assertDedicatedTestDatabase } from './src/db/test-database-safety';

export default function setupVitestDatabaseSafety() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'Vitest requires DATABASE_URL to point to a dedicated *_test database. Run npm run test:integration with TEST_DATABASE_URL set.'
    );
  }

  assertDedicatedTestDatabase(databaseUrl, 'Vitest');
}
