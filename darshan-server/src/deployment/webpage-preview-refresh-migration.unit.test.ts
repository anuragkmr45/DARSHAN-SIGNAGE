import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('webpage preview refresh migration', () => {
  it('adds nullable refresh state, backfills READY previews, and indexes due scans', async () => {
    const sql = await readFile(
      path.resolve(process.cwd(), 'drizzle/migrations/0047_webpage_preview_refresh.sql'),
      'utf8'
    );

    for (const definition of [
      '"webpage_preview_captured_at" timestamp',
      '"webpage_preview_attempted_at" timestamp',
      '"webpage_preview_refresh_token" uuid',
      '"webpage_preview_last_error" varchar(120)',
    ]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${definition}`);
    }
    expect(sql).toContain('WHERE m."type" = \'WEBPAGE\'');
    expect(sql).toContain('AND m."status" = \'READY\'');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "media_webpage_preview_due_idx"');
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS "webpage_preview_[^"]+"[^;]*NOT NULL/);
  });
});
