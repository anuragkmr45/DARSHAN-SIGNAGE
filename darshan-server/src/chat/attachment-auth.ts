import { AppError } from '@/utils/app-error';

type MediaScopeRow = {
  id: string;
  created_by?: string | null;
  createdBy?: string | null;
  owner_scope?: string | null;
  owner_department_id?: string | null;
  status?: string | null;
};

type AttachmentAuthInput = {
  requestedMediaIds: string[];
  mediaRows: MediaScopeRow[];
  senderId: string;
  canReadMedia: (media: MediaScopeRow) => boolean;
  canOverrideMedia: boolean | ((media: MediaScopeRow) => boolean);
};

export function assertAttachmentAccess(input: AttachmentAuthInput): void {
  if (input.mediaRows.length !== input.requestedMediaIds.length) {
    throw AppError.badRequest('One or more attachments are invalid');
  }

  for (const media of input.mediaRows) {
    if (!input.canReadMedia(media)) {
      throw AppError.forbidden('Attachment media is outside your access scope');
    }
    const ownerId = media.created_by ?? media.createdBy ?? null;
    const isOwner = ownerId === input.senderId;
    const canOverride = typeof input.canOverrideMedia === 'function'
      ? input.canOverrideMedia(media)
      : input.canOverrideMedia;
    if (!isOwner && !canOverride) {
      throw AppError.forbidden('You cannot attach this media');
    }
  }
}

export function assertAttachmentMediaReady(
  mediaRows: Array<Pick<MediaScopeRow, 'id' | 'status'>>,
  allowedStatuses: string[] = ['READY']
): void {
  const allowed = new Set(allowedStatuses);
  const notReady = mediaRows.filter((row) => !row.status || !allowed.has(row.status));
  if (notReady.length === 0) return;

  throw new AppError({
    statusCode: 409,
    code: 'MEDIA_NOT_READY',
    message: 'One or more attachments are not ready',
    details: { media_ids: notReady.map((row) => row.id) },
  });
}
