import { describe, expect, it } from 'vitest';
import { buildLibreOfficeConversionArgs, getLibreOfficeOutputPath } from './libreoffice-conversion';

describe('LibreOffice document conversion', () => {
  it('uses a per-job profile and a deterministic PDF output path', () => {
    const args = buildLibreOfficeConversionArgs(
      '/tmp/doc-convert-123/quarterly report.docx',
      '/tmp/doc-convert-123',
      '/tmp/doc-convert-123/libreoffice-profile'
    );

    expect(args).toContain('-env:UserInstallation=file:///tmp/doc-convert-123/libreoffice-profile');
    expect(args).toContain('--nodefault');
    expect(args.slice(-2)).toEqual(['/tmp/doc-convert-123', '/tmp/doc-convert-123/quarterly report.docx']);
    expect(getLibreOfficeOutputPath('/tmp/doc-convert-123/quarterly report.docx', '/tmp/doc-convert-123'))
      .toBe('/tmp/doc-convert-123/quarterly report.pdf');
  });
});
