export type DocumentPageBackfillOptions = {
  apply: boolean;
  batchSize: number;
};

export function resolveDocumentPageBackfillOptions(input: {
  apply?: boolean;
  batchSize?: string | number;
}): DocumentPageBackfillOptions {
  const batchSize = Number(input.batchSize ?? 50);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error('--batch-size must be an integer between 1 and 500');
  }
  return { apply: input.apply === true, batchSize };
}
