import { describe, expect, it } from 'vitest';
import { buildResolvedMediaAssets } from '@/utils/resolved-media';

describe('resolved media assets', () => {
  it('exposes a converted Office document as a playable PDF', () => {
    const map = new Map([
      ['document-1', {
        id: 'document-1',
        name: 'Quarterly report.docx',
        type: 'DOCUMENT',
        status: 'READY',
        media_url: 'https://cms.example.test/media-ready/document-1/ready.pdf',
        content_type: 'application/pdf',
        source_content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      } as any],
    ]);

    expect(buildResolvedMediaAssets(map)['document-1']).toMatchObject({
      type: 'DOCUMENT',
      status: 'READY',
      playback_url: 'https://cms.example.test/media-ready/document-1/ready.pdf',
      content_type: 'application/pdf',
      source_content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  });

  it('does not expose retired webpage URLs to a player', () => {
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
      playback_url: null,
      preview_url: null,
    });
    expect(assets['web-1']).not.toHaveProperty('source_url');
    expect(buildResolvedMediaAssets(map, { includeSourceUrl: true })['web-1']).toMatchObject({
      source_url: null,
    });
  });
});
