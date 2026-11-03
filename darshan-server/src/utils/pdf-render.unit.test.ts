import { describe, expect, it } from 'vitest';
import { escapeHtml, renderPdfDocument } from '@/utils/pdf-render';
import { getLibreOfficeExecutable } from '@/utils/runtime-dependencies';

describe('report PDF export', () => {
  it.skipIf(!getLibreOfficeExecutable())('converts report tables and escaped operator text without a browser', async () => {
    const unsafe = '<admin@example.test> & "audit"';
    const pdf = await renderPdfDocument(`<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Audit Logs</h1><table><tr><th>User</th></tr><tr><td>${escapeHtml(unsafe)}</td></tr></table></body></html>`);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('rejects oversized reports before invoking LibreOffice', async () => {
    await expect(renderPdfDocument('x'.repeat(8 * 1024 * 1024 + 1))).rejects.toThrow('too large');
  });
});
