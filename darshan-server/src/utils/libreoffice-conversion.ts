import { parse, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LIBREOFFICE_CONVERSION_TIMEOUT_MS = 120_000;

export function buildLibreOfficeConversionArgs(inputPath: string, outputDir: string, profileDir: string): string[] {
  return [
    '--headless',
    '--nologo',
    '--nodefault',
    '--nofirststartwizard',
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    '--convert-to',
    'pdf',
    '--outdir',
    outputDir,
    inputPath,
  ];
}

export function getLibreOfficeOutputPath(inputPath: string, outputDir: string): string {
  return join(outputDir, `${parse(inputPath).name}.pdf`);
}
