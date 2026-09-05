import { beforeEach, describe, expect, it, vi } from 'vitest';

const initializeS3 = vi.fn();
const createBucketIfNotExists = vi.fn();

vi.mock('@/s3', () => ({ initializeS3, createBucketIfNotExists }));

describe('production storage bootstrap', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates every required bucket through one idempotent initializer', async () => {
    const { ensureProductionStorage, PRODUCTION_BUCKETS } = await import('./production-storage');
    await ensureProductionStorage();

    expect(initializeS3).toHaveBeenCalledTimes(1);
    expect(createBucketIfNotExists).toHaveBeenCalledTimes(PRODUCTION_BUCKETS.length);
    expect(createBucketIfNotExists).toHaveBeenNthCalledWith(1, 'media-source');
    expect(createBucketIfNotExists).toHaveBeenLastCalledWith('archives');
  });
});
