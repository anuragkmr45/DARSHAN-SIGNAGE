import { describe, expect, it } from 'vitest';
import { normalizeDeviceItems } from './deviceSchedule';

describe('device schedule media normalization', () => {
  it('does not expose retired webpage playback or preview URLs', () => {
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
      media_url: undefined,
      preview_url: undefined,
    });
  });

  it('preserves the selected page for scheduled PDF previews', () => {
    const [item] = normalizeDeviceItems({
      snapshot: { schedule: { items: [{
        id: 'schedule-item',
        presentation: { slots: [{ id: 'entry', media_id: 'pdf-1', duration_seconds: 10, page_number: 4 }] },
      }] } },
      media_assets: {
        'pdf-1': {
          id: 'pdf-1', name: 'Handbook', type: 'DOCUMENT',
          playback_url: 'https://storage.example.test/handbook.pdf',
          preview_url: 'https://storage.example.test/handbook.pdf',
          content_type: 'application/pdf', page_count: 8,
        },
      },
    });

    expect(item).toMatchObject({ media_id: 'pdf-1', page_number: 4 });
  });
});
