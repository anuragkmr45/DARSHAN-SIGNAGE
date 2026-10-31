import { describe, expect, it } from 'vitest';
import { assertAttachmentMediaReady } from './attachment-auth';

describe('chat attachment media readiness', () => {
  it('accepts active READY media', () => {
    expect(() => assertAttachmentMediaReady([
      { id: 'active-media', status: 'READY', deleted_at: null },
    ])).not.toThrow();
  });

  it('rejects soft-deleted media even when its retained status is READY', () => {
    expect(() => assertAttachmentMediaReady([
      { id: 'deleted-media', status: 'READY', deleted_at: new Date() },
    ])).toThrowError(expect.objectContaining({ code: 'MEDIA_NOT_READY' }));
  });
});
