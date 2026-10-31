import { describe, it, expect } from 'vitest';
import { assertAttachmentAccess } from '@/chat/attachment-auth';

describe('assertAttachmentAccess', () => {
  it('rejects non-owner without a media override', () => {
    expect(() =>
      assertAttachmentAccess({
        requestedMediaIds: ['m1'],
        mediaRows: [{ id: 'm1', created_by: 'user-b' }],
        senderId: 'user-a',
        canReadMedia: () => true,
        canOverrideMedia: false,
      })
    ).toThrow('You cannot attach this media');
  });

  it('allows a permissioned administrator attaching another user media', () => {
    expect(() =>
      assertAttachmentAccess({
        requestedMediaIds: ['m1'],
        mediaRows: [{ id: 'm1', created_by: 'user-b' }],
        senderId: 'admin-1',
        canReadMedia: () => true,
        canOverrideMedia: true,
      })
    ).not.toThrow();
  });

  it('fails atomically when one attachment is invalid/missing', () => {
    expect(() =>
      assertAttachmentAccess({
        requestedMediaIds: ['m1', 'm2'],
        mediaRows: [{ id: 'm1', created_by: 'user-a' }],
        senderId: 'user-a',
        canReadMedia: () => true,
        canOverrideMedia: false,
      })
    ).toThrow('One or more attachments are invalid');
  });

  it('requires a matching per-media override for every non-owned attachment', () => {
    const input = {
      requestedMediaIds: ['m1', 'm2'],
      mediaRows: [
        { id: 'm1', created_by: 'user-b' },
        { id: 'm2', created_by: 'user-b' },
      ],
      senderId: 'user-a',
      canReadMedia: () => true,
    };

    expect(() => assertAttachmentAccess({ ...input, canOverrideMedia: (media) => media.id === 'm1' }))
      .toThrow('You cannot attach this media');
    expect(() => assertAttachmentAccess({ ...input, canOverrideMedia: (media) => ['m1', 'm2'].includes(media.id) }))
      .not.toThrow();
  });

  it('rejects an unreadable attachment even for its creator or administrator', () => {
    expect(() => assertAttachmentAccess({
      requestedMediaIds: ['m1'],
      mediaRows: [{ id: 'm1', created_by: 'user-a', owner_scope: 'DEPARTMENT', owner_department_id: 'dep-b' }],
      senderId: 'user-a',
      canReadMedia: () => false,
      canOverrideMedia: true,
    })).toThrow('Attachment media is outside your access scope');
  });
});

