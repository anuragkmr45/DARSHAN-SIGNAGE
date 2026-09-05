import { createBucketIfNotExists, initializeS3 } from '@/s3';
import { PRODUCTION_BUCKETS } from './storage-buckets';

/**
 * Buckets are deployment state, not an incidental effect of a web/worker
 * process starting. Keep the complete list in one idempotent initializer so a
 * fresh installation can prove storage readiness before accepting traffic.
 */
export { PRODUCTION_BUCKETS };

export async function ensureProductionStorage(): Promise<void> {
  initializeS3();
  for (const bucket of PRODUCTION_BUCKETS) {
    await createBucketIfNotExists(bucket);
  }
}
