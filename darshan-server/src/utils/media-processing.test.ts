import { describe, expect, it } from 'vitest';
import { requiresDocumentConversion } from './media-processing';

describe('requiresDocumentConversion', () => {
  it('sends PDFs through document processing to produce native page renditions', () => {
    expect(
      requiresDocumentConversion({
        type: 'DOCUMENT',
        sourceContentType: 'application/pdf',
        filename: 'manual.pdf',
      })
    ).toBe(true);
  });

  it('does not route non-document media through document processing', () => {
    expect(
      requiresDocumentConversion({
        type: 'IMAGE',
        sourceContentType: 'application/pdf',
        filename: 'not-a-document.pdf',
      })
    ).toBe(false);
  });
});
