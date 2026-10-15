import { describe, expect, it } from 'vitest';
import { classifyPdfInspectionError, inspectPdfPageCount, PdfInspectionError } from '@/utils/pdf-metadata';

function buildPdf(pageCount: number): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${index + 3} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...Array.from({ length: pageCount }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>'),
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body);
}

describe('inspectPdfPageCount', () => {
  it('returns the physical page count from a playable PDF', async () => {
    await expect(inspectPdfPageCount(buildPdf(3))).resolves.toBe(3);
  });

  it('rejects malformed document bytes with a stable code', async () => {
    await expect(inspectPdfPageCount(Buffer.from('not a pdf'))).rejects.toMatchObject<PdfInspectionError>({
      code: 'DOCUMENT_PDF_INVALID',
    });
  });

  it('maps PDF.js password failures to the encrypted-document reason', () => {
    const error = new Error('No password given');
    error.name = 'PasswordException';
    expect(classifyPdfInspectionError(error)).toMatchObject({ code: 'DOCUMENT_PDF_ENCRYPTED' });
  });
});
