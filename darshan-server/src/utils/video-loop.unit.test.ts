import { describe, expect, it } from 'vitest';
import { schema } from '@/db';
import {
  resolvePresentations,
  serializePresentationSlotForSnapshot,
} from '@/routes/schedule-publish-helper';
import { normalizeVideoLoopEnabled } from './video-loop';

describe('normalizeVideoLoopEnabled', () => {
  it('preserves an explicit loop only for video media', () => {
    expect(normalizeVideoLoopEnabled('VIDEO', true)).toBe(true);
    expect(normalizeVideoLoopEnabled('VIDEO', false)).toBe(false);
    expect(normalizeVideoLoopEnabled('VIDEO', undefined)).toBe(false);
  });

  it('normalizes loop over-posting and legacy values for non-video media', () => {
    expect(normalizeVideoLoopEnabled('IMAGE', true)).toBe(false);
    expect(normalizeVideoLoopEnabled('DOCUMENT', true)).toBe(false);
    expect(normalizeVideoLoopEnabled('WEBPAGE', true)).toBe(false);
    expect(normalizeVideoLoopEnabled(null, true)).toBe(false);
  });

  it('normalizes resolved duplicate occurrences before publish processing', async () => {
    const presentationId = 'presentation-1';
    const video = { id: 'video-1', type: 'VIDEO', name: 'Loop video' };
    const image = { id: 'image-1', type: 'IMAGE', name: 'Still image' };
    const rowsByTable = new Map<unknown, unknown[]>([
      [schema.presentations, [{ id: presentationId, name: 'Lobby', layout_id: null }]],
      [schema.presentationItems, []],
      [
        schema.presentationSlotItems,
        [
          {
            id: 'slot-video-on',
            presentation_id: presentationId,
            slot_id: 'main',
            media_id: video.id,
            order: 0,
            duration_seconds: 10,
            fit_mode: 'contain',
            audio_enabled: false,
            loop_enabled: true,
            page_number: null,
            created_at: new Date('2026-10-15T00:00:00.000Z'),
          },
          {
            id: 'slot-video-off',
            presentation_id: presentationId,
            slot_id: 'main',
            media_id: video.id,
            order: 1,
            duration_seconds: 10,
            fit_mode: 'contain',
            audio_enabled: false,
            loop_enabled: false,
            page_number: null,
            created_at: new Date('2026-10-15T00:00:00.000Z'),
          },
          {
            id: 'slot-image-contaminated',
            presentation_id: presentationId,
            slot_id: 'main',
            media_id: image.id,
            order: 2,
            duration_seconds: 10,
            fit_mode: 'contain',
            audio_enabled: false,
            loop_enabled: true,
            page_number: null,
            created_at: new Date('2026-10-15T00:00:00.000Z'),
          },
        ],
      ],
      [schema.media, [video, image]],
    ]);
    const fakeDb = {
      select: () => ({
        from: (table: unknown) => {
          const rows = rowsByTable.get(table) ?? [];
          const promise = Promise.resolve(rows);
          type FakeQuery = {
            where: () => FakeQuery;
            orderBy: () => Promise<unknown[]>;
            then: Promise<unknown[]>['then'];
          };
          const query: FakeQuery = {
            where: () => query,
            orderBy: () => promise,
            then: promise.then.bind(promise),
          };
          return query;
        },
      }),
    };

    const resolved = await resolvePresentations(
      [presentationId],
      fakeDb as unknown as Exclude<Parameters<typeof resolvePresentations>[1], undefined>,
    );
    const presentation = resolved.get(presentationId) as { slots: Array<{ loop_enabled: boolean }> };
    expect(presentation.slots.map((slot) => slot.loop_enabled)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('freezes loop only for video media in the immutable snapshot shape', () => {
    const base = {
      id: 'slot-1',
      slot_id: 'main',
      media_id: 'media-1',
      order: 0,
      duration_seconds: 10,
      fit_mode: 'contain',
      audio_enabled: false,
      loop_enabled: true,
      page_number: null,
    };

    expect(serializePresentationSlotForSnapshot({
      ...base,
      media: { id: 'media-1', name: 'Video', type: 'VIDEO' },
    }).loop_enabled).toBe(true);
    expect(serializePresentationSlotForSnapshot({
      ...base,
      media: { id: 'media-1', name: 'Image', type: 'IMAGE' },
    }).loop_enabled).toBe(false);
  });
});
