import { describe, expect, it } from 'vitest';
import {
  extractDefaultMediaTargets,
  selectDefaultMediaTargetAssignment,
  type DefaultMediaTargetAssignmentRecord,
} from '@/utils/default-media';

const readyMedia = (id: string) => ({ id, status: 'READY' }) as any;
const assignment = (
  targetType: 'SCREEN' | 'GROUP',
  targetId: string,
  mediaId: string,
  priority: number
): DefaultMediaTargetAssignmentRecord => ({
  target_type: targetType,
  target_id: targetId,
  media_id: mediaId,
  aspect_ratio: '16:9',
  priority,
  media: readyMedia(mediaId),
  media_url: null,
});

describe('default media target priority', () => {
  it('normalizes legacy missing priorities to zero', () => {
    const parsed = extractDefaultMediaTargets([{
      target_type: 'GROUP',
      target_id: '11111111-1111-4111-8111-111111111111',
      media_id: '22222222-2222-4222-8222-222222222222',
      aspect_ratio: '16:9',
    }]);

    expect(parsed[0]?.priority).toBe(0);
  });

  it('selects a direct screen assignment before any group priority', () => {
    const selected = selectDefaultMediaTargetAssignment([
      assignment('GROUP', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'group-media', 100),
      assignment('SCREEN', 'screen-1', 'screen-media', 0),
    ], { screenId: 'screen-1', aspectRatio: '16:9', groupIds: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'] });

    expect(selected?.media_id).toBe('screen-media');
  });

  it('selects the highest group priority independently of array order', () => {
    const low = assignment('GROUP', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'low-media', 10);
    const high = assignment('GROUP', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'high-media', 90);
    const params = {
      screenId: 'screen-1',
      aspectRatio: '16:9',
      groupIds: [low.target_id, high.target_id],
    };

    expect(selectDefaultMediaTargetAssignment([low, high], params)?.media_id).toBe('high-media');
    expect(selectDefaultMediaTargetAssignment([high, low], params)?.media_id).toBe('high-media');
  });

  it('breaks equal-priority ties by ascending group id and skips non-ready media', () => {
    const later = assignment('GROUP', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'later-media', 50);
    const earlier = assignment('GROUP', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'earlier-media', 50);
    const unavailable = assignment('GROUP', '00000000-0000-4000-8000-000000000000', 'bad-media', 100);
    unavailable.media = { ...unavailable.media!, status: 'FAILED' } as any;

    const selected = selectDefaultMediaTargetAssignment([later, unavailable, earlier], {
      screenId: 'screen-1',
      aspectRatio: '16:9',
      groupIds: [later.target_id, earlier.target_id, unavailable.target_id],
    });

    expect(selected?.media_id).toBe('earlier-media');
  });
});
