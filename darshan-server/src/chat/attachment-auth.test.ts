import { describe, it, expect } from 'vitest';
import { assertAttachmentAccess } from '@/chat/attachment-auth';

describe('assertAttachmentAccess', () => {
  it('rejects non-owner non-admin attaching another user media', () => {
    expect(() =>
      assertAttachmentAccess({
        requestedMediaIds: ['m1'],
        mediaRows: [{ id: 'm1', created_by: 'user-b', owner_scope: 'DEPARTMENT', owner_department_id: 'dep-1' }],
        senderId: 'user-a',
        senderRole: 'USER',
        senderDepartmentId: 'dep-1',
        canOverrideMedia: false,
        canManageMedia: false,
      })
    ).toThrow('You cannot attach this media');
  });

  it('allows admin attaching another user media', () => {
    expect(() =>
      assertAttachmentAccess({
        requestedMediaIds: ['m1'],
        mediaRows: [{ id: 'm1', created_by: 'user-b', owner_scope: 'DEPARTMENT', owner_department_id: 'dep-1' }],
        senderId: 'admin-1',
        senderRole: 'ADMIN',
        senderDepartmentId: 'dep-1',
        canOverrideMedia: false,
        canManageMedia: true,
      })
    ).not.toThrow();
  });

  it('fails atomically when one attachment is invalid/missing', () => {
    expect(() =>
      assertAttachmentAccess({
        requestedMediaIds: ['m1', 'm2'],
        mediaRows: [{ id: 'm1', created_by: 'user-a', owner_scope: 'DEPARTMENT', owner_department_id: 'dep-1' }],
        senderId: 'user-a',
        senderRole: 'USER',
        senderDepartmentId: 'dep-1',
        canOverrideMedia: false,
        canManageMedia: false,
      })
    ).toThrow('One or more attachments are invalid');
  });

  it('rejects a media ID owned by another department even if the sender can update media', () => {
    expect(() => assertAttachmentAccess({
      requestedMediaIds: ['m1'],
      mediaRows: [{ id: 'm1', created_by: 'user-b', owner_scope: 'DEPARTMENT', owner_department_id: 'dep-2' }],
      senderId: 'user-a',
      senderRole: 'OPERATOR',
      senderDepartmentId: 'dep-1',
      canOverrideMedia: true,
      canManageMedia: false,
    })).toThrow('Attachment media is outside your department scope');
  });

  it('rejects previously owned media after a department transfer', () => {
    expect(() => assertAttachmentAccess({
      requestedMediaIds: ['m1'],
      mediaRows: [{ id: 'm1', created_by: 'user-a', owner_scope: 'DEPARTMENT', owner_department_id: 'dep-1' }],
      senderId: 'user-a',
      senderRole: 'OPERATOR',
      senderDepartmentId: 'dep-2',
      canOverrideMedia: true,
      canManageMedia: false,
    })).toThrow('Attachment media is outside your department scope');
  });

  it('allows department media in scope and organization media to be attached', () => {
    for (const media of [
      { id: 'm1', owner_scope: 'DEPARTMENT', owner_department_id: 'dep-1' },
      { id: 'm1', owner_scope: 'ORGANIZATION', owner_department_id: null },
    ]) {
      expect(() => assertAttachmentAccess({
        requestedMediaIds: ['m1'], mediaRows: [media], senderId: 'user-a',
        senderRole: 'OPERATOR', senderDepartmentId: 'dep-1',
        canOverrideMedia: true, canManageMedia: false,
      })).not.toThrow();
    }
  });
});

