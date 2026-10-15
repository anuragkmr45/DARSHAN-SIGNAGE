export class PdfInspectionError extends Error {
  constructor(
    public readonly code: 'DOCUMENT_PDF_ENCRYPTED' | 'DOCUMENT_PDF_INVALID',
    message: string
  ) {
    super(message);
    this.name = 'PdfInspectionError';
  }
}

type PdfDocument = { numPages: number; destroy?: () => Promise<void> };
type PdfLoadingTask = { promise: Promise<PdfDocument>; destroy?: () => Promise<void> };
type PdfJsModule = {
  getDocument: (options: {
    data: Uint8Array;
    disableWorker: boolean;
    isEvalSupported: boolean;
  }) => PdfLoadingTask;
};

export function classifyPdfInspectionError(error: unknown): PdfInspectionError {
  if (error instanceof PdfInspectionError) return error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'PasswordException' || /password/i.test(message)) {
    return new PdfInspectionError('DOCUMENT_PDF_ENCRYPTED', 'Password-protected PDFs are not supported');
  }
  return new PdfInspectionError('DOCUMENT_PDF_INVALID', 'PDF could not be inspected');
}

export async function inspectPdfPageCount(input: Uint8Array): Promise<number> {
  let loadingTask: PdfLoadingTask | undefined;
  let documentProxy: PdfDocument | undefined;

  try {
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsModule;
    const task = pdfjs.getDocument({
      data: Uint8Array.from(input),
      disableWorker: true,
      isEvalSupported: false,
    });
    loadingTask = task;
    const document = await task.promise;
    documentProxy = document;
    const pageCount = Number(document.numPages);
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
      throw new PdfInspectionError('DOCUMENT_PDF_INVALID', 'PDF contains no readable pages');
    }
    return pageCount;
  } catch (error) {
    throw classifyPdfInspectionError(error);
  } finally {
    await documentProxy?.destroy?.().catch(() => undefined);
    await loadingTask?.destroy?.().catch(() => undefined);
  }
}
