import { parse, join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const LIBREOFFICE_CONVERSION_TIMEOUT_MS = 120_000;
export function buildLibreOfficeConversionArgs(inputPath, outputDir, profileDir) {
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
export function getLibreOfficeOutputPath(inputPath, outputDir) {
    return join(outputDir, `${parse(inputPath).name}.pdf`);
}
