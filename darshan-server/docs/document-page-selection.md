# Document page selection

DARSHAN schedules one static physical page per document occurrence. Supported upload extensions are `.pdf`, `.ppt`, `.pptx`, `.doc`, `.docx`, `.xls`, `.xlsx`, and `.csv`. Office files are converted to PDF; the page count is always read from the final playable PDF.

## Contract

- `media.page_count` is populated only after the PDF is successfully inspected. Documents remain `PROCESSING` until then.
- `presentation_items.page_number` and `presentation_slot_items.page_number` store the selected page for that occurrence. Missing legacy values mean page 1.
- The same media can occur multiple times with different page numbers.
- Page values must be integers from 1 through `media.page_count`. While the count is unavailable, only page 1 is accepted.
- Non-document media must not carry `page_number`.
- Publish snapshots freeze `page_number`; players advertise `pdf_page_selection_v1`. Publishing a page greater than 1 to an incapable target is rejected.
- Proof-of-play events and CSV exports retain the selected `page_number`.

## Rollout

1. Deploy the migration and server code before CMS/player code.
2. Run the read-only inventory: `npm run production:document-pages:backfill`.
3. Review every failed media ID. Password-protected and malformed PDFs require replacement; do not force a count.
4. Persist valid counts: `npm run production:document-pages:backfill -- --apply`.
5. Deploy players with `pdf_page_selection_v1`, then enable page selection in the CMS.
6. Keep legacy null page selections compatible as page 1 throughout a mixed-version rollout.

The backfill is cursor-batched and dry-run by default. Its JSON lists each discovered media/page-count pair and each failure for operator review. With `--apply`, it updates only `READY` document rows whose `page_count` is still null, so a concurrent worker result is not overwritten. It does not change presentation selections.

## Failure and rollback behavior

- Invalid PDFs fail with `DOCUMENT_PDF_INVALID`; encrypted PDFs fail with `DOCUMENT_PDF_ENCRYPTED`.
- API validation uses `DOCUMENT_PAGE_OUT_OF_RANGE`, `DOCUMENT_PAGE_COUNT_UNAVAILABLE`, and `DOCUMENT_PAGE_NOT_APPLICABLE`.
- A rollback may stop writing page selections, but the four nullable columns should remain until all new snapshots and proof-of-play records have aged out. Old players continue to render missing selections as page 1.
