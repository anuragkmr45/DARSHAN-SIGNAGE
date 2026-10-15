import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('document page selection migration', () => {
  it('adds every nullable page field and a positive-value constraint', async () => {
    const sql = await readFile(
      path.resolve(process.cwd(), 'drizzle/migrations/0044_document_page_selection.sql'),
      'utf8'
    );
    const columns = [
      ['media', 'page_count'],
      ['presentation_items', 'page_number'],
      ['presentation_slot_items', 'page_number'],
      ['proof_of_play', 'page_number'],
    ] as const;

    for (const [table, column] of columns) {
      expect(sql).toContain(`ALTER TABLE "${table}"`);
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "${column}" integer`);
      expect(sql).toContain(`CHECK ("${column}" IS NULL OR "${column}" > 0)`);
    }
    expect(sql).not.toContain('NOT NULL');
  });
});
