import { describe, expect, it, vi } from 'vitest';
import { commitReadyMediaIfProcessing, failMediaIfProcessing } from './media-processing-state';

function updateExecutor(options: {
  updateResult?: Array<{ id: string }>;
  current?: { status: string; ready_object_id: string | null; deleted_at?: Date | null } | null;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const where = vi.fn(() => ({
    returning: vi.fn(async () => options.updateResult ?? []),
  }));
  const executor = {
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push(values);
        return { where };
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => (options.current ? [options.current] : [])),
      })),
    })),
  };
  return { executor: executor as any, updates };
}

describe('media processing state commit', () => {
  it('commits READY only through the PROCESSING compare-and-set', async () => {
    const { executor, updates } = updateExecutor({ updateResult: [{ id: 'media-1' }] });
    const compensate = vi.fn();

    await expect(commitReadyMediaIfProcessing({
      mediaId: 'media-1',
      readyObjectId: 'ready-1',
      values: { page_count: 4 },
      executor,
      compensateStaleResult: compensate,
    })).resolves.toBe('COMMITTED');

    expect(updates[0]).toMatchObject({
      ready_object_id: 'ready-1',
      page_count: 4,
      status: 'READY',
      status_reason: null,
    });
    expect(compensate).not.toHaveBeenCalled();
  });

  it('does not clean the object committed by an idempotent duplicate worker', async () => {
    const { executor } = updateExecutor({
      current: { status: 'READY', ready_object_id: 'ready-1' },
    });
    const compensate = vi.fn();

    await expect(commitReadyMediaIfProcessing({
      mediaId: 'media-1',
      readyObjectId: 'ready-1',
      executor,
      compensateStaleResult: compensate,
    })).resolves.toBe('ALREADY_COMMITTED');
    expect(compensate).not.toHaveBeenCalled();
  });

  it('compensates a late result after deletion won and preserves deletion failure state', async () => {
    const { executor } = updateExecutor({
      current: { status: 'FAILED', ready_object_id: null },
    });
    const compensate = vi.fn().mockResolvedValue(undefined);

    await expect(commitReadyMediaIfProcessing({
      mediaId: 'media-1',
      readyObjectId: 'ready-1',
      executor,
      compensateStaleResult: compensate,
    })).resolves.toBe('STALE');
    expect(compensate).toHaveBeenCalledOnce();

    await expect(failMediaIfProcessing({
      mediaId: 'media-1',
      statusReason: 'DOCUMENT_CONVERSION_FAILED',
      executor,
    })).resolves.toBe(false);
  });

  it('does not classify a deleted READY row as an idempotent worker success', async () => {
    const { executor } = updateExecutor({
      current: { status: 'READY', ready_object_id: 'ready-1', deleted_at: new Date() },
    });
    const compensate = vi.fn().mockResolvedValue(undefined);

    await expect(commitReadyMediaIfProcessing({
      mediaId: 'media-1',
      readyObjectId: 'ready-1',
      executor,
      compensateStaleResult: compensate,
    })).resolves.toBe('STALE');
    expect(compensate).toHaveBeenCalledOnce();
  });
});
