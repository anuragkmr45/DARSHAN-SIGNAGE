import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { buildLibreOfficeConversionArgs } from '@/utils/libreoffice-conversion';
import { getLibreOfficeExecutable } from '@/utils/runtime-dependencies';

const execFileAsync = promisify(execFile);
const PDF_TIMEOUT_MS = 45_000;
const MAX_HTML_BYTES = 8 * 1024 * 1024;

export function escapeHtml(value: unknown) {
  const input = String(value ?? '');
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Export server-generated report HTML without launching a browser. */
export async function renderPdfDocument(html: string): Promise<Buffer> {
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new Error('Report is too large to export as PDF');
  }
  const executable = getLibreOfficeExecutable();
  if (!executable) throw new Error('LibreOffice is required for PDF export');
  const directory = await mkdtemp(join(tmpdir(), 'darshan-report-'));
  const inputPath = join(directory, 'report.html');
  try {
    // LibreOffice's HTML import does not honor the browser CSS table rules.
    // Explicit HTML table attributes keep report rows legible in PDF exports.
    const printableHtml = html.replaceAll('<table>', '<table border="1" cellspacing="0" cellpadding="6" width="100%">');
    await writeFile(inputPath, printableHtml, { encoding: 'utf8', mode: 0o600 });
    await execFileAsync(executable, buildLibreOfficeConversionArgs(inputPath, directory, join(directory, 'profile')), {
      timeout: PDF_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
    });
    const pdf = await readFile(join(directory, 'report.pdf'));
    if (pdf.length < 8 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('LibreOffice did not produce a valid PDF');
    }
    return pdf;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
