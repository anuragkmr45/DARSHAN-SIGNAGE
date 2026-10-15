import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import { getObject } from '@/s3';
import { inspectPdfPageCount } from '@/utils/pdf-metadata';

export type DocumentPageCountBackfillResult = {
  inspected: number;
  updated: number;
  discovered: Array<{ media_id: string; page_count: number }>;
  failed: Array<{ media_id: string; reason: string }>;
  dry_run: boolean;
};

export async function backfillDocumentPageCounts(options: {
  apply: boolean;
  batchSize?: number;
}): Promise<DocumentPageCountBackfillResult> {
  const db = getDatabase();
  const batchSize = Math.max(1, Math.min(500, Math.trunc(options.batchSize ?? 50)));
  const result: DocumentPageCountBackfillResult = {
    inspected: 0,
    updated: 0,
    discovered: [],
    failed: [],
    dry_run: !options.apply,
  };
  let cursor: string | undefined;

  for (;;) {
    const conditions = [
      eq(schema.media.type, 'DOCUMENT'),
      eq(schema.media.status, 'READY'),
      isNull(schema.media.page_count),
    ];
    if (cursor) conditions.push(gt(schema.media.id, cursor));

    const rows = await db
      .select()
      .from(schema.media)
      .where(and(...conditions))
      .orderBy(asc(schema.media.id))
      .limit(batchSize);
    if (rows.length === 0) break;

    const readyIds = rows.map((row) => row.ready_object_id).filter((id): id is string => Boolean(id));
    const readyObjects = readyIds.length
      ? await db.select().from(schema.storageObjects).where(inArray(schema.storageObjects.id, readyIds))
      : [];
    const readyMap = new Map(readyObjects.map((object) => [object.id, object]));

    for (const media of rows) {
      result.inspected += 1;
      try {
        const readyObject = media.ready_object_id ? readyMap.get(media.ready_object_id) : undefined;
        const bucket = readyObject?.bucket ?? media.source_bucket;
        const objectKey = readyObject?.object_key ?? media.source_object_key;
        if (!bucket || !objectKey) throw new Error('Playable PDF object is missing');
        const pageCount = await inspectPdfPageCount(await getObject(bucket, objectKey));
        result.discovered.push({ media_id: media.id, page_count: pageCount });
        if (options.apply) {
          const updated = await db
            .update(schema.media)
            .set({ page_count: pageCount, updated_at: new Date() })
            .where(and(eq(schema.media.id, media.id), isNull(schema.media.page_count)))
            .returning({ id: schema.media.id });
          result.updated += updated.length;
        }
      } catch (error) {
        result.failed.push({
          media_id: media.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    cursor = rows[rows.length - 1]?.id;
    if (!cursor || rows.length < batchSize) break;
  }

  return result;
}
