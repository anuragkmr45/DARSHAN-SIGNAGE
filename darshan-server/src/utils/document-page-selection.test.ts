import { describe, expect, it } from 'vitest';
import { normalizeDocumentPage } from '@/utils/document-page-selection';

const documentMedia = { id: 'doc-1', type: 'DOCUMENT', status: 'READY', page_count: 5 };

describe('normalizeDocumentPage', () => {
  it('defaults documents to page one and accepts the last physical page', () => {
    expect(normalizeDocumentPage(documentMedia)).toBe(1);
    expect(normalizeDocumentPage(documentMedia, 5)).toBe(5);
  });

  it.each([0, -1, 1.5, 6])('rejects invalid or out-of-range page %s', (page) => {
    expect(() => normalizeDocumentPage(documentMedia, page)).toThrowError(
      expect.objectContaining({ code: 'DOCUMENT_PAGE_OUT_OF_RANGE' })
    );
  });

  it('allows only page one while a legacy document count is unavailable', () => {
    expect(normalizeDocumentPage({ ...documentMedia, page_count: null })).toBe(1);
    expect(() => normalizeDocumentPage({ ...documentMedia, page_count: null }, 2)).toThrowError(
      expect.objectContaining({ code: 'DOCUMENT_PAGE_COUNT_UNAVAILABLE' })
    );
  });

  it('rejects page metadata for non-document media', () => {
    expect(normalizeDocumentPage({ ...documentMedia, type: 'IMAGE' })).toBeNull();
    expect(() => normalizeDocumentPage({ ...documentMedia, type: 'IMAGE' }, 1)).toThrowError(
      expect.objectContaining({ code: 'DOCUMENT_PAGE_NOT_APPLICABLE' })
    );
  });
});
