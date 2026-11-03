import path from 'path';

export type MediaAssetType = 'IMAGE' | 'VIDEO' | 'DOCUMENT';

const PDF_MIME_TYPES = new Set(['application/pdf']);

const CONVERTIBLE_DOCUMENT_MIME_TYPES = new Set([
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const CONVERTIBLE_DOCUMENT_EXTENSIONS = new Set(['ppt', 'pptx', 'csv', 'doc', 'docx', 'xls', 'xlsx']);

const IMAGE_MIME_PREFIX = 'image/';
const VIDEO_MIME_PREFIX = 'video/';

const normalizeMime = (value?: string | null) => value?.split(';')[0]?.trim().toLowerCase() || null;

const getExtension = (value?: string | null) => {
  if (!value) return null;
  const base = value.split(/[\\/]/).pop() || value;
  const clean = base.split('?')[0]?.split('#')[0] || base;
  const ext = path.extname(clean).replace(/^\./, '').trim().toLowerCase();
  return ext.length > 0 ? ext : null;
};

export function inferUploadMediaType(contentType?: string | null): MediaAssetType {
  const normalizedMime = normalizeMime(contentType);
  if (normalizedMime?.startsWith(VIDEO_MIME_PREFIX)) return 'VIDEO';
  if (normalizedMime?.startsWith(IMAGE_MIME_PREFIX)) return 'IMAGE';
  return 'DOCUMENT';
}

export function isPdfDocument(input: {
  sourceContentType?: string | null;
  filename?: string | null;
  objectKey?: string | null;
}) {
  const normalizedMime = normalizeMime(input.sourceContentType);
  if (normalizedMime && PDF_MIME_TYPES.has(normalizedMime)) {
    return true;
  }

  const extension = getExtension(input.filename) || getExtension(input.objectKey);
  return extension === 'pdf';
}

export function requiresDocumentConversion(input: {
  type?: string | null;
  sourceContentType?: string | null;
  filename?: string | null;
  objectKey?: string | null;
}) {
  if ((input.type || '').toUpperCase() !== 'DOCUMENT') {
    return false;
  }

  if (isPdfDocument(input)) {
    return false;
  }

  const normalizedMime = normalizeMime(input.sourceContentType);
  if (normalizedMime && CONVERTIBLE_DOCUMENT_MIME_TYPES.has(normalizedMime)) {
    return true;
  }

  const extension = getExtension(input.filename) || getExtension(input.objectKey);
  return extension ? CONVERTIBLE_DOCUMENT_EXTENSIONS.has(extension) : false;
}

export function buildSourceFilename(input: {
  fallbackName?: string | null;
  sourceObjectKey?: string | null;
  sourceContentType?: string | null;
}) {
  const objectKeyExt = getExtension(input.sourceObjectKey);
  if (objectKeyExt) {
    return `source.${objectKeyExt}`;
  }

  const normalizedMime = normalizeMime(input.sourceContentType);
  const extFromMime =
    normalizedMime === 'application/pdf'
      ? 'pdf'
      : normalizedMime === 'text/csv'
      ? 'csv'
      : normalizedMime === 'application/msword'
      ? 'doc'
      : normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ? 'docx'
      : normalizedMime === 'application/vnd.ms-powerpoint'
      ? 'ppt'
      : normalizedMime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ? 'pptx'
      : normalizedMime === 'application/vnd.ms-excel'
      ? 'xls'
      : normalizedMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ? 'xlsx'
      : null;

  if (extFromMime) {
    return `source.${extFromMime}`;
  }

  const fallbackExt = getExtension(input.fallbackName);
  return fallbackExt ? `source.${fallbackExt}` : 'source.bin';
}
