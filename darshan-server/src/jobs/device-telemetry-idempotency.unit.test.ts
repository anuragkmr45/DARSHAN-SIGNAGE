import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildProofOfPlayIdempotencyKey } from './device-telemetry';

const base = {
  deviceId: 'device-1',
  mediaId: 'media-1',
  scheduleId: 'schedule-1',
  playbackInstanceId: 'playback-1',
  startTime: '2026-10-15T00:00:00.000Z',
  endTime: '2026-10-15T00:00:10.000Z',
  duration: 10,
  completed: true,
};

describe('proof-of-play page-aware idempotency', () => {
  it('keeps the legacy hash when page metadata is absent', () => {
    const legacyHash = createHash('sha256').update([
      base.deviceId,
      base.mediaId,
      base.scheduleId,
      base.playbackInstanceId,
      base.startTime,
      base.endTime,
      String(base.duration),
      '1',
    ].join('|')).digest('hex');

    expect(buildProofOfPlayIdempotencyKey(base)).toBe(legacyHash);
    expect(buildProofOfPlayIdempotencyKey({ ...base, pageNumber: null })).toBe(legacyHash);
  });

  it('distinguishes different selected pages', () => {
    expect(buildProofOfPlayIdempotencyKey({ ...base, pageNumber: 1 })).not.toBe(
      buildProofOfPlayIdempotencyKey({ ...base, pageNumber: 2 })
    );
  });
});
