#!/usr/bin/env tsx

import { program } from 'commander';
import { closeDatabase, initializeDatabase } from '../src/db/index.js';
import { backfillDocumentPageCounts } from '../src/services/document-page-count-backfill.js';
import { resolveDocumentPageBackfillOptions } from '../src/utils/document-page-backfill-options.js';

program
  .name('backfill-document-page-counts')
  .description('Inspect READY document PDFs and optionally persist missing page counts')
  .option('--apply', 'Persist discovered page counts; without this flag the command is read-only')
  .option('--batch-size <count>', 'Rows inspected per database batch', '50');

await program.parseAsync(process.argv);
const options = program.opts<{ apply?: boolean; batchSize: string }>();
const resolvedOptions = resolveDocumentPageBackfillOptions(options);

await initializeDatabase();
try {
  const result = await backfillDocumentPageCounts(resolvedOptions);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.failed.length > 0) process.exitCode = 2;
} finally {
  await closeDatabase();
}
