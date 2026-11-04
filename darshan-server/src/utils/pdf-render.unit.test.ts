import { describe, expect, it } from 'vitest';
import { escapeHtml, renderPdfDocument } from '@/utils/pdf-render';
import { getLibreOfficeExecutable } from '@/utils/runtime-dependencies';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

describe('report PDF export', () => {
  it.skipIf(!getLibreOfficeExecutable())('converts report tables and escaped operator text without a browser', async () => {
    const unsafe = '<admin@example.test> & "audit"';
    const pdf = await renderPdfDocument(`<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Audit Logs</h1><table><tr><th>User</th></tr><tr><td>${escapeHtml(unsafe)}</td></tr></table></body></html>`);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
    const document = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
    expect(document.numPages).toBe(1);
    const content = await (await document.getPage(1)).getTextContent();
    expect(content.items.map((item) => 'str' in item ? item.str : '').join(' ')).toContain('Audit Logs');
  });

  it('rejects oversized reports before invoking LibreOffice', async () => {
    await expect(renderPdfDocument('x'.repeat(8 * 1024 * 1024 + 1))).rejects.toThrow('too large');
  });
});
