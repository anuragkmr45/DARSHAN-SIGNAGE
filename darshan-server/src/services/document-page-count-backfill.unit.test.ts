import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const returning = vi.fn();
  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ returning })),
    })),
  }));
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit: selectLimit })),
        })),
      })),
    })),
    update,
  };
  return {
    db,
    selectLimit,
    returning,
    update,
    getObject: vi.fn(),
    inspectPdfPageCount: vi.fn(),
  };
});

vi.mock('drizzle-orm', () => ({
  and: (...values: unknown[]) => values,
  asc: (value: unknown) => value,
  eq: (...values: unknown[]) => values,
  gt: (...values: unknown[]) => values,
  inArray: (...values: unknown[]) => values,
  isNull: (value: unknown) => value,
}));

vi.mock('@/db', () => ({
  getDatabase: () => mocks.db,
  schema: {
    media: {
      id: 'media.id',
      type: 'media.type',
      status: 'media.status',
      deleted_at: 'media.deleted_at',
      page_count: 'media.page_count',
    },
    storageObjects: { id: 'storage_objects.id' },
  },
}));
vi.mock('@/s3', () => ({ getObject: mocks.getObject }));
vi.mock('@/utils/pdf-metadata', () => ({ inspectPdfPageCount: mocks.inspectPdfPageCount }));

import { backfillDocumentPageCounts } from './document-page-count-backfill';

describe('backfillDocumentPageCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectLimit.mockResolvedValue([{
      id: '00000000-0000-0000-0000-000000000001',
      source_bucket: 'media-source',
      source_object_key: 'document.pdf',
      ready_object_id: null,
    }]);
    mocks.getObject.mockResolvedValue(Buffer.from('pdf'));
    mocks.inspectPdfPageCount.mockResolvedValue(4);
    mocks.returning.mockResolvedValue([{ id: '00000000-0000-0000-0000-000000000001' }]);
  });

  it('reports discovered page counts without writing during dry-run', async () => {
    const result = await backfillDocumentPageCounts({ apply: false, batchSize: 50 });

    expect(result).toMatchObject({
      inspected: 1,
      updated: 0,
      dry_run: true,
      discovered: [{ media_id: '00000000-0000-0000-0000-000000000001', page_count: 4 }],
      failed: [],
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('writes a discovered count only in apply mode', async () => {
    const result = await backfillDocumentPageCounts({ apply: true, batchSize: 50 });

    expect(result.updated).toBe(1);
    expect(result.dry_run).toBe(false);
    expect(mocks.update).toHaveBeenCalledOnce();
  });
});
