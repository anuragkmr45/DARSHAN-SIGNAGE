import { describe, expect, it } from 'vitest';
import { normalizeDeviceItems } from './deviceSchedule';

describe('device schedule media normalization', () => {
  it('uses live webpage URL for playback and captured URL for CMS preview', () => {
    const [item] = normalizeDeviceItems({
      snapshot: { schedule: { items: [{
        id: 'schedule-item',
        presentation: { items: [{ id: 'entry', media_id: 'web-1', duration_seconds: 10 }] },
      }] } },
      media_urls: { 'web-1': 'https://legacy.example.test/live' },
      media_assets: {
        'web-1': {
          id: 'web-1', name: 'Marketing dashboard', type: 'WEBPAGE',
          playback_url: 'https://dashboard.example.test/live',
          preview_url: 'https://storage.example.test/preview.png',
        },
      },
    });

    expect(item).toMatchObject({
      media_id: 'web-1', name: 'Marketing dashboard', type: 'webpage',
      media_url: 'https://dashboard.example.test/live',
      preview_url: 'https://storage.example.test/preview.png',
    });
  });
});
