import { describe, expect, it } from 'vitest';
import { buildResolvedMediaAssets } from '@/utils/resolved-media';

describe('resolved media assets', () => {
  it('keeps live webpage playback separate from its captured preview', () => {
    const map = new Map([
      ['web-1', {
        id: 'web-1',
        name: 'Operations board',
        filename: 'Operations board',
        type: 'WEBPAGE',
        status: 'READY',
        source_url: 'https://dashboard.example.test/live',
        media_url: 'https://storage.example.test/fallback.png',
        fallback_media_url: 'https://storage.example.test/fallback.png',
        content_type: 'image/png',
        source_content_type: 'text/html',
      } as any],
    ]);
    const assets = buildResolvedMediaAssets(map);

    expect(assets['web-1']).toMatchObject({
      name: 'Operations board',
      type: 'WEBPAGE',
      playback_url: 'https://dashboard.example.test/live',
      preview_url: 'https://storage.example.test/fallback.png',
    });
    expect(assets['web-1']).not.toHaveProperty('source_url');
    expect(buildResolvedMediaAssets(map, { includeSourceUrl: true })['web-1']).toMatchObject({
      source_url: 'https://dashboard.example.test/live',
    });
  });
});
