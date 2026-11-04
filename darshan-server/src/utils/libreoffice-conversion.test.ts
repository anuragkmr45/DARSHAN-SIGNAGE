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

  it('selects the Writer HTML import only for report PDF rendering', () => {
    const args = buildLibreOfficeConversionArgs('/tmp/report.html', '/tmp', '/tmp/report-profile', {
      inputFilter: 'HTML (StarWriter)',
      outputFilter: 'pdf:writer_pdf_Export',
    });
    expect(args).toContain('--infilter=HTML (StarWriter)');
    expect(args.slice(args.indexOf('--convert-to'), args.indexOf('--convert-to') + 2))
      .toEqual(['--convert-to', 'pdf:writer_pdf_Export']);
  });
});
