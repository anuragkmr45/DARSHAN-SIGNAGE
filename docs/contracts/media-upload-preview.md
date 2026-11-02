# Media upload and CMS preview contract

- `GET /api/v1/media/upload-policy` returns the current size, multipart, and MIME rules. Its `allowed_mime_types` list matches the server's upload schema.
- The CMS uses a supported filename extension to choose the canonical MIME type when a browser supplies a missing, generic, or inconsistent MIME label. An unsupported extension is rejected before transfer. The server validates the canonical MIME type and the uploaded size and SHA-256 checksum.
- JPEG, PNG, WebP, MP4, and MOV retain their media type. PDF, PPT/PPTX, CSV, DOC/DOCX, and XLS/XLSX are document uploads. The document worker converts non-PDF formats to a PDF used for screen playback and page counting; the original source format remains in `source_content_type`.
- The Media Library labels documents by their original format and shows the playable PDF separately. A READY document with a PDF URL displays the first page on its card and provides page navigation in its detail preview. The detail view requests a fresh media record so an expired signed URL is replaced before previewing.
- Library lists refresh their signed media URLs before the one-hour expiry while the page remains active.
- When a document is served as PDF, its inline delivery filename ends in `.pdf`; the source format remains visible in the CMS record.
- The CMS gateway must return `application/javascript` for hashed `.mjs` assets under `/assets/`; the PDF.js worker is an ES module and browser PDF previews fail when Nginx uses `application/octet-stream`.
- An upload can finish before video transcoding or document conversion finishes. The Media Library reports processing or failure until a READY URL is available.
