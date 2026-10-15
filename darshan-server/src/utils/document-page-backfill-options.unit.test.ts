import { describe, expect, it } from 'vitest';
import { resolveDocumentPageBackfillOptions } from './document-page-backfill-options';

describe('resolveDocumentPageBackfillOptions', () => {
  it('defaults to a read-only run', () => {
    expect(resolveDocumentPageBackfillOptions({})).toEqual({ apply: false, batchSize: 50 });
  });

  it('requires an explicit apply flag and accepts bounded batches', () => {
    expect(resolveDocumentPageBackfillOptions({ apply: true, batchSize: '500' })).toEqual({
      apply: true,
      batchSize: 500,
    });
  });

  it.each(['0', '501', '1.5', 'invalid'])('rejects an unsafe batch size %s', (batchSize) => {
    expect(() => resolveDocumentPageBackfillOptions({ batchSize })).toThrow(
      '--batch-size must be an integer between 1 and 500'
    );
  });
});
