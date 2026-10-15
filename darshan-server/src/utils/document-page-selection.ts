import { AppError } from '@/utils/app-error';

export type MediaWithDocumentPages = {
  id: string;
  type: string;
  status: string;
  page_count?: number | null;
};

function documentPageError(
  code: 'DOCUMENT_PAGE_NOT_APPLICABLE' | 'DOCUMENT_PAGE_COUNT_UNAVAILABLE' | 'DOCUMENT_PAGE_OUT_OF_RANGE',
  media: MediaWithDocumentPages,
  requestedPage: number
) {
  const messages = {
    DOCUMENT_PAGE_NOT_APPLICABLE: 'Page selection only applies to document media.',
    DOCUMENT_PAGE_COUNT_UNAVAILABLE: 'Document page count is not available yet.',
    DOCUMENT_PAGE_OUT_OF_RANGE: 'Selected document page is outside the available range.',
  } as const;
  return new AppError({
    statusCode: 422,
    code,
    message: messages[code],
    details: {
      reason: code,
      media_id: media.id,
      requested_page: requestedPage,
      page_count: media.page_count ?? null,
    },
  });
}

export function normalizeDocumentPage(media: MediaWithDocumentPages, requestedPage?: number): number | null {
  if (media.type !== 'DOCUMENT') {
    if (requestedPage !== undefined) {
      throw documentPageError('DOCUMENT_PAGE_NOT_APPLICABLE', media, requestedPage);
    }
    return null;
  }

  const pageNumber = requestedPage ?? 1;
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
    throw documentPageError('DOCUMENT_PAGE_OUT_OF_RANGE', media, pageNumber);
  }
  if (media.page_count == null) {
    if (pageNumber !== 1) throw documentPageError('DOCUMENT_PAGE_COUNT_UNAVAILABLE', media, pageNumber);
    return 1;
  }
  if (pageNumber > media.page_count) {
    throw documentPageError('DOCUMENT_PAGE_OUT_OF_RANGE', media, pageNumber);
  }
  return pageNumber;
}
